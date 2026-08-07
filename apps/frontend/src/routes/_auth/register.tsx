import { LockOutlined, MailOutlined, UserOutlined } from '@ant-design/icons';
import { ProForm, ProFormText } from '@ant-design/pro-components';
import { useMutation } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { App, Card, Typography } from 'antd';
import { registerApi } from '../../api/auth';

export const Route = createFileRoute('/_auth/register')({
  component: RegisterPage,
});

function RegisterPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const registerMutation = useMutation({
    mutationFn: (values: {
      username: string;
      email: string;
      password: string;
    }) => registerApi(values),
  });

  return (
    <Card className="w-full max-w-sm">
      <Typography.Title level={3} className="mb-6 text-center">
        注册
      </Typography.Title>
      <ProForm
        onFinish={async (values) => {
          try {
            await registerMutation.mutateAsync({
              username: values.username as string,
              email: values.email as string,
              password: values.password as string,
            });
            message.success('注册成功，请登录');
            navigate({ to: '/login' });
          } catch (err) {
            message.error(err instanceof Error ? err.message : '注册失败');
          }
        }}
        submitter={{
          submitButtonProps: { loading: registerMutation.isPending },
          searchConfig: { submitText: '注册' },
        }}
      >
        <ProFormText
          name="username"
          label="用户名"
          placeholder="请输入用户名"
          rules={[
            { required: true },
            {
              pattern: /^[a-zA-Z0-9_-]+$/,
              message: '仅支持字母数字下划线连字符',
            },
          ]}
          fieldProps={{ prefix: <UserOutlined /> }}
        />
        <ProFormText
          name="email"
          label="邮箱"
          placeholder="请输入邮箱"
          rules={[{ required: true, type: 'email' }]}
          fieldProps={{ prefix: <MailOutlined /> }}
        />
        <ProFormText.Password
          name="password"
          label="密码"
          placeholder="请输入密码"
          rules={[{ required: true }]}
          fieldProps={{ prefix: <LockOutlined /> }}
        />
        <ProFormText.Password
          name="confirm"
          label="确认密码"
          placeholder="请再次输入密码"
          rules={[
            { required: true },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error('两次输入的密码不一致'));
              },
            }),
          ]}
          fieldProps={{ prefix: <LockOutlined /> }}
        />
      </ProForm>
      <div className="mt-4 text-center text-sm text-slate-400">
        已有账号？
        <Link to="/login" className="text-blue-500 hover:text-blue-400">
          去登录
        </Link>
      </div>
    </Card>
  );
}
