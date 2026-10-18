import { createFileRoute, Outlet } from '@tanstack/react-router';

// 知识库的布局路由：只挂载子路由的 Outlet，自身不渲染内容。
//
// 为什么必须有它：TanStack Router 会把 knowledge/$kbId.tsx 嵌在 knowledge.tsx 之下，
// 若把列表页直接放在 knowledge.tsx，详情 URL 上就会连列表一起渲染。拆成
// layout + index 后，列表（/knowledge）与详情（/knowledge/$kbId）是同前缀的兄弟页，
// 各自独占整页；布局层没有共享 UI，所以这里只是一个空壳。
const KnowledgeLayout = () => {
  return <Outlet />;
};

export const Route = createFileRoute('/_layout/knowledge')({
  component: KnowledgeLayout,
});
