import type { KnowledgeBase } from '@/api/types.ts';
import {
  EditOutlined,
  HeartOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Card, Typography } from 'antd';
import type { FC } from 'react';

const { Meta } = Card;
const { Paragraph } = Typography;

const actions = [
  <HeartOutlined key="heart" style={{ color: '#ff6b6b' }} />,
  <ShareAltOutlined key="share" style={{ color: '#4ecdc4' }} />,
  <EditOutlined key="edit" style={{ color: '#45b7d1' }} />,
];

export const KnowledgeCard: FC<{ kb: KnowledgeBase; key: string }> = ({
  kb,
  key,
}) => {
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
