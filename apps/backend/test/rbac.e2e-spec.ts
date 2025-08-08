import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Server } from 'http';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { Role } from '../src/common/enums/role.enum';
import * as bcrypt from 'bcryptjs';

interface TestUser {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

describe('RBAC E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;

  // Test users
  let adminUser: TestUser;
  let regularUser: TestUser;
  let guestUser: TestUser;
  let adminToken: string;
  let userToken: string;
  let guestToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = moduleFixture.get<PrismaService>(PrismaService);
    authService = moduleFixture.get<AuthService>(AuthService);

    await app.init();

    // Create test users
    await setupTestUsers();
  });

  afterAll(async () => {
    // Cleanup test users
    await cleanupTestUsers();
    await app.close();
  });

  async function setupTestUsers() {
    const passwordHash = await bcrypt.hash('testpassword123', 12);

    // Create admin user
    adminUser = await prisma.user.create({
      data: {
        email: 'admin-test@example.com',
        name: 'Admin Test User',
        passwordHash,
        role: Role.ADMIN,
        isActive: true,
        preferences: {},
      },
    });

    // Create regular user
    regularUser = await prisma.user.create({
      data: {
        email: 'user-test@example.com',
        name: 'Regular Test User',
        passwordHash,
        role: Role.USER,
        isActive: true,
        preferences: {},
      },
    });

    // Create guest user
    guestUser = await prisma.user.create({
      data: {
        email: 'guest-test@example.com',
        name: 'Guest Test User',
        passwordHash,
        role: Role.GUEST,
        isActive: true,
        preferences: {},
      },
    });

    // Get tokens for each user
    const adminLoginResponse = await authService.login({
      email: adminUser.email,
      password: 'testpassword123',
    });
    adminToken = (adminLoginResponse as { accessToken: string }).accessToken;

    const userLoginResponse = await authService.login({
      email: regularUser.email,
      password: 'testpassword123',
    });
    userToken = (userLoginResponse as { accessToken: string }).accessToken;

    const guestLoginResponse = await authService.login({
      email: guestUser.email,
      password: 'testpassword123',
    });
    guestToken = (guestLoginResponse as { accessToken: string }).accessToken;
  }

  async function cleanupTestUsers() {
    await prisma.session.deleteMany({
      where: {
        userId: {
          in: [adminUser.id, regularUser.id, guestUser.id],
        },
      },
    });

    await prisma.user.deleteMany({
      where: {
        id: {
          in: [adminUser.id, regularUser.id, guestUser.id],
        },
      },
    });
  }

  describe('Auth Module RBAC', () => {
    describe('Admin-only endpoints', () => {
      it('should allow admin to access /auth/admin/users', async () => {
        const response = await request(app.getHttpServer() as Server)
          .get('/auth/admin/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(response.body).toBeInstanceOf(Array);
      });

      it('should deny regular user access to /auth/admin/users', async () => {
        const response = await request(app.getHttpServer() as Server)
          .get('/auth/admin/users')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(403);

        expect(response.body).toMatchObject({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Administrator privileges required',
          errorCode: 'RBAC_ADMIN_REQUIRED',
        });
      });

      it('should deny guest access to /auth/admin/users', async () => {
        await request(app.getHttpServer() as Server)
          .get('/auth/admin/users')
          .set('Authorization', `Bearer ${guestToken}`)
          .expect(403);
      });

      it('should deny unauthenticated access to /auth/admin/users', async () => {
        await request(app.getHttpServer() as Server)
          .get('/auth/admin/users')
          .expect(401);
      });

      it('should allow admin to access /auth/admin/stats', async () => {
        await request(app.getHttpServer() as Server)
          .get('/auth/admin/stats')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
      });

      it('should deny regular user access to /auth/admin/stats', async () => {
        const response = await request(app.getHttpServer() as Server)
          .get('/auth/admin/stats')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(403);

        expect((response.body as { errorCode: string }).errorCode).toBe(
          'RBAC_ADMIN_REQUIRED',
        );
      });
    });

    describe('User and Admin endpoints', () => {
      it('should allow admin to access /auth/user/dashboard', async () => {
        await request(app.getHttpServer() as Server)
          .get('/auth/user/dashboard')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
      });

      it('should allow regular user to access /auth/user/dashboard', async () => {
        await request(app.getHttpServer() as Server)
          .get('/auth/user/dashboard')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(200);
      });

      it('should deny guest access to /auth/user/dashboard', async () => {
        const response = await request(app.getHttpServer() as Server)
          .get('/auth/user/dashboard')
          .set('Authorization', `Bearer ${guestToken}`)
          .expect(403);

        expect((response.body as { errorCode: string }).errorCode).toBe(
          'RBAC_INSUFFICIENT_PERMISSIONS',
        );
      });
    });
  });

  describe('Admin Module RBAC', () => {
    describe('Admin dashboard', () => {
      it('should allow admin to access /admin/dashboard', async () => {
        await request(app.getHttpServer() as Server)
          .get('/admin/dashboard')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
      });

      it('should deny regular user access to /admin/dashboard', async () => {
        const response = await request(app.getHttpServer() as Server)
          .get('/admin/dashboard')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(403);

        expect(response.body as Record<string, unknown>).toMatchObject({
          message: 'Administrator privileges required',
          errorCode: 'RBAC_ADMIN_REQUIRED',
          details: expect.objectContaining({
            requiredRole: 'admin',
            currentRole: 'user',
            resource: 'admin',
          }) as Record<string, unknown>,
        });
      });
    });

    describe('User management', () => {
      it('should allow admin to get users list', async () => {
        await request(app.getHttpServer() as Server)
          .get('/admin/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
      });

      it('should allow admin to get user by ID', async () => {
        await request(app.getHttpServer() as Server)
          .get(`/admin/users/${regularUser.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
      });

      it('should deny regular user access to user management', async () => {
        await request(app.getHttpServer() as Server)
          .get('/admin/users')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(403);
      });

      it('should allow admin to update user role', async () => {
        await request(app.getHttpServer() as Server)
          .put(`/admin/users/${regularUser.id}/role`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ role: Role.USER })
          .expect(200);
      });

      it('should deny regular user from updating user roles', async () => {
        await request(app.getHttpServer() as Server)
          .put(`/admin/users/${regularUser.id}/role`)
          .set('Authorization', `Bearer ${userToken}`)
          .send({ role: Role.ADMIN })
          .expect(403);
      });
    });

    describe('System management', () => {
      it('should allow admin to access system health', async () => {
        await request(app.getHttpServer() as Server)
          .get('/admin/system/health')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
      });

      it('should allow admin to trigger maintenance', async () => {
        await request(app.getHttpServer() as Server)
          .post('/admin/system/maintenance')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
      });

      it('should deny regular user access to system management', async () => {
        await request(app.getHttpServer() as Server)
          .get('/admin/system/health')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(403);
      });
    });
  });

  describe('Management Module RBAC', () => {
    describe('System configuration', () => {
      it('should allow admin to get system config', async () => {
        await request(app.getHttpServer() as Server)
          .get('/management/config')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
      });

      it('should allow admin to update system config', async () => {
        await request(app.getHttpServer() as Server)
          .put('/management/config')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ testConfig: 'value' })
          .expect(200);
      });

      it('should deny regular user access to system config', async () => {
        const response = await request(app.getHttpServer() as Server)
          .get('/management/config')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(403);

        expect(response.body).toMatchObject({
          message: 'Management access required',
          errorCode: 'RBAC_MANAGEMENT_ACCESS_REQUIRED',
        });
      });
    });

    describe('Monitoring metrics', () => {
      it('should allow admin to access detailed metrics', async () => {
        await request(app.getHttpServer() as Server)
          .get('/management/monitoring/metrics')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
      });

      it('should allow regular user to access basic metrics', async () => {
        await request(app.getHttpServer() as Server)
          .get('/management/monitoring/metrics')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(200);
      });

      it('should deny guest access to metrics', async () => {
        await request(app.getHttpServer() as Server)
          .get('/management/monitoring/metrics')
          .set('Authorization', `Bearer ${guestToken}`)
          .expect(403);
      });
    });

    describe('Security audit logs', () => {
      it('should allow admin to access audit logs', async () => {
        await request(app.getHttpServer() as Server)
          .get('/management/security/audit-logs')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
      });

      it('should deny regular user access to audit logs', async () => {
        await request(app.getHttpServer() as Server)
          .get('/management/security/audit-logs')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(403);
      });
    });
  });

  describe('Projects Module RBAC', () => {
    it('should enforce ownership: owner 200, other user 403 (or 404)', async () => {
      // Create a project owned by regularUser
      const project = await prisma.project.create({
        data: {
          userId: regularUser.id,
          name: 'Proj1',
          status: 'active',
          documentCount: 0,
          totalSizeBytes: BigInt(0),
        },
      });

      // Owner can access
      await request(app.getHttpServer() as Server)
        .get(`/projects/${project.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      // Admin is not the owner: policy does NOT allow override → expect 404
      await request(app.getHttpServer() as Server)
        .get(`/projects/${project.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      // Create another user who is not the owner
      const hash = await bcrypt.hash('pw2', 4);
      const another = await prisma.user.create({
        data: {
          email: 'user2-test@example.com',
          name: 'U2',
          passwordHash: hash,
          role: Role.USER,
          isActive: true,
          preferences: {},
        },
      });
      const login2 = await authService.login({
        email: another.email,
        password: 'pw2',
      });
      const token2 = (login2 as { accessToken: string }).accessToken;

      // Non-owner should NOT see the resource (policy hides resource) → expect 404
      await request(app.getHttpServer() as Server)
        .get(`/projects/${project.id}`)
        .set('Authorization', `Bearer ${token2}`)
        .expect(404);
    });
    it('should allow admin to access projects', async () => {
      await request(app.getHttpServer() as Server)
        .get('/projects')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('should allow regular user to access projects', async () => {
      await request(app.getHttpServer() as Server)
        .get('/projects')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);
    });

    it('should deny guest access to projects', async () => {
      const response = await request(app.getHttpServer() as Server)
        .get('/projects')
        .set('Authorization', `Bearer ${guestToken}`)
        .expect(403);

      expect((response.body as { errorCode: string }).errorCode).toBe(
        'RBAC_INSUFFICIENT_PERMISSIONS',
      );
    });

    it('should deny unauthenticated access to projects', async () => {
      await request(app.getHttpServer() as Server)
        .get('/projects')
        .expect(401);
    });
  });

  describe('Upload Module RBAC', () => {
    it('should allow admin to access upload endpoints', async () => {
      await request(app.getHttpServer() as Server)
        .get('/upload/progress/123e4567-e89b-12d3-a456-426614174000')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404); // 404 because document doesn't exist, but access is allowed
    });

    it('should allow regular user to access upload endpoints', async () => {
      await request(app.getHttpServer() as Server)
        .get('/upload/progress/123e4567-e89b-12d3-a456-426614174000')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(404); // 404 because document doesn't exist, but access is allowed
    });

    it('should deny guest access to upload endpoints', async () => {
      await request(app.getHttpServer() as Server)
        .get('/upload/progress/test-id')
        .set('Authorization', `Bearer ${guestToken}`)
        .expect(403);
    });
  });

  describe('Processing Module RBAC', () => {
    it('should allow admin to access processing endpoints', async () => {
      await request(app.getHttpServer() as Server)
        .get('/processing/supported-types')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('should allow regular user to access processing endpoints', async () => {
      await request(app.getHttpServer() as Server)
        .get('/processing/supported-types')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);
    });

    it('should deny guest access to processing endpoints', async () => {
      await request(app.getHttpServer() as Server)
        .get('/processing/supported-types')
        .set('Authorization', `Bearer ${guestToken}`)
        .expect(403);
    });
  });

  describe('Tenant isolation', () => {
    it('should isolate resources by tenant via Prisma middleware and JWT tenantId', async () => {
      const passwordHash = await bcrypt.hash('tenant-pass', 12);

      // Create tenants using raw SQL as PrismaService may not expose Tenant in test typings
      const taRows = await prisma.$queryRaw<
        Array<{ id: string }>
      >`INSERT INTO tenants (name) VALUES (${`TenantA-${Date.now()}`}) RETURNING id`;
      const tbRows = await prisma.$queryRaw<
        Array<{ id: string }>
      >`INSERT INTO tenants (name) VALUES (${`TenantB-${Date.now()}`}) RETURNING id`;
      const tenantAId = taRows[0]?.id;
      const tenantBId = tbRows[0]?.id;

      const taUser = await prisma.user.create({
        data: {
          email: `ta-${Date.now()}@example.com`,
          name: 'TA User',
          passwordHash,
          role: Role.USER,
          isActive: true,
          preferences: {},
          // set via raw since Prisma type may not expose
        },
      });
      await prisma.$executeRaw`UPDATE users SET tenant_id = ${tenantAId} WHERE id = ${taUser.id}`;
      const tbUser = await prisma.user.create({
        data: {
          email: `tb-${Date.now()}@example.com`,
          name: 'TB User',
          passwordHash,
          role: Role.USER,
          isActive: true,
          preferences: {},
          // set via raw since Prisma type may not expose
        },
      });
      await prisma.$executeRaw`UPDATE users SET tenant_id = ${tenantBId} WHERE id = ${tbUser.id}`;

      const taLogin = await authService.login({
        email: taUser.email,
        password: 'tenant-pass',
      });
      const tbLogin = await authService.login({
        email: tbUser.email,
        password: 'tenant-pass',
      });
      const taToken = (taLogin as { accessToken: string }).accessToken;
      const tbToken = (tbLogin as { accessToken: string }).accessToken;

      const taProject = await prisma.project.create({
        data: {
          userId: taUser.id,
          name: 'TA Project',
          status: 'active',
          documentCount: 0,
          totalSizeBytes: BigInt(0),
        },
      });
      await prisma.$executeRaw`UPDATE projects SET tenant_id = ${tenantAId} WHERE id = ${taProject.id}`;

      // Cross-tenant should not see the project
      await request(app.getHttpServer() as Server)
        .get(`/projects/${taProject.id}`)
        .set('Authorization', `Bearer ${tbToken}`)
        .expect(404);

      // Same-tenant owner can see the project
      await request(app.getHttpServer() as Server)
        .get(`/projects/${taProject.id}`)
        .set('Authorization', `Bearer ${taToken}`)
        .expect(200);

      // cleanup
      await prisma.session.deleteMany({
        where: { userId: { in: [taUser.id, tbUser.id] } },
      });
      await prisma.project.delete({ where: { id: taProject.id } });
      await prisma.user.deleteMany({
        where: { id: { in: [taUser.id, tbUser.id] } },
      });
      await prisma.$executeRaw`DELETE FROM tenants WHERE id IN (${tenantAId}, ${tenantBId})`;
    });
  });

  describe('Error message enhancement', () => {
    it('should provide detailed error information for admin endpoints', async () => {
      const response = await request(app.getHttpServer() as Server)
        .get('/admin/users')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Administrator privileges required',
        errorCode: 'RBAC_ADMIN_REQUIRED',
        details: {
          requiredRole: 'admin',
          currentRole: 'user',
          resource: 'admin',
          action: 'read',
        },
        help: 'This endpoint requires administrator privileges. Contact your system administrator if you need access.',
      });
    });

    it('should provide detailed error information for management endpoints', async () => {
      const response = await request(app.getHttpServer() as Server)
        .get('/management/config')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);

      expect(response.body).toMatchObject({
        message: 'Management access required',
        errorCode: 'RBAC_MANAGEMENT_ACCESS_REQUIRED',
        details: {
          requiredRoles: ['admin'],
          currentRole: 'user',
          resource: 'management',
          action: 'read',
        },
      });
    });

    it('should provide guest-specific help message', async () => {
      const response = await request(app.getHttpServer() as Server)
        .get('/projects')
        .set('Authorization', `Bearer ${guestToken}`)
        .expect(403);

      expect((response.body as { help: string }).help).toContain(
        'Guest users have limited access',
      );
    });

    it('should include timestamp and path information', async () => {
      const response = await request(app.getHttpServer() as Server)
        .get('/admin/users')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);

      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('path', '/admin/users');
      expect(response.body).toHaveProperty('method', 'GET');
    });
  });

  describe('Token validation', () => {
    it('should reject invalid tokens', async () => {
      await request(app.getHttpServer() as Server)
        .get('/admin/users')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('should reject expired tokens and set WWW-Authenticate header', async () => {
      // Create a very short-lived token (1s), then wait so it expires
      const testingModule: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      const { JwtService } = await import('@nestjs/jwt');
      const jwtService = testingModule.get(JwtService);
      const expired = await jwtService.signAsync(
        { sub: regularUser.id, email: regularUser.email, role: Role.USER },
        { secret: process.env.JWT_SECRET || 'secret', expiresIn: '1s' },
      );
      await new Promise((r) => setTimeout(r, 2000));

      const res = await request(app.getHttpServer() as Server)
        .get('/admin/users')
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);

      expect(res.headers['www-authenticate']).toMatch(/Bearer/i);
      expect(res.headers['content-type']).toMatch(/application\/json/i);
    });

    it('should reject malformed authorization headers', async () => {
      await request(app.getHttpServer() as Server)
        .get('/admin/users')
        .set('Authorization', 'InvalidFormat token')
        .expect(401);
    });
  });
});
