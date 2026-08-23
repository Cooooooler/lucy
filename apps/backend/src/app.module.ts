import { FileModule } from '@coool/file-nest';
import { RedisModule } from '@coool/redis-nest';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { AiModule } from './ai/ai.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { CommonModule } from './common/common.module.js';
import { loggerModuleOptions } from './common/logger-options.js';
import { HealthModule } from './health/health.module.js';
import { KnowledgeModule } from './knowledge/knowledge.module.js';
import { UsersModule } from './users/users.module.js';

/** 从 ConfigService 读取 Redis 连接配置（提取为纯函数便于单测；端口强制 Number，因 ConfigService 可能返回字符串） */
export function redisModuleOptions(config: ConfigService) {
  return {
    type: 'standalone' as const,
    host: config.get<string>('REDIS_HOST', '127.0.0.1'),
    port: Number(config.get<number>('REDIS_PORT', 6379)),
  };
}

/** 从 ConfigService 读取文件存储配置（提取为纯函数便于单测） */
export function fileModuleOptions(config: ConfigService) {
  return {
    dir: config.get<string>('UPLOAD_DIR', 'uploads'),
    storage: config.get<string>('FILE_STORAGE', 'local'),
  };
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot(loggerModuleOptions()),
    CommonModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', '127.0.0.1'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_USER', 'postgres'),
        password: config.get<string>('DB_PASSWORD', 'postgres'),
        database: config.get<string>('DB_NAME', 'lucy'),
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    UsersModule,
    RedisModule.forRootAsync({
      inject: [ConfigService],
      useFactory: redisModuleOptions,
    }),
    AuthModule,
    AiModule,
    FileModule.forRootAsync({
      inject: [ConfigService],
      useFactory: fileModuleOptions,
    }),
    KnowledgeModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
