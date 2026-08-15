import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { router } from '../router';
import { handleSessionExpired, logout } from '../stores/auth';
import { AuthProvider } from './AuthProvider';

vi.mock('../router', () => ({ router: { navigate: vi.fn() } }));

const navigateMock = vi.mocked(router.navigate);

describe('AuthProvider', () => {
  beforeEach(() => {
    logout();
  });

  it('渲染子节点', () => {
    render(
      <AuthProvider>
        <div>hello</div>
      </AuthProvider>,
    );
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('会话过期时跳转登录页', () => {
    render(
      <AuthProvider>
        <div>hello</div>
      </AuthProvider>,
    );
    act(() => {
      handleSessionExpired();
    });
    expect(navigateMock).toHaveBeenCalledWith({ to: '/login' });
  });
});
