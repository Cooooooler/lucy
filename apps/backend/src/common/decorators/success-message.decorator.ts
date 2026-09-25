import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

/** 成功文案元数据键，由 ApiResponseInterceptor 读取 */
export const SUCCESS_MESSAGE_KEY = 'success_message';

/**
 * 动态成功文案：入参为已序列化的响应数据与当前请求，
 * 用于「启用/禁用」「设为公开/私有」这类随载荷变化的提示。
 */
export type SuccessMessageResolver = (data: unknown, req: Request) => string;

/**
 * 标注路由成功响应信封里的 `message`。整体语义：
 * 「本次操作对用户说了什么」，由后端单方面决定，前端只负责展示。
 *
 * 优先级：本装饰器（静态字符串或解析器返回值）> 按 HTTP 方法的兜底文案 > 'ok'。
 * 未标注的 GET 路由仍为 'ok'（查询类不产生用户提示）；未标注的变更路由按方法兜底
 * （POST→操作成功、PATCH/PUT→更新成功、DELETE→删除成功），因此不会出现「漏标即无提示」。
 */
export const SuccessMessage = (value: string | SuccessMessageResolver) =>
  SetMetadata(SUCCESS_MESSAGE_KEY, value);
