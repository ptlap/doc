import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class ServiceJwtStrategy extends PassportStrategy(
  Strategy,
  'service-jwt',
) {
  constructor(private readonly configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>(
        'JWT_SERVICE_SECRET',
        configService.get<string>('JWT_SECRET', 'secret'),
      ),
      audience: 'service',
    });
  }

  async validate(payload: JwtPayload): Promise<{ sub: string; aud?: string }> {
    const type: unknown = (payload as { type?: unknown }).type;
    const aud: unknown = (payload as { aud?: unknown }).aud;
    if (type !== 'service') {
      throw new UnauthorizedException('Invalid token type');
    }
    if (aud !== 'service') {
      throw new UnauthorizedException('Invalid audience');
    }
    // For service tokens, we may not have a user; return minimal principal
    const subVal: unknown = (payload as { sub?: unknown }).sub;
    if (typeof subVal !== 'string' || subVal.length === 0) {
      throw new UnauthorizedException('Invalid subject');
    }
    // tiny await to satisfy lint rule while keeping signature consistent
    await Promise.resolve();
    return { sub: subVal, aud: 'service' };
  }
}
