import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  // Storage provider: 'local' | 'minio' | 's3'
  provider: process.env.STORAGE_PROVIDER || 'local',
  fallback: process.env.STORAGE_FALLBACK || 'local',

  // Local storage
  local: {
    uploadPath: process.env.UPLOAD_PATH || './temp/uploads',
    storagePath: process.env.STORAGE_PATH || './storage',
  },

  // MinIO configuration
  minio: {
    endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin123',
    bucket: process.env.MINIO_BUCKET || 'ai-doc-files',
    region: process.env.MINIO_REGION || 'us-east-1',
    forcePathStyle: true, // Required for MinIO
  },

  // AWS S3 configuration
  s3: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    bucket: process.env.AWS_S3_BUCKET || 'ai-doc-assistant-files',
  },

  // File upload limits
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '26214400'), // 25MB
  allowedMimeTypes: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // PPTX
    'text/plain',
    'image/jpeg',
    'image/png',
    'image/gif',
  ],

  // File naming
  generateFileName: (
    originalName: string,
    userId: string,
    projectId: string,
  ) => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const extension = originalName.split('.').pop();
    return `${userId}/${projectId}/${timestamp}-${random}.${extension}`;
  },
}));
