import type { ModelProviderType } from '@/api/types';
import { MODEL_TYPE_OPTIONS } from '@/components/model-provider/model-provider-labels.ts';
import { PageToolbar } from '@/components/page-toolbar';
import { Button, Input, Segmented } from 'antd';
import type { FC } from 'react';

export type ModelTypeFilter = 'all' | ModelProviderType;

const TYPE_FILTER_OPTIONS: { label: string; value: ModelTypeFilter }[] = [
  { label: '全部', value: 'all' },
  ...MODEL_TYPE_OPTIONS,
];

type ModelProviderToolbarProps = {
  type: ModelTypeFilter;
  onTypeChange: (value: ModelTypeFilter) => void;
  onSearch: (value: string) => void;
  /** 搜索框初始关键词：仅在挂载时作为非受控输入框的默认值（用于返回恢复） */
  defaultKeyword?: string;
  /** 点击「新增模型」时触发；表单抽屉由路由持有 */
  onCreate: () => void;
};

export const ModelProviderToolbar: FC<ModelProviderToolbarProps> = ({
  type,
  onTypeChange,
  onSearch,
  defaultKeyword,
  onCreate,
}) => (
  <PageToolbar
    left={
      <Segmented<ModelTypeFilter>
        options={TYPE_FILTER_OPTIONS}
        value={type}
        onChange={onTypeChange}
      />
    }
    actions={<Button onClick={onCreate}>新增模型</Button>}
    search={
      <Input.Search
        allowClear
        defaultValue={defaultKeyword}
        placeholder="按名称搜索模型"
        onSearch={(value) => onSearch(value.trim())}
      />
    }
  />
);
