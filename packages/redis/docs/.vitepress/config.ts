import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: '@coool/redis-nest',
  description:
    'NestJS Redis 集成模块：连接管理、序列化、DI、多数据源、统一异常',
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
          { text: '连接配置', link: '/guide/configuration' },
          { text: 'RedisService', link: '/guide/redis-service' },
          { text: '异常处理', link: '/guide/exceptions' },
          { text: '序列化', link: '/guide/serialization' },
          { text: '多数据源（forFeature）', link: '/guide/for-feature' },
          { text: '工具', link: '/guide/utilities' },
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
