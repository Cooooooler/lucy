import { DocsModule } from '@/docs/docs.module.js';
import type { INestApplication } from '@nestjs/common';
import { SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { MockInstance } from 'vitest';

const makeAppMock = () => ({
  use: vi.fn(),
  getHttpAdapter: vi.fn(() => ({ get: vi.fn() })),
});

const stubDocument = {
  openapi: '3.0.0',
  info: { title: 'Lucy API', version: '1.0' },
  paths: {},
} as OpenAPIObject;

describe('DocsModule', () => {
  let createDocumentSpy: MockInstance<typeof SwaggerModule.createDocument>;

  beforeEach(() => {
    createDocumentSpy = vi
      .spyOn(SwaggerModule, 'createDocument')
      .mockReturnValue(stubDocument);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildDocument', () => {
    it('使用 Lucy API 标题与 Bearer 鉴权构建 OpenAPI 文档', () => {
      const app = makeAppMock();
      DocsModule.buildDocument(app as unknown as INestApplication);
      const config = createDocumentSpy.mock.calls[0][1];
      expect(config.info.title).toBe('Lucy API');
      expect(config.info.version).toBe('1.0');
      expect(config.components?.securitySchemes).toBeDefined();
    });
  });

  describe('setup', () => {
    // nodeEnv 由调用方（main.ts 经 ConfigService）传入，测试直接用入参驱动，
    // 不再改写进程级 process.env
    it('production 环境跳过文档路由注册', () => {
      const app = makeAppMock();
      DocsModule.setup(app as unknown as INestApplication, 'production');
      expect(app.use).not.toHaveBeenCalled();
      expect(app.getHttpAdapter).not.toHaveBeenCalled();
    });

    it('非 production 注册 /docs 与 /docs-json', () => {
      const getMock = vi.fn();
      const app = {
        use: vi.fn(),
        getHttpAdapter: vi.fn(() => ({ get: getMock })),
      };
      DocsModule.setup(app as unknown as INestApplication, 'development');
      expect(app.use).toHaveBeenCalledWith('/docs', expect.any(Function));
      expect(app.getHttpAdapter).toHaveBeenCalled();
      expect(getMock).toHaveBeenCalledWith('/docs-json', expect.any(Function));
    });
  });
});
