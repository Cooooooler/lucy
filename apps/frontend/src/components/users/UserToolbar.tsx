import { Input, Select } from 'antd';
import type { FC } from 'react';

export type StatusFilter = 'all' | 'enabled' | 'disabled';

export const STATUS_OPTIONS: { label: string; value: StatusFilter }[] = [
  { label: '全部状态', value: 'all' },
  { label: '正常', value: 'enabled' },
  { label: '已禁用', value: 'disabled' },
];

type UserToolbarProps = {
  status: StatusFilter;
  onStatusChange: (value: StatusFilter) => void;
  onSearch: (value: string) => void;
};

export const UserToolbar: FC<UserToolbarProps> = ({
  status,
  onStatusChange,
  onSearch,
}) => {
  return (
    <div className="sticky top-0 z-10 flex w-full items-center justify-between gap-4 bg-(--ant-color-bg-container) px-4 py-6 shadow-lg sm:px-6 md:px-8">
      <Select<StatusFilter>
        className="w-32"
        options={STATUS_OPTIONS}
        value={status}
        onChange={onStatusChange}
      />
      <div className="w-sm">
        <Input.Search
          allowClear
          placeholder="按用户名 / 邮箱 / 昵称搜索"
          onSearch={(value) => onSearch(value.trim())}
        />
      </div>
    </div>
  );
};
