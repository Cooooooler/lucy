---
layout: home

hero:
  name: '@coool/file-nest'
  text: NestJS 文件存储集成模块
  tagline: 纯存储层 · 存储驱动抽象 · NestJS DI
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/Cooooooler/lucy

features:
  - title: 纯存储层
    details: 零 TypeORM、不管理任何数据库表；文件元数据与属主关系由调用方持久化。
  - title: 存储驱动抽象
    details: StorageDriver 接口 + 本地磁盘实现，可插拔换 S3。
  - title: NestJS DI
    details: forRoot/forRootAsync 注册全局，FileService 注入即用。
---
