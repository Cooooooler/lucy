---
layout: home

hero:
  name: '@coool/redis-nest'
  text: NestJS Redis 集成模块
  tagline: 连接管理 · 序列化 · DI · 多数据源 · 统一异常
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/Cooooooler/lucy

features:
  - title: 连接管理
    details: forRoot / forRootAsync 支持单机、哨兵、Cluster 三种模式，内置生产默认参数（重试、重连、超时）。
  - title: 统一 DI 与异常
    details: RedisService 注入即用；ioredis 底层错误统一包装为 RedisException，带稳定错误码。
  - title: 序列化
    details: 默认 JSON，自定义序列化器可替换，自动处理 Date；getJson / setJson 开箱即用。
  - title: 多数据源
    details: forFeature 命名客户端 + key 前缀命名空间，多连接与 key 隔离双支持。（规划中）
---
