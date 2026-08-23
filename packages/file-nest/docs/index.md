---
layout: home

hero:
  name: '@coool/file-nest'
  text: NestJS 文件存储集成模块
  tagline: 存储驱动抽象 · 元数据落库 · NestJS DI
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/Cooooooler/lucy

features:
  - title: 存储驱动抽象
    details: StorageDriver 接口 + 本地磁盘实现，可插拔换 S3。
  - title: 统一元数据
    details: FileEntity 落库记录文件名/MIME/大小/哈希，便于溯源。
  - title: NestJS DI
    details: forRoot/forRootAsync 注册全局，FileService 注入即用。
---
