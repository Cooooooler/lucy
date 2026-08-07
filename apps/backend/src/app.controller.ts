import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service.js';
import { Public } from './common/decorators/public.decorator.js';

@ApiTags('system')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: '健康检查', description: '返回服务运行状态' })
  @ApiResponse({ status: 200, description: '服务正常' })
  getHello(): string {
    return this.appService.getHello();
  }
}
