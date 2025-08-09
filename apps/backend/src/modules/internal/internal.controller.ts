import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Headers,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ServiceAuthGuard } from '../../common/guards/service-auth.guard';

@ApiTags('Internal')
@ApiBearerAuth()
@UseGuards(ServiceAuthGuard)
@Controller('internal')
export class InternalController {
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Post('tasks')
  enqueueTask(
    @Body() body: Record<string, unknown>,
    @Headers('x-request-id') reqId?: string,
  ) {
    return { accepted: true, id: reqId ?? `job-${Date.now()}`, payload: body };
  }
}
