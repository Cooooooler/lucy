import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { App } from 'antd';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { loginApi } from '@/api/auth';
import { GlassButton } from '@/components/ui/glass-button';
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from '@/components/ui/glass-card.tsx';
import { GlassInput } from '@/components/ui/glass-input.tsx';
import { applyTokens, login } from '@/stores/auth';

const formSchema = z.object({
  account: z.string().trim().min(1, '请输入用户名或邮箱'),
  password: z.string().min(1, '请输入密码'),
});

type LoginFormValues = z.infer<typeof formSchema>;

export const Route = createFileRoute('/_auth/login')({
  component: LoginPageBlock,
});

function LoginPageBlock() {
  const [showPassword, setShowPassword] = useState(false);
  const { message } = App.useApp();
  const navigate = useNavigate();
  const loginMutation = useMutation({
    mutationFn: (values: LoginFormValues) => loginApi(values),
  });
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      account: '',
      password: '',
    },
  });

  const onSubmit = async (values: LoginFormValues) => {
    try {
      const result = await loginMutation.mutateAsync(values);
      login(result.user);
      // 长效 token 已写入 HttpOnly cookie，短效 access token 由登录直接返回
      applyTokens(result.accessToken);
      message.success('登录成功');
      navigate({ to: '/' });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '登录失败');
    }
  };

  return (
    <GlassCard className="w-full max-w-md">
      <GlassCardHeader className="space-y-2 p-4 text-center sm:p-6">
        <div className="mb-2 flex justify-center">
          <div className="rounded-lg bg-linear-to-br from-cyan-400 to-blue-500 p-2">
            <LogIn className="h-6 w-6 text-white" />
          </div>
        </div>
        <GlassCardTitle className="text-xl">欢迎回来</GlassCardTitle>
        <GlassCardDescription>登录你的账户以继续</GlassCardDescription>
      </GlassCardHeader>

      <GlassCardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="space-y-5"
        >
          {/* Account Input */}
          <div className="space-y-2">
            <label htmlFor="account" className="text-white/80">
              用户名或邮箱
            </label>
            <Controller
              name="account"
              control={control}
              render={({ field, fieldState }) => (
                <>
                  <GlassInput
                    {...field}
                    id="account"
                    type="text"
                    placeholder="用户名或邮箱"
                    autoComplete="username"
                    aria-invalid={fieldState.invalid}
                    className="bg-white/5"
                  />
                  {fieldState.error && (
                    <p className="text-xs text-red-400">
                      {fieldState.error.message}
                    </p>
                  )}
                </>
              )}
            />
          </div>

          {/* Password Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="text-white/80">
                密码
              </label>
              <a
                href="#"
                className="text-xs text-cyan-400 transition-colors hover:text-cyan-300"
              >
                忘记密码？
              </a>
            </div>
            <Controller
              name="password"
              control={control}
              render={({ field, fieldState }) => (
                <>
                  <div className="relative">
                    <GlassInput
                      {...field}
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      aria-invalid={fieldState.invalid}
                      className="bg-white/5 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute top-1/2 right-3 -translate-y-1/2 text-white/40 transition-colors hover:text-white/60"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {fieldState.error && (
                    <p className="text-xs text-red-400">
                      {fieldState.error.message}
                    </p>
                  )}
                </>
              )}
            />
          </div>
          {/* Submit Button */}
          <GlassButton
            type="submit"
            variant="primary"
            className="w-full"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                登录中...
              </>
            ) : (
              <>
                <LogIn className="mr-2 h-4 w-4" />
                登录
              </>
            )}
          </GlassButton>

          {/* Divider */}
          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/10" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-black/40 px-2 text-white/40">
                或使用以下方式登录
              </span>
            </div>
          </div>

          {/* Social Login Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <GlassButton type="button" variant="outline" className="w-full">
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Google
            </GlassButton>
            <GlassButton type="button" variant="outline" className="w-full">
              <svg
                className="mr-2 h-4 w-4"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v 3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              GitHub
            </GlassButton>
          </div>

          {/* Sign Up Link */}
          <p className="text-center text-sm text-white/60">
            还没有账号？{' '}
            <Link
              to="/register"
              className="font-medium text-cyan-400 transition-colors hover:text-cyan-300"
            >
              立即注册
            </Link>
          </p>
        </form>
      </GlassCardContent>
    </GlassCard>
  );
}
