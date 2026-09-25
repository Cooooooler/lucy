import { BadRequestException } from '@nestjs/common';
import 'reflect-metadata';
import { UUIDParam } from './uuid-param.js';

/** 从参数装饰器绑定的路由元数据里取出 pipe 实例 */
function boundPipe(decorator: ParameterDecorator): {
  transform: (value: unknown) => Promise<string>;
} {
  class Target {
    handler(_id: string) {}
  }
  decorator(Target.prototype, 'handler', 0);
  const args = Reflect.getMetadata(
    '__routeArguments__',
    Target,
    'handler',
  ) as Record<string, { pipes?: unknown[] }>;
  const entry = Object.values(args)[0];
  const [pipe] = (entry?.pipes ?? []) as [
    { transform: (value: unknown) => Promise<string> },
  ];
  return pipe;
}

describe('UUIDParam', () => {
  it('合法 UUID 透过', async () => {
    const pipe = boundPipe(UUIDParam('id'));
    const id = '123e4567-e89b-42d3-a456-426614174000';
    await expect(pipe.transform(id)).resolves.toBe(id);
  });

  // 主键是 gen_random_uuid()（v4）：不限定版本时 v1/v3/v5 也会被放行，
  // 等于把「路径参数是不是本系统的 id」这条判断让了出去
  it('非 v4 的 UUID（v1）被拒', async () => {
    const pipe = boundPipe(UUIDParam('id'));
    await expect(
      pipe.transform('123e4567-e89b-12d3-a456-426614174000'),
    ).rejects.toThrow(new BadRequestException('链接地址不正确'));
  });

  it('非法 UUID 抛中文而非英文默认串', async () => {
    const pipe = boundPipe(UUIDParam('id'));
    await expect(pipe.transform('not-a-uuid')).rejects.toThrow(
      new BadRequestException('链接地址不正确'),
    );
  });
});
