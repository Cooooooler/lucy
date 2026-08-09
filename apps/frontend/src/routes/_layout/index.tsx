import { ProCard, StatisticCard } from '@ant-design/pro-components';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_layout/')({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <ProCard gutter={[16, 16]} wrap>
      <StatisticCard title="用户数" statistic={{ value: 8846 }} />
      <StatisticCard title="订单量" statistic={{ value: 93, suffix: '/ 天' }} />
      <StatisticCard title="销售额" statistic={{ value: 8846, prefix: '¥' }} />
    </ProCard>
  );
}
