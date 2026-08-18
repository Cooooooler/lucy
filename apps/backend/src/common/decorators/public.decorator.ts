import { SetMetadata } from '@nestjs/common';

/** 标记路由为公开：跳过全局 JwtAuthGuard，无需 Bearer token（登录/注册/刷新/健康检查等） */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
