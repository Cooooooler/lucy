import { PageShell } from '@/components/page-shell';
import { createFileRoute } from '@tanstack/react-router';
import { Typography } from 'antd';

const { Title, Paragraph } = Typography;

export const Route = createFileRoute('/_layout/integration/model-provider')({
  component: ModelProviderComponent,
});

function ModelProviderComponent() {
  return (
    <PageShell className="pt-1">
      {/* 全局 PageContainer 的页头被 _layout.tsx 关闭（pageHeaderRender 渲染空节点），
          页面级引导标题在这里自行渲染。 */}
      <Title level={3} className="!mt-0 !mb-2">
        模型供应商
      </Title>
      <Paragraph type="secondary" className="!mt-0">
        选择一个为应用提供能力的语言模型。在工作区中开始构建前，至少需要配置一个。
      </Paragraph>
    </PageShell>
  );
}
