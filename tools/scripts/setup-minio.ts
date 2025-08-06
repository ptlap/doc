import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';

async function setupMinIO() {
  const client = new S3Client({
    endpoint: 'http://localhost:9000',
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin123',
    },
    forcePathStyle: true,
  });

  const bucketName = 'ai-doc-files';

  try {
    // Check if bucket exists
    await client.send(new HeadBucketCommand({ Bucket: bucketName }));
    console.log(`✅ Bucket '${bucketName}' already exists`);
  } catch (error) {
    if (error.name === 'NoSuchBucket' || error.name === 'NotFound') {
      try {
        // Create bucket
        await client.send(new CreateBucketCommand({ Bucket: bucketName }));
        console.log(`✅ Created bucket '${bucketName}'`);
      } catch (createError) {
        console.error(`❌ Failed to create bucket: ${createError.message}`);
        process.exit(1);
      }
    } else {
      console.error(`❌ Error checking bucket: ${error.message}`);
      process.exit(1);
    }
  }

  console.log('🎉 MinIO setup completed successfully!');
  console.log('📊 MinIO Console: http://localhost:9001');
  console.log('🔑 Username: minioadmin');
  console.log('🔑 Password: minioadmin123');
}

setupMinIO().catch(console.error);
