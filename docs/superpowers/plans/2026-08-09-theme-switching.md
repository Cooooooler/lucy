# 前端主题切换实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 前端支持亮色 / 暗色 / 跟随系统三种主题模式，入口在 ProLayout 顶栏右侧，全局生效并持久化。

**架构：** `ThemeProvider`（React Context + ahooks `useLocalStorageState`）持有 `mode`，解析出 `resolvedTheme`；内部渲染 antd `ConfigProvider`（按 resolved 切换 `darkAlgorithm`/`defaultAlgorithm`），并给 `<html>` 加/去 `.dark` 类供 Tailwind 使用。顶栏控件 `ThemeSwitcher`（antd Dropdown）挂在 ProLayout `actionsRender`。

**技术栈：** React 19、antd 6.5.3（`theme.darkAlgorithm`）、Tailwind CSS 4（`@custom-variant dark`）、ahooks、Vitest + Testing Library、TanStack Router 文件式路由。

规格：`docs/superpowers/specs/2026-08-09-theme-switching-design.md`

---

## 文件结构

- 修改 `apps/frontend/src/index.css` — Tailwind `dark:` 变体改为跟随 `.dark` class
- 创建 `apps/frontend/src/theme/ThemeProvider.tsx` — Context + 持久化 + 系统跟随 + 应用副作用 + 渲染 ConfigProvider
- 创建 `apps/frontend/src/theme/index.ts` — 重导出 `ThemeProvider`、`useTheme`、`ThemeMode`
- 修改 `apps/frontend/src/main.tsx` — 根部包 `<ThemeProvider>`，移除原 `ConfigProvider`（移入 ThemeProvider）
- 创建 `apps/frontend/src/components/theme-switcher.tsx` — 顶栏切换控件
- 修改 `apps/frontend/src/routes/_layout.tsx` — ProLayout 加 `actionsRender`

测试文件（与被测对象同目录）：

- `apps/frontend/src/theme/ThemeProvider.test.tsx`
- `apps/frontend/src/components/theme-switcher.test.tsx`

注意：`src/theme/**` 被纳入覆盖率（≥80%），`src/components/**` 被 vitest 覆盖率排除但仍会运行测试。所有新导入用 `@/` 前缀（`@/theme`、`@/components/theme-switcher`），不要用 CLAUDE.md 中未实际配置的 `@components` 别名。

---

### 任务 1：Tailwind `dark:` 变体改为 class 驱动

**文件：**

- 修改：`apps/frontend/src/index.css`

- [ ] **步骤 1：编辑 index.css**

当前内容为：

```css
@import 'tailwindcss';
@import 'tw-animate-css';

#root {
  width: 100vw;
  height: 100vh;
}

.ant-app {
  width: 100%;
  height: 100%;
}
```

改为（在 import 之后、`#root` 之前插入 `@custom-variant`）：

```css
@import 'tailwindcss';
@import 'tw-animate-css';

@custom-variant dark (&:where(.dark, .dark *));

#root {
  width: 100vw;
  height: 100vh;
}

.ant-app {
  width: 100%;
  height: 100%;
}
```

- [ ] **步骤 2：验证 CSS 可构建**

运行：`pnpm --filter @lucy/frontend build` 预期：构建成功，无 CSS 相关错误。

- [ ] **步骤 3：Commit**

```bash
git add apps/frontend/src/index.css
git commit -m "style(frontend): Tailwind dark 变体改为跟随 .dark class"
```

---

### 任务 2：ThemeProvider（TDD）

**文件：**

- 测试：`apps/frontend/src/theme/ThemeProvider.test.tsx`（创建）
- 实现：`apps/frontend/src/theme/ThemeProvider.tsx`（创建）
- 实现：`apps/frontend/src/theme/index.ts`（创建）

- [ ] **步骤 1：编写失败的测试**

创建 `apps/frontend/src/theme/ThemeProvider.test.tsx`：

