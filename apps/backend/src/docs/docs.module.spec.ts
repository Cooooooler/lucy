import type { INestApplication } from '@nestjs/common';
import { SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import type { MockInstance } from 'vitest';
import { DocsModule } from './docs.module.js';

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
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('production 环境跳过文档路由注册', () => {
      process.env.NODE_ENV = 'production';
      const app = makeAppMock();
      DocsModule.setup(app as unknown as INestApplication);
      expect(app.use).not.toHaveBeenCalled();
      expect(app.getHttpAdapter).not.toHaveBeenCalled();
    });

    it('非 production 注册 /docs 与 /docs-json', () => {
      process.env.NODE_ENV = 'development';
      const getMock = vi.fn();
      const app = {
        use: vi.fn(),
        getHttpAdapter: vi.fn(() => ({ get: getMock })),
      };
      DocsModule.setup(app as unknown as INestApplication);
      expect(app.use).toHaveBeenCalledWith('/docs', expect.any(Function));
      expect(app.getHttpAdapter).toHaveBeenCalled();
      expect(getMock).toHaveBeenCalledWith('/docs-json', expect.any(Function));
    });
  });
});
