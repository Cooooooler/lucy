import { createFileRoute, redirect } from '@tanstack/react-router';

// /integration 本身没有内容，重定向到第一个子路由
export const Route = createFileRoute('/_layout/integration/')({
  beforeLoad: () => {
    throw redirect({ to: '/integration/model-provider' });
  },
});
