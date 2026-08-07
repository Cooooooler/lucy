import { PageContainer, ProCard } from '@ant-design/pro-components';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_layout/about')({
  component: AboutComponent,
});

function AboutComponent() {
  return (
    <PageContainer title="关于">
      <ProCard>
        <p className="m-0">
          基于 Vite + React 19 + TanStack Router + ProComponents
          构建的前端应用。 侧边栏由 ProLayout 提供，登录/注册页面独立于该布局。
        </p>
      </ProCard>
    </PageContainer>
  );
}
