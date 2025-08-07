// HTTP Status Messages
export const httpMessages = {
  SUCCESS: 'Operation completed successfully',
  CREATED: 'Resource created successfully',
  UPDATED: 'Resource updated successfully',
  DELETED: 'Resource deleted successfully',
  NOT_FOUND: 'Resource not found',
  UNAUTHORIZED: 'Unauthorized access',
  FORBIDDEN: 'Access forbidden',
  BAD_REQUEST: 'Invalid request data',
  INTERNAL_ERROR: 'Internal server error',
} as const;

// File Upload Constants
export const fileUpload = {
  MAX_SIZE: 25 * 1024 * 1024, // 25MB
  ALLOWED_MIME_TYPES: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // PPTX
    'text/plain',
    'image/jpeg',
    'image/png',
    'image/gif',
  ],
  SUPPORTED_EXTENSIONS: [
    '.pdf',
    '.docx',
    '.pptx',
    '.txt',
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
  ],
} as const;

// Processing Constants
export const processing = {
  DEFAULT_LANGUAGE: 'eng',
  DEFAULT_QUALITY: 'medium',
  MAX_PAGES_PER_DOCUMENT: 1000,
  CHUNK_SIZE: 2000, // characters
  DEFAULT_CONCURRENCY: 5,
} as const;

// Cache Keys
export const cacheKeys = {
  USER_PROFILE: (userId: string) => `user:profile:${userId}`,
  PROJECT_STATS: (projectId: string) => `project:stats:${projectId}`,
  DOCUMENT_PROCESSING: (documentId: string) =>
    `document:processing:${documentId}`,
} as const;

// Queue Names
export const queueNames = {
  DOCUMENT_PROCESSING: 'document-processing',
  EMAIL_NOTIFICATIONS: 'email-notifications',
  FILE_CLEANUP: 'file-cleanup',
} as const;

// Pagination
export const pagination = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,
} as const;
