import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Readable } from 'stream';

export interface StorageFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface StorageResult {
  key: string;
  url?: string;
  size: number;
  etag?: string;
}

export interface StorageConfig {
  provider: 'minio' | 's3' | 'local';
  fallback?: 'minio' | 's3' | 'local';
  maxFileSize: number;
  allowedMimeTypes: string[];
  minio?: {
    endpoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    bucket: string;
    region?: string;
    forcePathStyle?: boolean;
  };
  s3?: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
  };
  local?: {
    uploadPath: string;
    storagePath: string;
  };
  generateFileName?: (
    originalName: string,
    userId: string,
    projectId: string,
  ) => string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private s3Client: S3Client;
  private config: StorageConfig;

  constructor(private configService: ConfigService) {
    const config = this.configService.get<StorageConfig>('storage');
    if (!config) {
      throw new Error('Storage configuration is required');
    }
    this.config = config;
    this.initializeS3Client();
  }

  private initializeS3Client() {
    if (this.config.provider === 'minio' || this.config.provider === 's3') {
      const clientConfig =
        this.config.provider === 'minio'
          ? {
              endpoint: this.config.minio!.endpoint,
              region: this.config.minio!.region,
              credentials: {
                accessKeyId: this.config.minio!.accessKey,
                secretAccessKey: this.config.minio!.secretKey,
              },
              forcePathStyle: this.config.minio!.forcePathStyle,
            }
          : {
              region: this.config.s3!.region,
              credentials: {
                accessKeyId: this.config.s3!.accessKeyId,
                secretAccessKey: this.config.s3!.secretAccessKey,
              },
            };

      this.s3Client = new S3Client(clientConfig);
      this.logger.log(`Initialized S3 client for ${this.config.provider}`);
    }
  }

  async uploadFile(file: StorageFile, key: string): Promise<StorageResult> {
    // Validate file
    this.validateFile(file);

    try {
      // Try primary storage provider
      return await this.uploadToPrimary(file, key);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Primary storage failed: ${errorMessage}`);

      // Fallback to secondary storage
      if (
        this.config.fallback &&
        this.config.fallback !== this.config.provider
      ) {
        this.logger.warn(`Falling back to ${this.config.fallback} storage`);
        return await this.uploadToFallback(file, key);
      }

      throw error;
    }
  }

  private async uploadToPrimary(
    file: StorageFile,
    key: string,
  ): Promise<StorageResult> {
    switch (this.config.provider) {
      case 'minio':
      case 's3':
        return await this.uploadToS3(file, key);
      case 'local':
      default:
        return await this.uploadToLocal(file, key);
    }
  }

  private async uploadToFallback(
    file: StorageFile,
    key: string,
  ): Promise<StorageResult> {
    switch (this.config.fallback) {
      case 'minio':
      case 's3':
        return await this.uploadToS3(file, key);
      case 'local':
      default:
        return await this.uploadToLocal(file, key);
    }
  }

  private async uploadToS3(
    file: StorageFile,
    key: string,
  ): Promise<StorageResult> {
    const bucket =
      this.config.provider === 'minio'
        ? this.config.minio!.bucket
        : this.config.s3!.bucket;

    try {
      // Create bucket if it doesn't exist (MinIO)
      if (this.config.provider === 'minio') {
        await this.ensureBucketExists(bucket);
      }

      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
          Metadata: {
            originalName: file.originalname,
            uploadedAt: new Date().toISOString(),
          },
        },
      });

      const result = await upload.done();

      this.logger.log(`File uploaded to ${this.config.provider}: ${key}`);

      return {
        key,
        url: result.Location,
        size: file.size,
        etag: result.ETag,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`S3 upload failed: ${errorMessage}`);
      throw error;
    }
  }

  private async uploadToLocal(
    file: StorageFile,
    key: string,
  ): Promise<StorageResult> {
    const filePath = path.join(this.config.local!.storagePath, key);
    const dir = path.dirname(filePath);

    try {
      // Ensure directory exists
      await fs.mkdir(dir, { recursive: true });

      // Write file
      await fs.writeFile(filePath, file.buffer);

      this.logger.log(`File uploaded to local storage: ${key}`);

      return {
        key,
        url: `/files/${key}`, // Relative URL for local files
        size: file.size,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Local upload failed: ${errorMessage}`);
      throw error;
    }
  }

  async getFile(key: string): Promise<Buffer> {
    switch (this.config.provider) {
      case 'minio':
      case 's3':
        return await this.getFileFromS3(key);
      case 'local':
      default:
        return await this.getFileFromLocal(key);
    }
  }

  private async getFileFromS3(key: string): Promise<Buffer> {
    const bucket =
      this.config.provider === 'minio'
        ? this.config.minio!.bucket
        : this.config.s3!.bucket;

    try {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);
      const stream = response.Body as Readable;

      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      return Buffer.concat(chunks);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`S3 download failed: ${errorMessage}`);
      throw error;
    }
  }

  private async getFileFromLocal(key: string): Promise<Buffer> {
    const filePath = path.join(this.config.local!.storagePath, key);

    try {
      return await fs.readFile(filePath);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Local download failed: ${errorMessage}`);
      throw error;
    }
  }

  async deleteFile(key: string): Promise<void> {
    switch (this.config.provider) {
      case 'minio':
      case 's3':
        await this.deleteFileFromS3(key);
        break;
      case 'local':
      default:
        await this.deleteFileFromLocal(key);
        break;
    }
  }

  private async deleteFileFromS3(key: string): Promise<void> {
    const bucket =
      this.config.provider === 'minio'
        ? this.config.minio!.bucket
        : this.config.s3!.bucket;

    try {
      const command = new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      await this.s3Client.send(command);
      this.logger.log(`File deleted from ${this.config.provider}: ${key}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`S3 deletion failed: ${errorMessage}`);
      throw error;
    }
  }

  private async deleteFileFromLocal(key: string): Promise<void> {
    const filePath = path.join(this.config.local!.storagePath, key);

    try {
      await fs.unlink(filePath);
      this.logger.log(`File deleted from local storage: ${key}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Local deletion failed: ${errorMessage}`);
      throw error;
    }
  }

  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    if (this.config.provider === 'local') {
      // For local storage, return direct URL
      return `/files/${key}`;
    }

    const bucket =
      this.config.provider === 'minio'
        ? this.config.minio!.bucket
        : this.config.s3!.bucket;

    try {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      return await getSignedUrl(this.s3Client, command, { expiresIn });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Signed URL generation failed: ${errorMessage}`);
      throw error;
    }
  }

  private validateFile(file: StorageFile): void {
    // Check file size
    if (file.size > this.config.maxFileSize) {
      throw new BadRequestException(
        `File size ${file.size} exceeds maximum allowed size ${this.config.maxFileSize}`,
      );
    }

    // Check MIME type
    if (!this.config.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `File type ${file.mimetype} is not allowed`,
      );
    }
  }

  private async ensureBucketExists(bucketName: string): Promise<void> {
    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: bucketName,
          Key: '.keep', // Dummy key to check bucket existence
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'NoSuchBucket') {
        // Bucket doesn't exist, but we can't create it via SDK in MinIO
        // This should be handled by MinIO admin or docker setup
        this.logger.warn(
          `Bucket ${bucketName} doesn't exist. Please create it manually.`,
        );
      }
    }
  }

  generateFileKey(
    originalName: string,
    userId: string,
    projectId: string,
  ): string {
    return this.config.generateFileName!(originalName, userId, projectId);
  }
}
