import { ErrorCode } from '@lucy/shared';
import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  AllExceptionsFilter,
  readableErrorMessage,
} from './all-exceptions.filter.js';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  const json = vi.fn();
  const res = { status: vi.fn().mockReturnValue({ json }) };
  const req = { method: 'GET', url: '/x', id: 'req-1' };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;

  beforeEach(() => {
    vi.clearAllMocks();
    const cls = {
      isActive: () => false,
      get: vi.fn(),
    } as unknown as ClsService;
    filter = new AllExceptionsFilter(cls);
  });

  it('普通 HttpException 返回 status + {code,message,data:null}', () => {
    filter.catch(new HttpException('boom', HttpStatus.BAD_REQUEST), host);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({
      code: HttpStatus.BAD_REQUEST,
      message: 'boom',
      data: null,
    });
  });

  it('HttpException 携带自定义 code 时使用该 code', () => {
    filter.catch(
      new HttpException(
        { code: ErrorCode.AI_CONVERSATION_BUSY, message: '会话繁忙' },
        HttpStatus.CONFLICT,
      ),
      host,
    );
    expect(json).toHaveBeenCalledWith({
      code: ErrorCode.AI_CONVERSATION_BUSY,
      message: '会话繁忙',
      data: null,
    });
  });

  it('HttpException message 为数组时取第一项', () => {
    filter.catch(
      new HttpException(
        { code: 400, message: ['第一个', '第二个'] },
        HttpStatus.BAD_REQUEST,
      ),
      host,
    );
    expect(json).toHaveBeenCalledWith({
      code: 400,
      message: '第一个',
      data: null,
    });
  });

  it('框架英文默认串按状态归一为中文', () => {
    filter.catch(
      new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED),
      host,
    );
    expect(json).toHaveBeenCalledWith({
      code: HttpStatus.UNAUTHORIZED,
      message: '未登录或登录已过期',
      data: null,
    });
  });

  it('非 HttpException 返回 500 + ErrorCode.INTERNAL', () => {
    filter.catch(new Error('oops'), host);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      code: ErrorCode.INTERNAL,
      message: '服务器内部错误',
      data: null,
    });
  });
});

describe('readableErrorMessage', () => {
  it.each([
    ['Unauthorized', 401, '未登录或登录已过期'],
    ['Forbidden', 403, '无权限访问'],
    ['Not Found', 404, '请求的资源不存在'],
    ['Too Many Requests', 429, '请求过于频繁，请稍后再试'],
    ['Internal Server Error', 500, '服务器内部错误'],
    ['Validation failed (uuid is expected)', 400, '请求参数有误'],
    ['The value passed as UUID is not a string', 400, '请求参数有误'],
    ['File too large', 413, '请求内容过大'],
    ['Too many files', 400, '请求参数有误'],
    ['Unexpected field', 400, '请求参数有误'],
    ['Multipart: Boundary not found', 400, '请求参数有误'],
  ])('框架英文「%s」按状态 %i 归一', (raw, status, expected) => {
    expect(readableErrorMessage(raw, status)).toBe(expected);
  });

  it('Cannot GET /x 翻译成资源不存在', () => {
    expect(readableErrorMessage('Cannot GET /nope', 404)).toBe(
      '请求的资源不存在',
    );
  });

  it('业务中文原样透出', () => {
    expect(readableErrorMessage('用户名或密码错误', 401)).toBe(
      '用户名或密码错误',
    );
  });

  it('未收录的英文不动（等业务侧逐案改）', () => {
    expect(readableErrorMessage('Something custom', 400)).toBe(
      'Something custom',
    );
  });

  it('空串回退状态兜底', () => {
    expect(readableErrorMessage('   ', 400)).toBe('请求参数有误');
    expect(readableErrorMessage('', 418)).toBe('请求失败');
  });
});
