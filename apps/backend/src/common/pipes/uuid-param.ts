import { BadRequestException, Param, ParseUUIDPipe } from '@nestjs/common';
import { INVALID_PATH_PARAM_MESSAGE } from '../messages.js';

/**
 * 路径 UUID 参数的统一出口：默认 `ParseUUIDPipe` 的失败文案是英文
 * （`Validation failed (uuid is expected)`），前端只展示后端文案，
 * 故这里就给出可读中文。所有控制器的路径 id 参数都用它，
 * 不要直接用 `@Param('id', ParseUUIDPipe)`。
 *
 * 限定 `version: '4'`：本仓主键是 `gen_random_uuid()`（v4），不限定版本时
 * v1/v3/v5 等任意版本都会被放行，等于放宽了「路径参数是不是本系统的 id」。
 *
 * 用法：`get(@UUIDParam('id') id: string)`。
 */
export function UUIDParam(property: string): ParameterDecorator {
  return Param(
    property,
    new ParseUUIDPipe({
      version: '4',
      exceptionFactory: () =>
        new BadRequestException(INVALID_PATH_PARAM_MESSAGE),
    }),
  );
}
