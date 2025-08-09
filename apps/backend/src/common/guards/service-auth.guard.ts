import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class ServiceAuthGuard extends AuthGuard('service-jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
}
