import { login } from '@/stores/auth.ts';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { ProForm, ProFormText } from '@ant-design/pro-components';
import { loginApi } from '@api/auth.ts';
import { GlassSurface, ParticleText } from '@components';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { App } from 'antd';

export const Route = createFileRoute('/_auth/login')({
  component: LoginPage,
});

function LoginPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const loginMutation = useMutation({
    mutationFn: (values: { account: string; password: string }) =>
      loginApi(values),
  });

  return (
    <GlassSurface
      width={'40%'}
      height={'auto'}
      displace={0.5}
      distortionScale={-180}
      redOffset={0}
      greenOffset={10}
      blueOffset={20}
      brightness={50}
      opacity={0.93}
      mixBlendMode="screen"
      className={'max-w-xl min-w-xs'}
    >
      <div className={'flex w-full flex-col'}>
        <ParticleText
          text="Welcome To Lucy"
          fontWeight={500}
          particleSize={4}
          density={2}
          scatter={190}
          gatherDuration={500}
          stagger={0}
          repelRadius={200}
          pointerRepel={90}
          idleDrift={2}
          style={{ height: 80, minHeight: 0, width: '100%' }}
        />
        <div className={'flex w-full flex-col items-center gap-4'}>
          <ProForm
            onFinish={async (values) => {
              try {
                const data = await loginMutation.mutateAsync({
                  account: values.account as string,
                  password: values.password as string,
                });
                login(data.user, data.accessToken, data.refreshToken);
                void message.success('登录成功');
                await navigate({ to: '/' });
              } catch (err) {
                void message.error(
                  err instanceof Error ? err.message : '登录失败',
                );
              }
            }}
            submitter={{
              submitButtonProps: { loading: loginMutation.isPending },
              searchConfig: { submitText: '登录' },
            }}
          >
            <ProFormText
              name="account"
              label="用户名/邮箱"
              placeholder="请输入用户名或邮箱"
              rules={[{ required: true }]}
              fieldProps={{ prefix: <UserOutlined /> }}
            />
            <ProFormText.Password
              name="password"
              label="密码"
              placeholder="请输入密码"
              rules={[{ required: true }]}
              fieldProps={{ prefix: <LockOutlined /> }}
            />
          </ProForm>
          <div className="mt-4 text-center text-sm text-slate-400">
            还没有账号？
            <Link to="/register" className="text-blue-500 hover:text-blue-400">
              立即注册
            </Link>
          </div>
        </div>
      </div>
    </GlassSurface>
  );
}
