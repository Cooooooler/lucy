/**
 * 路由按需加载的统一兜底加载态。
 *
 * autoCodeSplitting 后每个路由组件是独立 chunk，首次进入大 chunk 路由（/chat、/knowledge
 * 等）需要等下载完成；此前全量静态引入时导航是即时的，故由 router 的
 * `defaultPendingComponent` 统一补一个轻量反馈。
 *
 * 刻意不依赖 antd：本组件经 router 进入入口模块图，引入组件库会按需把它拉进入口 chunk。
 * 颜色走 antd 主题变量，取不到时回退到默认主色（浅/深色下都可见）。
 */
export function RoutePending() {
  return (
    <div className="flex h-full min-h-40 w-full items-center justify-center">
      <div
        role="status"
        aria-label="加载中"
        className="h-6 w-6 animate-spin rounded-full border-2 border-solid"
        style={{
          borderColor: 'var(--ant-color-primary, #1677ff)',
          borderTopColor: 'transparent',
        }}
      />
    </div>
  );
}
