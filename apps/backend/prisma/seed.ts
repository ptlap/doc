import {
  PrismaClient,
  UserRole,
  ProjectStatus,
  DocumentStatus,
  DocumentType,
} from '../generated/prisma';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Create admin user
  const adminPasswordHash = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@aidoc.com' },
    update: {},
    create: {
      email: 'admin@aidoc.com',
      name: 'Admin User',
      passwordHash: adminPasswordHash,
      role: UserRole.admin,
      isActive: true,
      preferences: {
        theme: 'light',
        language: 'vi',
        notifications: true,
      },
    },
  });

  // Create test user
  const userPasswordHash = await bcrypt.hash('user123', 10);
  const testUser = await prisma.user.upsert({
    where: { email: 'user@aidoc.com' },
    update: {},
    create: {
      email: 'user@aidoc.com',
      name: 'Test User',
      passwordHash: userPasswordHash,
      role: UserRole.user,
      isActive: true,
      preferences: {
        theme: 'dark',
        language: 'en',
        notifications: false,
      },
    },
  });

  console.log('✅ Created users:', {
    admin: admin.email,
    testUser: testUser.email,
  });

  // Create sample project for test user
  const sampleProject = await prisma.project.create({
    data: {
      userId: testUser.id,
      name: 'Sample Research Project',
      description:
        'A sample project for testing document processing and Q&A features',
      status: ProjectStatus.active,
      settings: {
        autoProcess: true,
        ocrLanguage: 'eng+vie',
        chunkSize: 1000,
        chunkOverlap: 200,
      },
    },
  });

  console.log('✅ Created sample project:', sampleProject.name);

  // Create sample document (placeholder - no actual file)
  const sampleDocument = await prisma.document.create({
    data: {
      projectId: sampleProject.id,
      userId: testUser.id,
      originalFilename: 'sample-document.pdf',
      storedFilename: 'sample-document-uuid.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: BigInt(1024 * 1024), // 1MB
      status: DocumentStatus.uploaded,
      documentType: DocumentType.pdf,
      metadata: {
        pageCount: 10,
        language: 'en',
        title: 'Sample Research Paper',
        author: 'AI Document Assistant',
      },
      processingProgress: 0,
    },
  });

  console.log('✅ Created sample document:', sampleDocument.originalFilename);

  // Create sample conversation
  const sampleConversation = await prisma.conversation.create({
    data: {
      projectId: sampleProject.id,
      userId: testUser.id,
      title: 'Getting Started with AI Document Assistant',
      contextSettings: {
        maxTokens: 4000,
        temperature: 0.7,
        topK: 5,
      },
    },
  });

  console.log('✅ Created sample conversation:', sampleConversation.title);

  // Create sample messages
  await prisma.message.createMany({
    data: [
      {
        conversationId: sampleConversation.id,
        userId: testUser.id,
        role: 'user',
        content: 'What is this document about?',
        metadata: {
          timestamp: new Date().toISOString(),
        },
      },
      {
        conversationId: sampleConversation.id,
        userId: testUser.id,
        role: 'assistant',
        content:
          'This is a sample document for testing the AI Document Assistant system. It demonstrates how documents are processed and how you can ask questions about their content.',
        metadata: {
          timestamp: new Date().toISOString(),
          model: 'gpt-4',
        },
        citations: [
          {
            pageNumber: 1,
            text: 'sample document for testing',
            confidence: 0.95,
          },
        ],
        confidenceScore: 0.95,
        processingTimeMs: 1500,
      },
    ],
  });

  console.log('✅ Created sample messages');

  console.log('🎉 Database seeding completed successfully!');
  console.log('\n📊 Summary:');
  console.log(`- Users: ${await prisma.user.count()}`);
  console.log(`- Projects: ${await prisma.project.count()}`);
  console.log(`- Documents: ${await prisma.document.count()}`);
  console.log(`- Conversations: ${await prisma.conversation.count()}`);
  console.log(`- Messages: ${await prisma.message.count()}`);
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
