import { logoutApi } from '@/api/auth.ts';
import { hasMinRole } from '@/auth/roles.ts';
import { resetClientCaches } from '@/reset-client-caches.ts';
import { authStore, logout } from '@/stores/auth.ts';
import { ThemeSwitcher } from '@/theme/switch/theme-switcher';
import {
  ApiOutlined,
  DatabaseOutlined,
  HomeOutlined,
  InfoCircleOutlined,
  OllamaFilled,
  TeamOutlined,
} from '@ant-design/icons';
import { PageContainer, ProLayout } from '@ant-design/pro-components';
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
} from '@tanstack/react-router';
import { useSelector } from '@tanstack/react-store';
import { Avatar, Button, Divider, Dropdown, Typography } from 'antd';
import dayjs from 'dayjs';
import { pinyin } from 'pinyin-pro';
import { type ReactNode, useMemo } from 'react';

const { Text } = Typography;

export const Route = createFileRoute('/_layout')({
  beforeLoad: async ({ context }) => {
    await context.auth.ready;
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: '/login' });
    }
  },
  component: LayoutComponent,
});

// 声明式两层菜单：某项有 routes → mix 布局在左侧渲染它的副菜单；
// 没有 routes → 侧栏整体不渲染（ProLayout 内部 flexDirection 退回纵向，页面占满宽度）。
// 因此「有没有副菜单」不需要额外开关，写成树就生效。
const menuData = {
  path: '/',
  routes: [
    { path: '/', name: '首页', icon: <HomeOutlined /> },
    { path: '/about', name: '关于', icon: <InfoCircleOutlined /> },
    { path: '/knowledge', name: '知识库', icon: <DatabaseOutlined /> },
    { path: '/chat', name: '聊天机器人', icon: <OllamaFilled /> },
    {
      path: '/integration',
      name: '集成',
      icon: <ApiOutlined />,
      routes: [
        {
          path: '/integration/model-provider',
          name: '模型供应商',
        },
      ],
    },
    { path: '/users', name: '用户管理', icon: <TeamOutlined /> },
  ],
};

function renderMenuItem(
  item: { children?: unknown; path?: string },
  dom: ReactNode,
): ReactNode {
  return item.children ? dom : <Link to={item.path ?? '/'}>{dom}</Link>;
}

// CJK 判断用模块级常量，避免每次调用重建正则（js-hoist-regexp）
const CJK_CHAR = /[\u4e00-\u9fa5]/;

function getAvatarLetter(username?: string): string {
  const first = username?.trim().charAt(0);
  if (!first) return '';
  if (CJK_CHAR.test(first)) {
    return pinyin(first, { pattern: 'first' }).toUpperCase();
  }
  return first.toUpperCase();
}

function LayoutComponent() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const user = useSelector(authStore, (s) => s.user);
  // 头像首字母：用户下拉与顶栏两处头像共用同一次计算，避免重复跑 pinyin
  // （js-cache-function-results）；依赖 username，导航等无关重渲染不再重算。
  const avatarLetter = useMemo(
    () => getAvatarLetter(user?.username),
    [user?.username],
  );

  const handleLogout = async () => {
    await logoutApi().catch(() => undefined);
    logout();
    resetClientCaches();
    await navigate({ to: '/login' });
  };

  // 用户管理菜单仅 admin 及以上可见（真正的权限由后端 RolesGuard 与路由守卫执行）
  const routes = menuData.routes.filter(
    (r) => r.path !== '/users' || hasMinRole(user?.role, 'admin'),
  );

  const userPanel = (
    <div className="flex w-60 flex-col gap-3 rounded-xl bg-(--ant-color-bg-elevated) p-4">
      <div className="flex items-center gap-3">
        <Avatar
          rootClassName="bg-(--lucy-page-avatar-background)!"
          size={44}
          gap={4}
        >
          {avatarLetter}
        </Avatar>
        <div className="flex min-w-0 flex-col">
          <Text strong ellipsis>
            {user?.nickname ?? user?.username}
          </Text>
          {user?.nickname && (
            <Text type="secondary" ellipsis>
              @{user.username}
            </Text>
          )}
        </div>
      </div>
      <Divider className="my-0!" />
      <div className="flex flex-col gap-1.5 text-sm">
        <div className="flex items-center justify-between gap-3">
          <Text type="secondary">邮箱</Text>
          <Text ellipsis>{user?.email}</Text>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Text type="secondary">注册时间</Text>
          <Text>
            {user?.createdAt ? dayjs(user.createdAt).format('YYYY-MM-DD') : '-'}
          </Text>
        </div>
      </div>
      <Button block onClick={handleLogout}>
        退出登录
      </Button>
    </div>
  );

  return (
    <ProLayout
      className={'h-full'}
      title="Lucy"
      logo={<img src="/favicon.svg" alt="Lucy" />}
      layout="mix"
      splitMenus
      fixedHeader
      menu={{ locale: false }}
      location={{ pathname }}
      route={{ ...menuData, routes }}
      menuItemRender={renderMenuItem}
      actionsRender={() => [
        <ThemeSwitcher key="theme" className="mx-1!" />,
        <Dropdown key="user" trigger={['click']} popupRender={() => userPanel}>
          <Button
            type="text"
            aria-label="用户菜单"
            className="ml-1! h-auto! p-0!"
          >
            <Avatar
              rootClassName="bg-(--lucy-page-avatar-background)! rounded-full! cursor-pointer"
              size="middle"
              gap={4}
            >
              {avatarLetter}
            </Avatar>
          </Button>
        </Dropdown>,
      ]}
    >
      <PageContainer pageHeaderRender={() => <></>}>
        <Outlet />
      </PageContainer>
    </ProLayout>
  );
}
