import type { KnowledgeBase } from '@/api/types.ts';
import { useKnowledgeBaseList } from '@/hooks/use-knowledge.ts';
import {
  EditOutlined,
  HeartOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import type { KnowledgeListQuery } from '@lucy/shared';
import { createFileRoute } from '@tanstack/react-router';
import { Avatar, Button, Card, Input, Segmented, Typography } from 'antd';
import type { FC } from 'react';
import { useMemo, useState } from 'react';

const { Meta } = Card;
const { Paragraph } = Typography;

export const Route = createFileRoute('/_layout/knowledge')({
  component: KnowledgeComponent,
});

const actions = [
  <HeartOutlined key="heart" style={{ color: '#ff6b6b' }} />,
  <ShareAltOutlined key="share" style={{ color: '#4ecdc4' }} />,
  <EditOutlined key="edit" style={{ color: '#45b7d1' }} />,
];

const KnowledgeCard: FC<{ kb: KnowledgeBase; key: string }> = ({ kb, key }) => {
  return (
    <Card
      hoverable
      key={key}
      actions={actions}
      title={kb.name}
      extra={<Button type="link">详情</Button>}
      variant="borderless"
    >
      <Meta
        avatar={
          <Avatar src="https://api.dicebear.com/10.x/lorelei/svg?seed=1" />
        }
        description={
          <Paragraph
            className="h-11"
            ellipsis={{ rows: 2, tooltip: kb.description }}
          >
            {kb.description}
          </Paragraph>
        }
      />
    </Card>
  );
};

const KnowledgeList: FC<{ knowledgeBases: KnowledgeBase[] }> = ({
  knowledgeBases,
}) => {
  return (
    <div className="box-border h-full scrollbar-gutter-stable overflow-auto pt-4">
      <div className="grid grid-cols-1 gap-4 pr-2 pb-8 pl-4 sm:grid-cols-1 sm:pr-4 sm:pl-6 md:grid-cols-1 md:pr-6 md:pl-8 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {knowledgeBases.map((kb) => (
          <KnowledgeCard kb={kb} key={kb.id} />
        ))}
      </div>
    </div>
  );
};

// 可见性筛选选项：'all' 表示不过滤（后端默认走「我的 + 公开」）。
type VisibilityFilter = 'all' | 'private' | 'public';
const VISIBILITY_OPTIONS: { label: string; value: VisibilityFilter }[] = [
  { label: '全部', value: 'all' },
  { label: '私有', value: 'private' },
  { label: '公开', value: 'public' },
];

function KnowledgeComponent() {
  const [committedName, setCommittedName] = useState('');
  const [visibility, setVisibility] = useState<VisibilityFilter>('all');

  const query = useMemo<KnowledgeListQuery>(
    () => ({
      pageSize: 100,
      name: committedName || undefined,
      visibility: visibility === 'all' ? undefined : visibility,
    }),
    [committedName, visibility],
  );

  const knowledgeBases = useKnowledgeBaseList(query);

  return (
    <>
      <div className="flex w-full items-center justify-between gap-4 px-4 py-6 shadow-lg sm:px-6 md:px-8">
        <Segmented<VisibilityFilter>
          options={VISIBILITY_OPTIONS}
          value={visibility}
          onChange={setVisibility}
        />
        <div className="w-sm">
          <Input.Search
            allowClear
            placeholder="按名称搜索知识库"
            onSearch={(value) => setCommittedName(value.trim())}
          />
        </div>
      </div>
      <KnowledgeList knowledgeBases={knowledgeBases.data?.list || []} />
    </>
  );
}
