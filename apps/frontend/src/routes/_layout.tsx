import {
  HomeOutlined,
  InfoCircleOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { ProLayout } from '@ant-design/pro-components';
import { useMutation } from '@tanstack/react-query';
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useLocation,
  useNavigate,
} from '@tanstack/react-router';
import { useSelector } from '@tanstack/react-store';
import { Avatar, Dropdown } from 'antd';
import { logoutApi } from '../api/auth';
import { authStore, isLoggedInStore, logout } from '../stores/auth';

export const Route = createFileRoute('/_layout')({
  beforeLoad: ({ context }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: '/login' });
    }
  },
  component: LayoutComponent,
});

const menuData = {
  path: '/',
  routes: [
    { path: '/', name: '首页', icon: <HomeOutlined /> },
    { path: '/about', name: '关于', icon: <InfoCircleOutlined /> },
  ],
};

function LayoutComponent() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isLoggedIn = useSelector(isLoggedInStore);
  const user = useSelector(authStore, (s) => s.user);
  const logoutMutation = useMutation({
    mutationFn: () => logoutApi(),
  });

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // 服务端登出失败不阻塞本地登出
    } finally {
      logout();
      navigate({ to: '/login' });
    }
  };

  const actions = isLoggedIn
    ? [
        <Dropdown
          key="user"
          menu={{
            items: [{ key: 'logout', label: '退出登录' }],
            onClick: ({ key }) => {
              if (key === 'logout') void handleLogout();
            },
          }}
        >
          <div className="flex cursor-pointer items-center gap-2 px-3">
            <Avatar size="small" icon={<UserOutlined />} />
            <span>{user?.username ?? '用户'}</span>
          </div>
        </Dropdown>,
      ]
    : [
        <Link key="login" to="/login" className="px-3">
          登录
        </Link>,
      ];

  return (
    <ProLayout
      title="Lucy"
      logo={<img src="/favicon.svg" alt="Lucy" />}
      layout="side"
      fixedHeader
      fixSiderbar
      menu={{ locale: false }}
      location={{ pathname }}
      route={menuData}
      menuItemRender={(item, dom) =>
        item.children ? dom : <Link to={item.path ?? '/'}>{dom}</Link>
      }
      actionsRender={() => actions}
    >
      <Outlet />
    </ProLayout>
  );
}
