import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from '../auth.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { PrismaService } from '../../../common/services/prisma.service';
import { TokenBlocklistService } from '../../../common/services/token-blocklist.service';
import { PermissionsService } from '../../../common/services/permissions.service';
import { Role } from '../../../common/enums/role.enum';

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
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
    private readonly tokenBlocklist: TokenBlocklistService,
    private readonly permissionsService: PermissionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'secret',
    });
  }

  async validate(payload: JwtPayload): Promise<ValidatedUser> {
    // 1) Deny if jti is blocked
    const maybeJti: unknown = (payload as { jti?: unknown }).jti;
    const blocked = await this.tokenBlocklist.isBlocked(maybeJti);
    if (blocked) {
      throw new UnauthorizedException('Token revoked');
    }

    // 2) Validate tokenVersion gate (optional column)
    const versionRows = await this.prisma.$queryRaw<
      Array<{ token_version?: number }>
    >`
      SELECT token_version FROM users WHERE id = ${payload.sub} LIMIT 1
    `;
    const currentVersion =
      Array.isArray(versionRows) &&
      versionRows.length > 0 &&
      typeof versionRows[0]?.token_version === 'number'
        ? versionRows[0]?.token_version
        : 0;
    if (
      typeof payload.tokenVersion === 'number' &&
      payload.tokenVersion !== currentVersion
    ) {
      throw new UnauthorizedException('Token version outdated');
    }

    // 3) Validate permissions hash for quick drift detection
    const normalizedRole: Role = (Object.values(Role) as string[]).includes(
      payload.role,
    )
      ? (payload.role as Role)
      : Role.GUEST;
    const expectedPermsHash =
      this.permissionsService.getPermissionsHashForRole(normalizedRole);
    if (payload.permsHash && payload.permsHash !== expectedPermsHash) {
      throw new UnauthorizedException('Permissions changed');
    }

    const user = await this.authService.validateUser(payload);
    if (!user) {
      throw new UnauthorizedException('Invalid token');
    }
    // Ensure tenantId from token is propagated if user has it
    const result: ValidatedUser = {
      ...user,
      tenantId: (payload as { tenantId?: string }).tenantId ?? user.tenantId,
    };
    return result;
  }
}
