export interface AuthResponse {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    tenantId?: string | null;
    isActive: boolean;
    createdAt: Date;
    preferences: any;
    lastLoginAt?: Date | null;
  };
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}
