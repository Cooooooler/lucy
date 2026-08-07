import { ErrorCode } from '@lucy/shared';
import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  const json = vi.fn();
  const res = { status: vi.fn().mockReturnValue({ json }) };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;

  beforeEach(() => {
    vi.clearAllMocks();
    filter = new AllExceptionsFilter();
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
        { code: ErrorCode.INVALID_CREDENTIALS, message: '密码错误' },
        HttpStatus.UNAUTHORIZED,
      ),
      host,
    );
    expect(json).toHaveBeenCalledWith({
      code: ErrorCode.INVALID_CREDENTIALS,
      message: '密码错误',
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
