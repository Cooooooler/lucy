import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_layout/integration')({
  component: IntegrationComponent,
});

// 集成模块的布局路由：只挂载子路由 Outlet，自身不渲染内容。
// 左侧副菜单由全局 ProLayout 的 mix 布局提供（见 routes/_layout.tsx 的 menuData），
// 无需在此再画一份——某项有没有副菜单，取决于 menuData 里它有没有 routes。
function IntegrationComponent() {
  return <Outlet />;
}
