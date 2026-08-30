import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { App } from 'antd';
import { Check, Eye, EyeOff, UserPlus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { registerApi } from '@/api/auth';
import { GlassButton } from '@/components/ui/glass-button';
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from '@/components/ui/glass-card';
import { GlassCheckbox } from '@/components/ui/glass-checkbox';
import { GlassInput } from '@/components/ui/glass-input';

interface ValidationRules {
  minLength: boolean;
  hasUpperCase: boolean;
  hasLowerCase: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
}

const formSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, '用户名至少 3 个字符')
      .max(50, '用户名最多 50 个字符')
      .regex(/^[a-zA-Z0-9_-]+$/, '用户名仅支持字母数字下划线连字符'),
    email: z
      .string()
      .trim()
      .min(1, '请输入邮箱')
      .pipe(z.email('请输入有效的邮箱地址')),
    password: z
      .string()
      .min(8, '密码至少 8 位')
      .max(72, '密码最多 72 位')
      .regex(/[A-Z]/, '需包含大写字母')
      .regex(/[a-z]/, '需包含小写字母')
      .regex(/\d/, '需包含数字')
      .regex(/[!@#$%^&*(),.?":{}|<>]/, '需包含特殊字符'),
    confirmPassword: z.string(),
    agreeToTerms: z.boolean().refine((v) => v, '请阅读并同意条款'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: '两次输入密码不一致',
    path: ['confirmPassword'],
  });

type RegisterFormValues = z.infer<typeof formSchema>;

export const Route = createFileRoute('/_auth/register')({
  component: SignupPageBlock,
});

function SignupPageBlock() {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const { message } = App.useApp();
  const navigate = useNavigate();
  const registerMutation = useMutation({
    mutationFn: (values: RegisterFormValues) =>
      registerApi({
        username: values.username,
        email: values.email,
        password: values.password,
      }),
  });
  const {
    control,
    handleSubmit,
    watch,
    formState: { isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
      agreeToTerms: false,
    },
  });

  const password = watch('password');
  const confirmPassword = watch('confirmPassword');
  const agreeToTerms = watch('agreeToTerms');

  const validatePassword = (pwd: string): ValidationRules => ({
    minLength: pwd.length >= 8,
    hasUpperCase: /[A-Z]/.test(pwd),
    hasLowerCase: /[a-z]/.test(pwd),
    hasNumber: /\d/.test(pwd),
    hasSpecial: /[!@#$%^&*(),.?":{}|<>]/.test(pwd),
  });

  const validation = useMemo(() => validatePassword(password), [password]);
  const isPasswordValid = Object.values(validation).every(Boolean);
  const passwordsMatch = password === confirmPassword && password.length > 0;

  const onSubmit = async (values: RegisterFormValues) => {
    try {
      await registerMutation.mutateAsync(values);
      message.success('注册成功，请登录');
      navigate({ to: '/login' });
    } catch (err) {
      message.error(err instanceof Error ? err.message : '注册失败');
    }
  };

  return (
    <GlassCard className="w-full max-w-md">
      <GlassCardHeader className="space-y-2 p-4 text-center sm:p-6">
        <div className="mb-2 flex justify-center">
          <div className="rounded-lg bg-linear-to-br from-green-400 to-emerald-500 p-2">
            <UserPlus className="h-6 w-6 text-white" />
          </div>
        </div>
        <GlassCardTitle className="text-2xl">创建账号</GlassCardTitle>
        <GlassCardDescription>立即加入我们，开始使用</GlassCardDescription>
      </GlassCardHeader>

      <GlassCardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="space-y-4"
        >
          {/* Username Input */}
          <div className="space-y-2">
            <label htmlFor="username" className="text-white/80">
              用户名
            </label>
            <Controller
              name="username"
              control={control}
              render={({ field, fieldState }) => (
                <>
                  <GlassInput
                    {...field}
                    id="username"
                    type="text"
                    placeholder="lucy"
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

          {/* Email Input */}
          <div className="space-y-2">
            <label htmlFor="email" className="text-white/80">
              邮箱地址
            </label>
            <Controller
              name="email"
              control={control}
              render={({ field, fieldState }) => (
                <>
                  <GlassInput
                    {...field}
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
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
            <label htmlFor="password" className="text-white/80">
              密码
            </label>
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
                      autoComplete="new-password"
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
            {/* Password Strength Indicator */}
            {password.length > 0 && (
              <div className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-3">
                <p className="mb-2 text-xs font-medium text-white/60">
                  密码要求：
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { key: 'minLength', label: '至少 8 个字符' },
                    { key: 'hasUpperCase', label: '大写字母' },
                    { key: 'hasLowerCase', label: '小写字母' },
                    { key: 'hasNumber', label: '数字' },
                    { key: 'hasSpecial', label: '特殊字符' },
                  ].map((rule) => (
                    <div key={rule.key} className="flex items-center gap-1.5">
                      <div
                        className={`h-1.5 w-1.5 rounded-full transition-colors ${
                          validation[rule.key as keyof ValidationRules]
                            ? 'bg-green-400'
                            : 'bg-white/20'
                        }`}
                      />
                      <span
                        className={`text-xs transition-colors ${
                          validation[rule.key as keyof ValidationRules]
                            ? 'text-green-400'
                            : 'text-white/40'
                        }`}
                      >
                        {rule.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Confirm Password */}
          <div className="space-y-2">
            <label htmlFor="confirmPassword" className="text-white/80">
              确认密码
            </label>
            <Controller
              name="confirmPassword"
              control={control}
              render={({ field, fieldState }) => (
                <>
                  <div className="relative">
                    <GlassInput
                      {...field}
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      aria-invalid={fieldState.invalid}
                      disabled={!isPasswordValid}
                      className="bg-white/5 pr-10 disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowConfirmPassword(!showConfirmPassword)
                      }
                      className="absolute top-1/2 right-3 -translate-y-1/2 text-white/40 transition-colors hover:text-white/60"
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {isPasswordValid &&
                    confirmPassword.length > 0 &&
                    (passwordsMatch ? (
                      <div className="flex items-center gap-2 text-xs text-green-400">
                        <Check className="h-3 w-3" /> 两次密码一致
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-red-400">
                        <X className="h-3 w-3" /> 两次输入密码不一致
                      </div>
                    ))}
                </>
              )}
            />
          </div>

          {/* Terms Agreement */}
          <div className="space-y-2 pt-2">
            <Controller
              name="agreeToTerms"
              control={control}
              render={({ field, fieldState }) => (
                <>
                  <div className="flex items-start gap-3">
                    <div className="pt-1">
                      <GlassCheckbox
                        id="terms"
                        checked={field.value}
                        onCheckedChange={(checked) =>
                          field.onChange(checked === true)
                        }
                      />
                    </div>
                    <label
                      htmlFor="terms"
                      className="flex flex-1 cursor-pointer flex-wrap gap-x-1 gap-y-0.5 text-sm leading-relaxed font-normal text-white/70"
                    >
                      <span className="whitespace-nowrap">
                        我已阅读并同意{' '}
                        <button
                          type="button"
                          className="text-cyan-400 transition-colors hover:text-cyan-300"
                        >
                          《服务条款》
                        </button>
                      </span>
                      <span className="whitespace-nowrap">
                        和{' '}
                        <button
                          type="button"
                          className="text-cyan-400 transition-colors hover:text-cyan-300"
                        >
                          《隐私政策》
                        </button>
                      </span>
                    </label>
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
            className="mt-6 w-full"
            disabled={
              isSubmitting ||
              !isPasswordValid ||
              !passwordsMatch ||
              !agreeToTerms
            }
          >
            {isSubmitting ? (
              <>
                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                注册中...
              </>
            ) : (
              <>
                <UserPlus className="mr-2 h-4 w-4" />
                注册
              </>
            )}
          </GlassButton>

          {/* Sign In Link */}
          <p className="text-center text-sm text-white/60">
            已有账号？{' '}
            <Link
              to="/login"
              className="font-medium text-cyan-400 transition-colors hover:text-cyan-300"
            >
              去登录
            </Link>
          </p>
        </form>
      </GlassCardContent>
    </GlassCard>
  );
}
