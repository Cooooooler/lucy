import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeUser } from '../test/fixtures';
import { loginApi, logoutApi, registerApi } from './auth';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock('./client', () => ({
  http: { post: mocks.post },
}));

const user = makeUser();

describe('api/auth', () => {
  beforeEach(() => {
    mocks.post.mockReset();
  });

  it('loginApi 调用 auth/login 并返回结果', async () => {
    const data = { user, accessToken: 'at', refreshToken: 'rt' };
    mocks.post.mockReturnValueOnce({
      json: vi.fn().mockResolvedValueOnce(data),
    });
    const result = await loginApi({ account: 'alice', password: 'secret' });
    expect(mocks.post).toHaveBeenCalledWith(
      'auth/login',
      { account: 'alice', password: 'secret' },
      { extra: { skipAuthRefresh: true } },
    );
    expect(result).toEqual(data);
  });

  it('registerApi 调用 auth/register 并返回用户', async () => {
    const input = {
      username: 'bob',
      email: 'bob@example.com',
      password: 'secret',
    };
    mocks.post.mockReturnValueOnce({
      json: vi.fn().mockResolvedValueOnce(user),
    });
    const result = await registerApi(input);
    expect(mocks.post).toHaveBeenCalledWith('auth/register', input, {
      extra: { skipAuthRefresh: true },
    });
    expect(result).toEqual(user);
  });

  it('logoutApi 调用 auth/logout', async () => {
    mocks.post.mockReturnValueOnce({
      json: vi.fn().mockResolvedValueOnce(null),
    });
    const result = await logoutApi();
    expect(mocks.post).toHaveBeenCalledWith('auth/logout');
    expect(result).toBeNull();
  });
});
