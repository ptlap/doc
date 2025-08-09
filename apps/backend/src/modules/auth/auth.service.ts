import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import { PrismaService } from '../../common/services/prisma.service';
import { PermissionsService } from '../../common/services/permissions.service';
import { TokenBlocklistService } from '../../common/services/token-blocklist.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { AuthResponse } from './interfaces/auth-response.interface';
import * as bcrypt from 'bcryptjs';
import { Role } from '../../common/enums/role.enum';

type ValidatedUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId?: string | null;
  isActive: boolean;
  preferences: any;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly permissionsService: PermissionsService,
    private readonly tokenBlocklist: TokenBlocklistService,
  ) {}

  private static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async register(registerDto: RegisterDto): Promise<AuthResponse> {
    const { email, password, name } = registerDto;

    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new BadRequestException('User with this email already exists');
    }

    // Hash password
    const saltRounds = process.env.NODE_ENV === 'test' ? 4 : 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    try {
      // Create user (tenant handling will be added when multi-tenant is fully enabled)

      const user = await this.prisma.user.create({
        data: {
          email,
          name,
          passwordHash,
          role: 'user',
          isActive: true,
          preferences: {
            theme: 'light',
            language: 'en',
            notifications: true,
          },
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          preferences: true,
        },
      });

      // Generate JWT tokens (include tenant if available)
      const tokens = await this.generateTokens(
        user.id,
        user.email,
        user.role,
        // During registration tenant may be assigned elsewhere; nullable supported
        (user as { tenantId?: string | null }).tenantId,
      );

      // Create session
      await this.createSession(user.id, tokens.accessToken);

      this.logger.log(`User registered successfully: ${user.email}`);

      return {
        user,
        ...tokens,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Registration failed: ${errorMessage}`);
      throw new BadRequestException('Registration failed');
    }
  }

  async login(loginDto: LoginDto): Promise<AuthResponse> {
    const { email, password } = loginDto;

    // Find user
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        passwordHash: true,
        createdAt: true,
        preferences: true,
        lastLoginAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate JWT tokens (include tenant id)
    const tenantId = await this.getTenantIdForUser(user.id);
    const tokens = await this.generateTokens(
      user.id,
      user.email,
      user.role,
      tenantId,
    );

    // Create session
    await this.createSession(user.id, tokens.accessToken);

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    this.logger.log(`User logged in successfully: ${user.email}`);

    // Remove password hash from response
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...rest } = user;
    const responseUser = { ...rest, tenantId: tenantId ?? null };

    return {
      user: responseUser,
      ...tokens,
    };
  }

  async logout(userId: string, sessionToken: string): Promise<void> {
    try {
      // Invalidate session
      await this.prisma.session.deleteMany({
        where: {
          userId,
          sessionToken: AuthService.hashToken(sessionToken),
        },
      });

      // Best-effort: add token jti to blocklist until its natural expiry
      try {
        const decodedAny: unknown = this.jwtService.decode(sessionToken);
        let jti: string | undefined;
        let exp: number | undefined;
        if (decodedAny !== null && typeof decodedAny === 'object') {
          const obj: Record<string, unknown> = decodedAny as Record<
            string,
            unknown
          >;
          if (typeof obj['jti'] === 'string') jti = obj['jti'];
          if (typeof obj['exp'] === 'number') exp = obj['exp'];
        }
        const nowSec = Math.floor(Date.now() / 1000);
        const ttlSec = exp && exp > nowSec ? exp - nowSec : 0;
        if (jti && ttlSec > 0) {
          await this.tokenBlocklist.block(jti, ttlSec);
        }
      } catch {
        // ignore blocklist failure
      }

      this.logger.log(`User logged out successfully: ${userId}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Logout failed: ${errorMessage}`);
      throw new BadRequestException('Logout failed');
    }
  }

  async refreshToken(refreshToken: string): Promise<AuthResponse> {
    try {
      // Verify refresh token
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET || 'refresh-secret',
      });

      // Find user
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          preferences: true,
        },
      });

      if (!user || !user.isActive) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Generate new tokens (include tenant id)
      const tenantId = await this.getTenantIdForUser(user.id);
      const tokens = await this.generateTokens(
        user.id,
        user.email,
        user.role,
        tenantId,
      );

      // Update session
      await this.createSession(user.id, tokens.accessToken);

      const rest = user;
      return {
        user: { ...rest, tenantId: tenantId ?? null },
        ...tokens,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Token refresh failed: ${errorMessage}`);
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async validateUser(payload: JwtPayload): Promise<ValidatedUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        preferences: true,
      },
    });

    if (!user || !user.isActive) {
      return null;
    }

    const tenantId =
      payload.tenantId ?? (await this.getTenantIdForUser(user.id));
    return { ...user, tenantId: tenantId ?? null };
  }

  private async getTenantIdForUser(
    userId: string,
  ): Promise<string | undefined> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tenantId: true },
    });
    const val: unknown = user?.tenantId ?? null;
    return typeof val === 'string' ? val : undefined;
  }

  private async generateTokens(
    userId: string,
    email: string,
    role: string,
    tenantId?: string | null,
  ) {
    // Compute permsHash for current role
    const normalizedRole: Role = (Object.values(Role) as string[]).includes(
      role,
    )
      ? (role as Role)
      : Role.GUEST;
    const permsHash =
      this.permissionsService.getPermissionsHashForRole(normalizedRole);

    // Compute tokenVersion: fetch from DB if present, else 0
    const versionRow = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true },
    });
    const tokenVersion =
      typeof versionRow?.tokenVersion === 'number'
        ? versionRow.tokenVersion
        : 0;

    const payload: JwtPayload = {
      sub: userId,
      email,
      role,
      ...(typeof tenantId === 'string' ? { tenantId } : {}),
      permsHash,
      tokenVersion,
      type: 'user',
      aud: 'user',
    };

    // inject jti for access token only
    const jti = `${userId}.${Date.now()}.${Math.random().toString(36).slice(2)}`;

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_SECRET || 'secret',
        expiresIn: process.env.JWT_EXPIRES_IN || '15m',
        jwtid: jti,
      }),
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_REFRESH_SECRET || 'refresh-secret',
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
      }),
    ]);

    return {
      accessToken,
      refreshToken,
      expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    };
  }

  private async createSession(
    userId: string,
    sessionToken: string,
  ): Promise<void> {
    // Clean up old sessions (keep only last 5)
    const sessions = await this.prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: 4, // Keep 4, delete the rest
    });

    if (sessions.length > 0) {
      await this.prisma.session.deleteMany({
        where: {
          id: {
            in: sessions.map((s) => s.id),
          },
        },
      });
    }

    // Create new session
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    await this.prisma.session.create({
      data: {
        userId,
        sessionToken: AuthService.hashToken(sessionToken),
        expiresAt,
        metadata: {
          userAgent: 'API', // TODO: Get from request
          loginAt: new Date().toISOString(),
        },
      },
    });
  }

  // Admin-only methods
  async getAllUsers() {
    return await this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        lastLoginAt: true,
        preferences: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getSystemStats() {
    const [totalUsers, activeUsers, totalProjects, totalDocuments] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { isActive: true } }),
        this.prisma.project.count(),
        this.prisma.document.count(),
      ]);

    return {
      totalUsers,
      activeUsers,
      totalProjects,
      totalDocuments,
      systemInfo: {
        version: process.env.APP_VERSION || '1.0.0',
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
      },
    };
  }

  async getUserDashboard(userId: string) {
    const [projectCount, documentCount, recentProjects] = await Promise.all([
      this.prisma.project.count({ where: { userId } }),
      this.prisma.document.count({ where: { userId } }),
      this.prisma.project.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          updatedAt: true,
          documentCount: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
    ]);

    // Calculate total storage used
    const storageResult = await this.prisma.document.aggregate({
      where: { userId },
      _sum: {
        fileSizeBytes: true,
      },
    });

    const storageUsed = Number(storageResult._sum.fileSizeBytes || 0);

    return {
      projectCount,
      documentCount,
      storageUsed,
      recentActivity: recentProjects.map((project) => ({
        type: 'project',
        id: project.id,
        name: project.name,
        updatedAt: project.updatedAt,
        documentCount: project.documentCount,
      })),
    };
  }
}
