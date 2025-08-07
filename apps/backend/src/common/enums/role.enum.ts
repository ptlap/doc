export enum Role {
  ADMIN = 'admin',
  USER = 'user',
  GUEST = 'guest',
}

export type UserRole = keyof typeof Role;