```tsx
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from './index';

const THEME_KEY = 'lucy.theme';

function stubMatchMedia(matches: boolean) {
  const changeListeners = new Set<() => void>();
  const mql = {
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_type: string, cb: () => void) =>
      changeListeners.add(cb),
    removeEventListener: (_type: string, cb: () => void) =>
      changeListeners.delete(cb),
    dispatchEvent: () => true,
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql),
  );
  return {
    setMatches(next: boolean) {
      mql.matches = next;
      changeListeners.forEach((cb) => cb(new Event('change')));
    },
  };
}

function Probe() {
  const { mode, resolvedTheme, setMode } = useTheme();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button onClick={() => setMode('dark')}>to-dark</button>
      <button onClick={() => setMode('light')}>to-light</button>
      <button onClick={() => setMode('system')}>to-system</button>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    vi.unstubAllGlobals();
  });

  it('默认 mode 为 system，resolved 跟随系统暗色并加 .dark', () => {
    stubMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('system');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');
  });

  it('切换到暗色/亮色时持久化、resolved 更新、.dark 应用与移除', async () => {
    stubMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText('to-dark'));
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');
    await waitFor(() => {
      expect(localStorage.getItem(THEME_KEY)).toBe('"dark"');
    });

    fireEvent.click(screen.getByText('to-light'));
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    expect(document.documentElement).not.toHaveClass('dark');
    await waitFor(() => {
      expect(localStorage.getItem(THEME_KEY)).toBe('"light"');
    });
  });

  it('system 模式下系统偏好变化实时响应', () => {
    const sys = stubMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');

    act(() => sys.setMatches(true));
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');
  });

  it('非 system 模式不响应系统偏好变化', () => {
    const sys = stubMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText('to-dark'));
    act(() => sys.setMatches(false));
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  });

  it('重新挂载时读回已存偏好', () => {
    stubMatchMedia(true);
    localStorage.setItem(THEME_KEY, '"light"');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('mode')).toHaveTextContent('light');
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @lucy/frontend test src/theme/ThemeProvider.test.tsx` 预期：FAIL，报错找不到 `./index`（模块不存在）。

- [ ] **步骤 3：编写最少实现代码**

创建 `apps/frontend/src/theme/ThemeProvider.tsx`：

```tsx
import { useLocalStorageState } from 'ahooks';
import { ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  resolvedTheme: 'light' | 'dark';
}

const THEME_KEY = 'lucy.theme';

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemDark(): boolean {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function subscribeSystemDark(callback: () => void): () => void {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return () => {};
  }
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

export function ThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [mode, setModeState] = useLocalStorageState<ThemeMode>(THEME_KEY, {
    defaultValue: 'system',
  });

  const systemDark = useSyncExternalStore(subscribeSystemDark, getSystemDark);

  const resolvedTheme: 'light' | 'dark' =
    mode === 'dark'
      ? 'dark'
      : mode === 'light'
        ? 'light'
        : systemDark
          ? 'dark'
          : 'light';

  const setMode = useCallback(
    (next: ThemeMode) => setModeState(next),
    [setModeState],
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  }, [resolvedTheme]);

  return (
    <ThemeContext.Provider value={{ mode, setMode, resolvedTheme }}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm:
            resolvedTheme === 'dark'
              ? antdTheme.darkAlgorithm
              : antdTheme.defaultAlgorithm,
        }}
      >
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme 必须在 <ThemeProvider> 内使用');
  }
  return ctx;
}
```

创建 `apps/frontend/src/theme/index.ts`：

