import { ApiError } from '@/api/client';
import type { KnowledgeBase } from '@/api/types.ts';
import {
  useLikeKnowledgeBase,
  useUnlikeKnowledgeBase,
  useUpdateKnowledgeBase,
} from '@/hooks/use-knowledge';
import {
  EditOutlined,
  HeartFilled,
  HeartOutlined,
  LockOutlined,
  UnlockOutlined,
} from '@ant-design/icons';
import {
  App,
  Avatar,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Segmented,
  Tooltip,
  Typography,
} from 'antd';
import type { FC } from 'react';
import { useState } from 'react';

const { Meta } = Card;
const { Paragraph } = Typography;

const VISIBILITY_OPTIONS: { label: string; value: 'private' | 'public' }[] = [
  { label: '私有', value: 'private' },
  { label: '公开', value: 'public' },
];

export const KnowledgeCard: FC<{ kb: KnowledgeBase }> = ({ kb }) => {
  const [open, setOpen] = useState(false);
  const { message } = App.useApp();
  const updateMutation = useUpdateKnowledgeBase();
  const likeMutation = useLikeKnowledgeBase();
  const unlikeMutation = useUnlikeKnowledgeBase();
  const [form] = Form.useForm();

  const handleToggleLike = () => {
    if (kb.isLiked) {
      unlikeMutation.mutate(kb.id);
    } else {
      likeMutation.mutate(kb.id);
    }
  };

  const handleSubmit = async () => {
    let values: {
      name: string;
      description?: string;
      visibility: 'private' | 'public';
    };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: kb.id,
        input: {
          name: values.name.trim(),
          description: values.description?.trim() ?? undefined,
          visibility: values.visibility,
        },
      });
      message.success('知识库更新成功');
      setOpen(false);
    } catch (e) {
      if (e instanceof ApiError) {
        message.error(e.message);
      } else {
        message.error('更新失败，请稍后重试');
      }
    }
  };

  return (
    <Card
      hoverable
      actions={[
        <Tooltip key="heart" title={kb.isLiked ? '取消点赞' : '点赞'}>
          <Button
            type="text"
            loading={likeMutation.isPending || unlikeMutation.isPending}
            aria-label={kb.isLiked ? '取消点赞' : '点赞'}
            onClick={handleToggleLike}
            icon={
              kb.isLiked ? (
                <HeartFilled style={{ color: '#ff6b6b' }} />
              ) : (
                <HeartOutlined style={{ color: '#ff6b6b' }} />
              )
            }
          >
            {kb.likeCount ? (
              <span className="text-xs">{kb.likeCount}</span>
            ) : null}
          </Button>
        </Tooltip>,
        <Tooltip
          key="share"
          title={kb.visibility === 'public' ? '公开' : '私有'}
        >
          <Button
            type="text"
            aria-label="分享知识库"
            icon={
              kb.visibility === 'public' ? (
                <UnlockOutlined style={{ color: '#4ecdc4' }} />
              ) : (
                <LockOutlined style={{ color: '#4ecdc4' }} />
              )
            }
          />
        </Tooltip>,
        <Tooltip key="edit" title="编辑">
          <Button
            type="text"
            aria-label="编辑知识库"
            icon={<EditOutlined style={{ color: '#45b7d1' }} />}
            onClick={() => setOpen(true)}
          />
        </Tooltip>,
      ]}
      title={kb.name}
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
      <Drawer
        title="编辑知识库"
        size="large"
        open={open}
        destroyOnHidden
        onClose={() => setOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              type="primary"
              loading={updateMutation.isPending}
              onClick={handleSubmit}
            >
              保存
            </Button>
          </div>
        }
      >
        <Form
          form={form}
          layout="vertical"
          preserve={false}
          initialValues={{
            name: kb.name,
            description: kb.description,
            visibility: kb.visibility,
          }}
        >
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, whitespace: true, message: '请输入知识库名称' },
            ]}
          >
            <Input maxLength={20} placeholder="请输入知识库名称" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea
              maxLength={200}
              showCount
              rows={4}
              placeholder="请输入描述（可选）"
            />
          </Form.Item>
          <Form.Item name="visibility" label="可见性">
            <Segmented options={VISIBILITY_OPTIONS} block />
          </Form.Item>
        </Form>
      </Drawer>
    </Card>
  );
};
