import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: '@coool/react-view-state',
  description: 'React 视图状态：页面级状态缓存与滚动位置记忆',
  themeConfig: {
    nav: [
      { text: '指南', link: '/guide/getting-started' },
      { text: '路线图', link: '/guide/roadmap' },
    ],
    sidebar: [
      {
        text: '指南',
        items: [
          { text: '快速开始', link: '/guide/getting-started' },
          { text: '页面状态缓存', link: '/guide/page-state' },
          { text: '滚动位置记忆', link: '/guide/scroll-memory' },
        ],
      },
      {
        text: '项目',
        items: [{ text: '路线图', link: '/guide/roadmap' }],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/Cooooooler/lucy' },
    ],
    footer: {
      message: 'MIT License',
      copyright: 'Copyright © 2026 Cooooooler',
    },
  },
});