```ts
export { ThemeProvider, useTheme } from './ThemeProvider';
export type { ThemeMode, ThemeContextValue } from './ThemeProvider';
```

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm --filter @lucy/frontend test src/theme/ThemeProvider.test.tsx` 预期：5 个测试全部 PASS。

- [ ] **步骤 5：Commit**

```bash
git add apps/frontend/src/theme/ThemeProvider.tsx apps/frontend/src/theme/index.ts apps/frontend/src/theme/ThemeProvider.test.tsx
git commit -m "feat(theme): ThemeProvider 支持明暗/跟随系统三种模式"
```

---

### 任务 3：接入 main.tsx

**文件：**

- 修改：`apps/frontend/src/main.tsx`

- [ ] **步骤 1：修改 main.tsx**

当前内容：

```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { authRouterContext } from './auth-context';
import { AuthProvider } from './auth/AuthProvider';
import './index.css';
import { queryClient } from './queryClient';
import { router } from './router';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider locale={zhCN}>
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RouterProvider
              router={router}
              context={{ auth: authRouterContext }}
            />
          </AuthProvider>
        </QueryClientProvider>
      </AntdApp>
    </ConfigProvider>
  </StrictMode>,
);
```

改为：

```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { App as AntdApp } from 'antd';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { authRouterContext } from './auth-context';
import { AuthProvider } from './auth/AuthProvider';
import './index.css';
import { queryClient } from './queryClient';
import { router } from './router';
import { ThemeProvider } from './theme';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RouterProvider
              router={router}
              context={{ auth: authRouterContext }}
            />
          </AuthProvider>
        </QueryClientProvider>
      </AntdApp>
    </ThemeProvider>
  </StrictMode>,
);
```

（`ConfigProvider` 与 `zhCN` 导入已移除，由 ThemeProvider 内部渲染并保留 locale。）

- [ ] **步骤 2：验证类型与现有测试**

运行：`pnpm --filter @lucy/frontend typecheck && pnpm --filter @lucy/frontend test` 预期：typecheck 通过；现有前端测试全部通过（main.tsx 不在覆盖率内，不影响门槛）。

- [ ] **步骤 3：Commit**

```bash
git add apps/frontend/src/main.tsx
git commit -m "feat(theme): main.tsx 根部接入 ThemeProvider"
```

---

### 任务 4：ThemeSwitcher 顶栏控件（TDD）

**文件：**

- 测试：`apps/frontend/src/components/theme-switcher.test.tsx`（创建）
- 实现：`apps/frontend/src/components/theme-switcher.tsx`（创建）

- [ ] **步骤 1：编写失败的测试**

创建 `apps/frontend/src/components/theme-switcher.test.tsx`：

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeSwitcher } from './theme-switcher';

// vi.mock 工厂会提升到文件顶部，工厂内引用的变量必须用 vi.hoisted 定义
const { setModeMock } = vi.hoisted(() => ({ setModeMock: vi.fn() }));

vi.mock('@/theme', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/theme')>();
  return {
    ...actual,
    useTheme: () => ({
      mode: 'light',
      setMode: setModeMock,
      resolvedTheme: 'light',
    }),
  };
});

describe('ThemeSwitcher', () => {
  beforeEach(() => {
    setModeMock.mockReset();
  });

  it('点击菜单项切换为暗色', async () => {
    render(<ThemeSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: '切换主题' }));
    fireEvent.click(await screen.findByText('暗色'));
    expect(setModeMock).toHaveBeenCalledWith('dark');
  });

  it('点击菜单项切换为跟随系统', async () => {
    render(<ThemeSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: '切换主题' }));
    fireEvent.click(await screen.findByText('跟随系统'));
    expect(setModeMock).toHaveBeenCalledWith('system');
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`pnpm --filter @lucy/frontend test src/components/theme-switcher.test.tsx` 预期：FAIL，报错找不到 `./theme-switcher`（模块不存在）。

- [ ] **步骤 3：编写最少实现代码**

创建 `apps/frontend/src/components/theme-switcher.tsx`：

```tsx
import { MonitorOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons';
import { Button, Dropdown } from 'antd';
import type { ReactNode } from 'react';
import { useTheme, type ThemeMode } from '@/theme';

const OPTIONS: Array<{ key: ThemeMode; label: string; icon: ReactNode }> = [
  { key: 'light', label: '亮色', icon: <SunOutlined /> },
  { key: 'dark', label: '暗色', icon: <MoonOutlined /> },
  { key: 'system', label: '跟随系统', icon: <MonitorOutlined /> },
];

export function ThemeSwitcher() {
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
      <Button type="text" icon={triggerIcon} aria-label="切换主题" />
    </Dropdown>
  );
}
```

- [ ] **步骤 4：运行测试确认通过**

运行：`pnpm --filter @lucy/frontend test src/components/theme-switcher.test.tsx` 预期：2 个测试全部 PASS。

若 Dropdown 弹层在 jsdom 中未按预期打开（`findByText` 超时），可改用 `userEvent`：先 `await userEvent.click(trigger)` 再 `await userEvent.click(item)`；或为 `Dropdown` 增加 `getPopupContainer={(node) => node.parentElement ?? document.body}` 便于测试。不要为通过测试而改动产品逻辑。

- [ ] **步骤 5：Commit**

```bash
git add apps/frontend/src/components/theme-switcher.tsx apps/frontend/src/components/theme-switcher.test.tsx
git commit -m "feat(theme): 顶栏 ThemeSwitcher 切换控件"
```

---

### 任务 5：ProLayout 顶栏接入

**文件：**

- 修改：`apps/frontend/src/routes/_layout.tsx`

- [ ] **步骤 1：修改 \_layout.tsx**

在文件顶部 import 区加入：

```tsx
import { ThemeSwitcher } from '@/components/theme-switcher';
```

给 `LayoutComponent` 中的 `<ProLayout>` 增加 `actionsRender` 属性（放在 `menuItemRender` 之后）：

```tsx
<ProLayout
  title="Lucy"
  logo={<img src="/favicon.svg" alt="Lucy" />}
  layout="side"
  fixedHeader
  fixSiderbar
  menu={{ locale: false }}
  location={{ pathname }}
  route={menuData}
  menuItemRender={renderMenuItem}
  actionsRender={() => [<ThemeSwitcher key="theme" />]}
