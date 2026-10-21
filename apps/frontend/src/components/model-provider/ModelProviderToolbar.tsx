import type { ModelProviderVendor } from '@/api/types';
import { VENDOR_OPTIONS } from '@/components/model-provider/model-provider-labels.ts';
import { PageToolbar } from '@/components/page-toolbar';
import { Button, Input, Segmented } from 'antd';
import type { FC } from 'react';

export type ModelVendorFilter = 'all' | ModelProviderVendor;

const VENDOR_FILTER_OPTIONS: { label: string; value: ModelVendorFilter }[] = [
  { label: '全部', value: 'all' },
  ...VENDOR_OPTIONS,
];

type ModelProviderToolbarProps = {
  vendor: ModelVendorFilter;
  onVendorChange: (value: ModelVendorFilter) => void;
  onSearch: (value: string) => void;
  /** 搜索框初始关键词：仅在挂载时作为非受控输入框的默认值（用于返回恢复） */
  defaultKeyword?: string;
  /** 点击「新增模型」时触发；表单抽屉由路由持有 */
  onCreate: () => void;
  /** 点击「默认模型设置」时触发；Modal 由路由持有 */
  onOpenDefaults: () => void;
};

export const ModelProviderToolbar: FC<ModelProviderToolbarProps> = ({
  vendor,
  onVendorChange,
  onSearch,
  defaultKeyword,
  onCreate,
  onOpenDefaults,
}) => (
  <PageToolbar
    left={
      <Segmented<ModelVendorFilter>
        options={VENDOR_FILTER_OPTIONS}
        value={vendor}
        onChange={onVendorChange}
      />
    }
    actions={
      <>
        <Button onClick={onOpenDefaults}>默认模型设置</Button>
        <Button onClick={onCreate}>新增模型</Button>
      </>
    }
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
