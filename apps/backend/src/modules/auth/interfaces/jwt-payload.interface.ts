export interface JwtPayload {
  sub: string; // User ID
  email: string;
  role: string;
  tenantId?: string;
  jti?: string; // Token id
  tokenVersion?: number; // server-side invalidation gate
  permsHash?: string; // quick detect permission changes
  iat?: number; // Issued at
  exp?: number; // Expires at
}
