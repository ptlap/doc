// API Routes
export enum ApiRoutes {
  AUTH = 'auth',
  PROJECTS = 'projects',
  UPLOAD = 'upload',
  PROCESSING = 'processing',
  USERS = 'users',
}

// Auth Routes
export enum AuthRoutes {
  REGISTER = 'register',
  LOGIN = 'login',
  LOGOUT = 'logout',
  REFRESH = 'refresh',
  PROFILE = 'profile',
}

// Processing Quality
export enum ProcessingQuality {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

// Processing Priority
export enum ProcessingPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
}

// Supported Languages for OCR
export enum SupportedLanguages {
  ENGLISH = 'eng',
  VIETNAMESE = 'vie',
  CHINESE_SIMPLIFIED = 'chi_sim',
  CHINESE_TRADITIONAL = 'chi_tra',
  JAPANESE = 'jpn',
  KOREAN = 'kor',
  FRENCH = 'fra',
  GERMAN = 'deu',
  SPANISH = 'spa',
  ITALIAN = 'ita',
  PORTUGUESE = 'por',
  RUSSIAN = 'rus',
}

// Log Levels
export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
  VERBOSE = 'verbose',
}

// Environment Types
export enum Environment {
  DEVELOPMENT = 'development',
  PRODUCTION = 'production',
  TEST = 'test',
}

// File Types
export enum FileType {
  PDF = 'pdf',
  DOCX = 'docx',
  PPTX = 'pptx',
  TXT = 'txt',
  IMAGE = 'image',
}

// Processing Steps
export enum ProcessingStep {
  UPLOADING = 'uploading',
  VALIDATING = 'validating',
  EXTRACTING = 'extracting',
  PROCESSING = 'processing',
  ANALYZING = 'analyzing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}
