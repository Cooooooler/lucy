import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 连接测试结果。
 *
 * `ok=false` 也用 200 返回（这是「测试的结论」，不是请求失败），前端据 `ok` 决定提示样式；
 * `message` 只含面向用户的友好文案，不含主机/端口/原始堆栈等基础设施细节。
 */
export class ModelProviderTestResultDto {
  @ApiProperty({ description: '是否连通', example: true })
  ok: boolean;

  @ApiProperty({
    description: '结果说明（成功/失败原因）',
    example: '连接成功',
  })
  message: string;

  @ApiPropertyOptional({
    description: '耗时（毫秒）；未真正发起调用（如不支持的类型）时为 null',
    type: Number,
    nullable: true,
    example: 320,
  })
  latencyMs: number | null;

  @ApiPropertyOptional({
    description: '补充信息（如回复片段、向量维度）；无则为 null',
    type: String,
    nullable: true,
    example: '回复：你好',
  })
  detail: string | null;
}
