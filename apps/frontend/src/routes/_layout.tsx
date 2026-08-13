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
} from '@tanstack/react-router';
import type { ReactNode } from 'react';

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
    { path: '/chat', name: '聊天机器人', icon: <OllamaFilled /> },
  ],
};

function renderMenuItem(
  item: { children?: unknown; path?: string },
  dom: ReactNode,
): ReactNode {
  return item.children ? dom : <Link to={item.path ?? '/'}>{dom}</Link>;
}

function LayoutComponent() {
  const { pathname } = useLocation();

  return (
    <ProLayout
      className={'h-full'}
      title="Lucy"
      logo={<img src="/favicon.svg" alt="Lucy" />}
      layout="side"
      fixedHeader
      fixSiderbar
      menu={{ locale: false }}
      location={{ pathname }}
      route={menuData}
      menuItemRender={renderMenuItem}
    >
      <PageContainer
        header={{
          extra: [<ThemeSwitcher key={'theme'} />],
        }}
      >
        <Outlet />
      </PageContainer>
    </ProLayout>
  );
}