>
```

- [ ] **步骤 2：验证类型与测试**

运行：`pnpm --filter @lucy/frontend typecheck && pnpm --filter @lucy/frontend test` 预期：typecheck 通过；测试通过。

- [ ] **步骤 3：Commit（注意在途改动）**

`apps/frontend/src/routes/_layout.tsx` 在本任务开始前已含有**暂存中的在途改动**（本分支 auth/chat 布局工作）。若 `git diff --cached` 显示该文件已有 staged 内容，请与用户确认提交策略：

- 若用户接受一并提交：`git add apps/frontend/src/routes/_layout.tsx` 后整体提交。
- 若需分离：仅做暂存区之外的增量时无法用 `git add -p`（交互命令不可用），请保持本次改动不提交，或让用户决定。

提交信息（含在途改动时）：

```bash
git add apps/frontend/src/routes/_layout.tsx
git commit -m "feat(theme): ProLayout 顶栏接入 ThemeSwitcher"
```

---

### 任务 6：全量验证 + 浏览器手动验证

**文件：** 无（只做验证）

- [ ] **步骤 1：全量 typecheck + 测试**

运行：`pnpm typecheck && pnpm test` 预期：全仓 typecheck 通过、测试全绿。

- [ ] **步骤 2：浏览器手动验证 UI（必须）**

启动前端：`pnpm --filter @lucy/frontend dev`（后端若未启动，登录/布局页面可能因鉴权拦截跳登录，可用已登录会话或临时把 `_layout.tsx` 的 `beforeLoad` 判断临时放开验证后再还原——不要提交该临时改动）。

验证清单：

1. 首次访问（无 `lucy.theme`）默认跟随系统：系统暗色则整体暗色，系统亮色则亮色。
2. 顶栏右侧出现切换按钮，图标随当前生效模式在 Sun/Moon 间切换。
3. 点击弹出三项菜单，选中项高亮。
4. 选「暗色」→ antd 组件与页面背景转暗，`<html>` 带 `.dark` 类；选「亮色」恢复。
5. 选「跟随系统」→ 切换操作系统明暗，页面实时跟随。
6. 刷新页面后保持上次选择（localStorage `lucy.theme`）。
7. 登录/注册页（`/login`）同样受主题影响（全局生效）。
8. 若布局页存在 `dark:` 前缀的 Tailwind 类，验证随 `.dark` class 生效。

---

## 自检记录

- **规格覆盖度**：背景与目标 5 条全部对应（入口顶栏=任务 4/5；默认跟随系统=任务 2；全局生效=任务 3 + ThemeProvider 渲染 ConfigProvider；持久化=任务 2；实时跟随=任务 2）。设计各 Section：模块结构=任务 2/4；错误处理（matchMedia 兜底）=ThemeProvider 内 `getSystemDark` 守卫；测试=任务 2/4。
- **占位符扫描**：无 TODO/占位，每步含完整代码与预期输出。
- **类型一致性**：`ThemeMode`/`ThemeContextValue`/`resolvedTheme` 命名贯穿 ThemeProvider、index.ts、ThemeSwitcher、测试一致；`setMode` 接收 `ThemeMode`。
