import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: '@coool/file-nest',
  description: 'NestJS 文件存储集成模块：存储驱动抽象、元数据、DI',
  themeConfig: {
    nav: [
      { text: '指南', link: '/guide/getting-started' },
      { text: 'API', link: '/api/' },
      { text: '路线图', link: '/guide/roadmap' },
    ],
    sidebar: [
      {
        text: '指南',
        items: [
          { text: '快速开始', link: '/guide/getting-started' },
          { text: '连接配置', link: '/guide/configuration' },
          { text: 'FileService', link: '/guide/file-service' },
          { text: '存储驱动', link: '/guide/storage-driver' },
        ],
      },
      {
        text: 'API 参考',
        items: [{ text: 'API 索引', link: '/api/' }],
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
