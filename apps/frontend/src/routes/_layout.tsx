import { logoutApi } from '@/api/auth.ts';
import { authStore, logout } from '@/stores/auth.ts';
import { ThemeSwitcher } from '@/theme';
import {
  HomeOutlined,
  InfoCircleOutlined,
  OllamaFilled,
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
import { type ReactNode, useState } from 'react';

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

const menuData = {
  path: '/',
  routes: [
    { path: '/', name: '首页', icon: <HomeOutlined /> },
    { path: '/about', name: '关于', icon: <InfoCircleOutlined /> },
    { path: '/chat', name: '聊天机器人', icon: <OllamaFilled /> },
  ],
};

function renderMenuItem(
  item: { children?: unknown; path?: string },
  dom: ReactNode,
): ReactNode {
  return item.children ? dom : <Link to={item.path ?? '/'}>{dom}</Link>;
}

function getAvatarLetter(username?: string): string {
  const first = username?.trim().charAt(0);
  if (!first) return '';
  if (/[\u4e00-\u9fa5]/.test(first)) {
    return pinyin(first, { pattern: 'first' }).toUpperCase();
  }
  return first.toUpperCase();
}

function LayoutComponent() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const user = useSelector(authStore, (s) => s.user);
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = async () => {
    await logoutApi().catch(() => undefined);
    logout();
    await navigate({ to: '/login' });
  };

  const userPanel = (
    <div className="flex w-60 flex-col gap-3 rounded-xl bg-(--ant-color-bg-elevated) p-4">
      <div className="flex items-center gap-3">
        <Avatar
          rootClassName="bg-(--lucy-page-avatar-background)!"
          size={44}
          gap={4}
        >
          {getAvatarLetter(user?.username)}
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

  const AvatarComponent = (
    <Dropdown
      trigger={['click']}
      placement="rightBottom"
      popupRender={() => userPanel}
    >
      <button
        type="button"
        aria-label={user?.username ? `用户菜单：${user.username}` : '用户菜单'}
        className={`flex cursor-pointer items-center rounded-2xl border-0 bg-transparent p-2 text-inherit transition hover:bg-(--ant-control-item-bg-hover) ${collapsed ? 'justify-center' : 'gap-2'}`}
      >
        <Avatar
          rootClassName="bg-(--lucy-page-avatar-background)!"
          size="middle"
          gap={4}
        >
          {getAvatarLetter(user?.username)}
        </Avatar>
        {!collapsed && <Text ellipsis>{user?.username}</Text>}
      </button>
    </Dropdown>
  );

  return (
    <ProLayout
      className={'h-full'}
      title="Lucy"
      logo={<img src="/favicon.svg" alt="Lucy" />}
      layout="side"
      collapsed={collapsed}
      onCollapse={setCollapsed}
      fixedHeader
      fixSiderbar
      menu={{ locale: false }}
      location={{ pathname }}
      route={menuData}
      menuItemRender={renderMenuItem}
      menuFooterRender={() => AvatarComponent}
    >
      <PageContainer
        fixedHeader
        header={{
          extra: [<ThemeSwitcher key={'theme'} />],
        }}
      >
        <Outlet />
      </PageContainer>
    </ProLayout>
  );
}
