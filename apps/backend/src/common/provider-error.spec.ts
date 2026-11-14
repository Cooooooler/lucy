import {
  BadGatewayException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { BaseUrlBlockedError } from './base-url-blocked.error.js';
import {
  blockedErrorMessage,
  providerErrorKind,
  providerErrorMessage,
} from './provider-error.js';

describe('providerErrorKind', () => {
  it('按 status 归类：401/403 无权限、404 接口不存在、429 限流、5xx 服务异常', () => {
    expect(providerErrorKind({ status: 401 })).toBe('unauthorized');
    expect(providerErrorKind({ status: 403 })).toBe('unauthorized');
    expect(providerErrorKind({ status: 404 })).toBe('notFound');
    expect(providerErrorKind({ status: 429 })).toBe('rateLimited');
    expect(providerErrorKind({ status: 500 })).toBe('serverError');
    expect(providerErrorKind({ status: 503 })).toBe('serverError');
  });

  it('网络类错误按文案归类', () => {
    expect(
      providerErrorKind(new Error('getaddrinfo ENOTFOUND api.example.com')),
    ).toBe('network');
    expect(providerErrorKind(new Error('fetch failed'))).toBe('network');
  });

  it('Ollama ResponseError 用 status_code 承载状态（429/5xx 也要归类）', () => {
    // ollama@0.6.3 的 ResponseError 只有 status_code，没有 status；
    // 只嗅探 status 会让 Ollama 的限流/服务异常全部回落「生成失败」
    expect(
      providerErrorKind(
        Object.assign(new Error('ollama 429'), { status_code: 429 }),
      ),
    ).toBe('rateLimited');
    expect(
      providerErrorKind(
        Object.assign(new Error('ollama 500'), { status_code: 500 }),
      ),
    ).toBe('serverError');
    expect(providerErrorKind({ statusCode: 404 })).toBe('notFound');
  });

  it('Nest HttpException 不参与供应商归类（应用内拒绝会带 status）', () => {
    // 404/401/502/503 的 HttpException 都带 status，误判会把「会话不存在」
    // 报成「接口或模型不存在，请检查 Base URL 与模型名」
    expect(providerErrorKind(new NotFoundException())).toBeNull();
    expect(providerErrorKind(new UnauthorizedException())).toBeNull();
    expect(providerErrorKind(new BadGatewayException())).toBeNull();
    expect(providerErrorKind(new ServiceUnavailableException())).toBeNull();
    expect(providerErrorMessage(new NotFoundException())).toBeNull();
  });

  it('未知错误返回 null（由调用方兜底），文案查表同样为 null', () => {
    expect(providerErrorKind(new Error('boom'))).toBeNull();
    expect(providerErrorKind(null)).toBeNull();
    expect(providerErrorMessage(new Error('boom'))).toBeNull();
  });

  it('文案可执行且与连接测试一致', () => {
    expect(providerErrorMessage({ status: 404 })).toBe(
      '接口或模型不存在，请检查 Base URL 与模型名',
    );
    expect(providerErrorMessage({ status: 429 })).toBe(
      '供应商限流，请稍后重试',
    );
  });
});

describe('blockedErrorMessage', () => {
  it('直接抛出的守卫错误返回原文案', () => {
    expect(blockedErrorMessage(new BaseUrlBlockedError('受限地址'))).toBe(
      '受限地址',
    );
  });

  it('沿 SDK 包装错误的 cause 链取原文案（可多层）', () => {
    const root = new BaseUrlBlockedError('API Base URL 返回重定向');
    const sdk = new Error('APIConnectionError', { cause: root });
    const langchain = new Error('wrapped', { cause: sdk });
    expect(blockedErrorMessage(langchain)).toBe('API Base URL 返回重定向');
  });

  it('不相关错误返回 null', () => {
    expect(blockedErrorMessage(new Error('boom'))).toBeNull();
    expect(blockedErrorMessage(null)).toBeNull();
  });
});
