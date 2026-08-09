import { HomeOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { ProLayout } from '@ant-design/pro-components';
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
      <Outlet />
    </ProLayout>
  );
}
