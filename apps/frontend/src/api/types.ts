import type { components } from '@lucy/shared';

// API 契约类型：从后端 Swagger 生成的 components.schemas 派生，勿手改字段
export type User = components['schemas']['User'];
export type AuthTokens = components['schemas']['AuthTokensDto'];
export type LoginResult = components['schemas']['LoginResultDto'];
export type LoginRequest = components['schemas']['LoginDto'];
export type RegisterRequest = components['schemas']['RegisterDto'];
export type RefreshRequest = components['schemas']['RefreshDto'];
