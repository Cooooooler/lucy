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
  /** 搜索框初始关键词：仅在挂载时作为非受控输入框的默认值（用于返回恢复） */
  defaultKeyword?: string;
  /** 点击「新增知识库」时触发；表单抽屉由路由持有 */
  onCreate: () => void;
};

export const KnowledgeToolbar: FC<KnowledgeToolbarProps> = ({
  visibility,
  onVisibilityChange,
  onSearch,
  defaultKeyword,
  onCreate,
}) => (
  <div className="z-10 flex w-full shrink-0 items-center justify-between gap-4 bg-(--ant-color-bg-container) px-4 py-6 shadow-lg sm:px-6 md:px-8">
    <Segmented<VisibilityFilter>
      options={VISIBILITY_OPTIONS}
      value={visibility}
      onChange={onVisibilityChange}
    />
    <div className="w-sm">
      <div className="flex gap-4">
        <Button onClick={onCreate}>新增知识库</Button>
        <Input.Search
          allowClear
          defaultValue={defaultKeyword}
          placeholder="按名称搜索知识库"
          onSearch={(value) => onSearch(value.trim())}
        />
      </div>
    </div>
  </div>
);
