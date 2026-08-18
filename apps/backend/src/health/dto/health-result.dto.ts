import { ApiProperty } from '@nestjs/swagger';

/** GET /health 响应体：整体状态 + 各组件存活标记（经全局信封包裹为 { code, message, data }） */
export class HealthResultDto {
  @ApiProperty({
    description: '整体状态：ok 或 degraded（任一组件不可用）',
    example: 'ok',
  })
  status: string;

  @ApiProperty({ description: '数据库是否可达', example: true })
  db: boolean;

  @ApiProperty({ description: 'Redis 是否可达', example: true })
  redis: boolean;
}
