import { Input, Segmented } from 'antd';
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
};

export const KnowledgeToolbar: FC<KnowledgeToolbarProps> = ({
  visibility,
  onVisibilityChange,
  onSearch,
}) => {
  return (
    <div className="sticky top-0 z-10 flex w-full items-center justify-between gap-4 bg-(--ant-color-bg-container) px-4 py-6 shadow-lg sm:px-6 md:px-8">
      <Segmented<VisibilityFilter>
        options={VISIBILITY_OPTIONS}
        value={visibility}
        onChange={onVisibilityChange}
      />
      <div className="w-sm">
        <Input.Search
          allowClear
          placeholder="按名称搜索知识库"
          onSearch={(value) => onSearch(value.trim())}
        />
      </div>
    </div>
  );
};
