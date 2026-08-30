import { type ThemeMode, useTheme } from '@/theme';
import { MonitorOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons';
import { Button, Dropdown } from 'antd';
import type { FC, ReactNode } from 'react';

interface ThemeSwitcherProps {
  className?: string;
}

const OPTIONS: Array<{ key: ThemeMode; label: string; icon: ReactNode }> = [
  { key: 'light', label: '亮色', icon: <SunOutlined /> },
  { key: 'dark', label: '暗色', icon: <MoonOutlined /> },
  { key: 'system', label: '跟随系统', icon: <MonitorOutlined /> },
];

export const ThemeSwitcher: FC<ThemeSwitcherProps> = ({ className }) => {
  const { mode, setMode, resolvedTheme } = useTheme();
  const triggerIcon =
    resolvedTheme === 'dark' ? <MoonOutlined /> : <SunOutlined />;

  return (
    <Dropdown
      trigger={['click']}
      menu={{
        selectedKeys: [mode],
        items: OPTIONS.map((o) => ({
          key: o.key,
          label: o.label,
          icon: o.icon,
        })),
        onClick: ({ key }) => setMode(key as ThemeMode),
      }}
    >
      <Button
        type="text"
        icon={triggerIcon}
        aria-label="切换主题"
        className={className}
      />
    </Dropdown>
  );
};
