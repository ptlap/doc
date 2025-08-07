import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { publicDecorator } from './common/decorators/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @publicDecorator()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @publicDecorator()
  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
