import { PageToolbar } from '@/components/page-toolbar';
import { ReloadOutlined } from '@ant-design/icons';
import { Button, Input, Segmented } from 'antd';
import type { FC } from 'react';

export type VisibilityFilter = 'all' | 'private' | 'public';

export const VISIBILITY_OPTIONS: { label: string; value: VisibilityFilter }[] =
  [
    { label: '全部', value: 'all' },
    { label: '私有', value: 'private' },
    { label: '公开', value: 'public' },
  ];

type KnowledgeToolbarProps = {
  visibility: VisibilityFilter;
  onVisibilityChange: (value: VisibilityFilter) => void;
  onSearch: (value: string) => void;
  /** 点击刷新时触发：丢弃列表缓存并从第一页重新加载（缓存操作由路由持有的 hook 执行） */
  onRefresh: () => void;
  /** 搜索框初始关键词：仅在挂载时作为非受控输入框的默认值（用于返回恢复） */
  defaultKeyword?: string;
  /** 点击「新增知识库」时触发；表单抽屉由路由持有 */
  onCreate: () => void;
};

export const KnowledgeToolbar: FC<KnowledgeToolbarProps> = ({
  visibility,
  onVisibilityChange,
  onSearch,
  onRefresh,
  defaultKeyword,
  onCreate,
}) => (
  <PageToolbar
    left={
      <div className="flex items-center gap-4">
        <Segmented<VisibilityFilter>
          options={VISIBILITY_OPTIONS}
          value={visibility}
          onChange={onVisibilityChange}
        />
        {/* 刷新：丢弃全部列表缓存并重新加载当前筛选（见 useRefreshKnowledgeBaseList） */}
        <Button
          type="text"
          icon={<ReloadOutlined />}
          onClick={onRefresh}
          aria-label="刷新"
          title="刷新"
        />
      </div>
    }
    actions={<Button onClick={onCreate}>新增知识库</Button>}
    search={
      <Input.Search
        allowClear
        defaultValue={defaultKeyword}
        placeholder="按名称搜索知识库"
        onSearch={(value) => onSearch(value.trim())}
      />
    }
  />
);
