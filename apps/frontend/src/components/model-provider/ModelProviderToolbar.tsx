import type { ModelProviderType } from '@/api/types';
import { FullBleedBar } from '@/components/full-bleed-bar';
import { MODEL_TYPE_OPTIONS } from '@/components/model-provider/model-provider-labels.ts';
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
  // 与 PageShell 平级（自带 .lucy-page-gutter）：盒子已占满内容区，不能再补 100vw 伪元素，
  // 否则底色会左溢进副菜单列、右溢出视口（见 FullBleedBar 的 bleedToViewport 说明）。
  // z-10：下方 PageShell 是滚动容器，卡片按树序会盖在工具条之上、吃掉 shadow-lg，抬一层即可。
  <FullBleedBar
    bleedToViewport={false}
    className="lucy-page-gutter z-10 shrink-0 py-6 shadow-lg"
  >
    <Segmented<ModelTypeFilter>
      options={TYPE_FILTER_OPTIONS}
      value={type}
      onChange={onTypeChange}
    />
    <div className="w-sm">
      <div className="flex gap-4">
        <Button onClick={onCreate}>新增模型</Button>
        <Input.Search
          allowClear
          defaultValue={defaultKeyword}
          placeholder="按名称搜索模型"
          onSearch={(value) => onSearch(value.trim())}
        />
      </div>
    </div>
  </FullBleedBar>
);
