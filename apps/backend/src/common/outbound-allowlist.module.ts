import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OUTBOUND_PRIVATE_HOST_ALLOWLIST,
  parsePrivateHostAllowlist,
} from './outbound-allowlist.js';

/**
 * 出站私网白名单的配置 provider。
 *
 * 一次解析、多处消费：`GuardedFetchService`（连接池策略）与
 * `ModelProviderService`（保存校验/审计）共同 import 本模块，避免两处各自
 * 推导白名单语义导致策略漂移；领域层也不必再依赖出站请求的基础设施模块。
 */
@Module({
  providers: [
    {
      provide: OUTBOUND_PRIVATE_HOST_ALLOWLIST,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ReadonlySet<string> =>
        parsePrivateHostAllowlist(config.get('OUTBOUND_ALLOW_PRIVATE_HOSTS')),
    },
  ],
  exports: [OUTBOUND_PRIVATE_HOST_ALLOWLIST],
})
export class OutboundAllowlistModule {}
