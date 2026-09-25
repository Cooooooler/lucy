import { BadRequestException, Param, ParseUUIDPipe } from '@nestjs/common';

/**
 * 路径 UUID 参数的统一出口：默认 `ParseUUIDPipe` 的失败文案是英文
 * （`Validation failed (uuid is expected)`），前端只展示后端文案，
 * 故这里就给出可读中文。所有控制器的路径 id 参数都用它，
 * 不要直接用 `@Param('id', ParseUUIDPipe)`。
 *
 * 用法：`get(@UUIDParam('id') id: string)`。
 */
export function UUIDParam(property: string): ParameterDecorator {
  return Param(
    property,
    new ParseUUIDPipe({
      exceptionFactory: () => new BadRequestException('链接地址不正确'),
    }),
  );
}
