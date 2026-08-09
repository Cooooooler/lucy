# 前端主题切换设计

日期：2026-08-09 分支：feature/auth-login

## 背景与目标

前端增加主题切换能力，支持 **亮色 / 暗色 / 跟随系统** 三种模式。目标：

1. 切换入口放在 ProLayout **顶栏右侧**（`actionsRender`）。
2. 首次访问（无已存偏好）默认**跟随系统**。
3. 主题**全局生效**，覆盖登录/注册页（`_auth`）与登录后布局页（`_layout`）。
4. 选择持久化到 localStorage，刷新后保持。
5. 跟随系统模式下，系统明暗切换时页面实时响应。

## 决策记录

- **方案**：`ThemeProvider`（React Context + ahooks `useLocalStorageState` 持久化），与 `AuthProvider` 同款模式。不使用 TanStack Store（对单页略重）、不引入第三方主题库。
- **模式取值**：`ThemeMode = 'light' | 'dark' | 'system'`；Context 同时暴露实际生效值 `resolvedTheme: 'light' | 'dark'`。
- **系统跟随**：`useSyncExternalStore` 订阅 `matchMedia('(prefers-color-scheme: dark)')`，`mode === 'system'` 时实时映射为明/暗。
- **antd 应用**：`ConfigProvider` 移入 `ThemeProvider` 内渲染，`theme={{ algorithm: resolvedTheme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm }}`，保留 `locale={zhCN}`。
- **Tailwind 应用**：`resolvedTheme` 为 dark 时给 `<html>` 加 `.dark` 类；`index.css` 加 `@custom-variant dark (&:where(.dark, .dark *))`，让 `dark:` 前缀跟随 class 而非媒体查询。
- **切换控件**：Dropdown 图标按钮（Sun/Moon/Monitor 随当前模式）+ 三项菜单（亮色/暗色/跟随系统），放入 ProLayout `actionsRender`。

## 新增依赖

无（antd 6 已内置 `theme.darkAlgorithm` / `theme.defaultAlgorithm`）。

## Section 1：模块结构

```
apps/frontend/src/theme/
  ThemeProvider.tsx          — Context + 持久化 + 系统跟随 + 应用副作用 + 渲染 ConfigProvider
  index.ts                   — 导出 ThemeProvider、useTheme、ThemeMode 类型
apps/frontend/src/components/theme-switcher.tsx  — 顶栏切换控件
```

## Section 2：ThemeProvider

`ThemeProvider` 对外暴露：

```ts
type ThemeMode = 'light' | 'dark' | 'system';
interface ThemeContextValue {
  mode: ThemeMode; // 用户选择
  setMode: (m: ThemeMode) => void;
  resolvedTheme: 'light' | 'dark'; // 实际生效值
}
```

实现要点：

- `useLocalStorageState<ThemeMode>('lucy.theme', { defaultValue: 'system' })` 持久化选择。
- `systemDark: boolean` 用 `useSyncExternalStore` 订阅 `matchMedia('(prefers-color-scheme: dark)')`，`change` 事件实时更新。
- `resolvedTheme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode`。
- `useEffect`：`document.documentElement.classList.toggle('dark', resolvedTheme === 'dark')`。
- `matchMedia` 不可用时 `systemDark` 恒为 `false`（回退 light 的保险分支）。
- 渲染 `<ConfigProvider locale={zhCN} theme={{ algorithm: ... }}>{children}</ConfigProvider>`。

`main.tsx` 变更：根部 `<ThemeProvider>` 包裹，原 `ConfigProvider` 移除（由 ThemeProvider 内部渲染）。

## Section 3：切换控件（theme-switcher.tsx）

- 读取 `useTheme()`：`mode`、`setMode`、`resolvedTheme`。
- antd `Dropdown` 菜单三项：亮色 / 暗色 / 跟随系统（带选中态），菜单项点击调 `setMode`。
- 触发器为图标按钮，图标按 `resolvedTheme` 显示：`SunOutlined`（亮）/ `MoonOutlined`（暗），`system` 模式下跟随 resolved 的图标即可。
- `_layout.tsx` ProLayout 加 `actionsRender={() => [<ThemeSwitcher key="theme" />]}`。

## Section 4：错误处理

- `matchMedia` 不存在（非浏览器环境）→ `systemDark` 回退 `false`，跟随系统等价于亮色。
- localStorage 异常由 ahooks `useLocalStorageState` 内部处理，失败不阻塞渲染（默认 system）。

## Section 5：测试

- `ThemeProvider.test.tsx`：
  - 默认 `mode === 'system'`。
  - `setMode('dark')` 后 `resolvedTheme === 'dark'` 且持久化到 localStorage。
  - 刷新（重新挂载）读回已存偏好。
  - `mode === 'system'` 时 mock `matchMedia` 变化，`resolvedTheme` 跟随；`change` 事件触发重新渲染。
  - `.dark` class 在 resolved 为 dark 时应用到 `<html>`，为 light 时移除。
- `theme-switcher.test.tsx`：
  - 渲染当前模式图标/菜单选中态。
  - 点击菜单项调用 `setMode`。
- 覆盖率门槛 80%，新增文件需覆盖。

## 风险与取舍

- antd 6 的 `darkAlgorithm` 以安装版本（6.5.3）实际导出为准（已验证存在）。
- Tailwind 4 的 `@custom-variant` 语法以 4.3.3 为准；当前代码尚无 `dark:` 前缀使用，不影响现有页面。
- 首版不改品牌色 token，仅明暗算法切换；后续如需自定义暗色配色再扩展。
