---
layout: home

hero:
  name: '@coool/react-view-state'
  text: React 视图状态
  tagline: 页面级状态缓存 · 滚动位置记忆 · 内存态零依赖后端
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/Cooooooler/lucy

features:
  - title: 页面状态缓存
    details: 路由重新进入时恢复筛选条件等 UI 状态；首帧就读到缓存值，不闪初始值。
  - title: 滚动位置记忆
    details: 普通容器自动恢复；虚拟化列表用 delegate 模式对齐内部 offset，避免白挂一窗。
  - title: 一致的清理语义
    details: 登出调用 clearViewCaches 一次清空页面状态与滚动位置，避免串账号。
---
