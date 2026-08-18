import type { components } from '@lucy/shared';
import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { User as UserEntity } from '../users/user.entity.js';
import { AuthService } from './auth.service.js';
import { LoginResultDto } from './dto/login-result.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { LogoutResultDto } from './dto/logout-result.dto.js';
import { RefreshResultDto } from './dto/refresh-result.dto.js';
import { RegisterDto } from './dto/register.dto.js';

const REFRESH_COOKIE = 'refreshToken';

// API 契约类型由 Swagger 生成的 components.schemas 派生
type User = components['schemas']['User'];

@ApiTags('auth')
@Controller('auth')
// 认证契约：长效 refresh token 经 HttpOnly cookie 下发/读取（安全、防 XSS），
// 短效 access token 放响应体由前端持有；refresh 失败时清除失效 cookie
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: '注册', description: '创建新账号并返回用户信息' })
  @ApiResponse({ status: 201, description: '注册成功', type: UserEntity })
  register(@Body() dto: RegisterDto): Promise<User> {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: '登录',
    description:
      '账号密码登录，返回用户信息与短效 access token；长效 token 写入 HttpOnly cookie',
  })
  @ApiResponse({ status: 201, description: '登录成功', type: LoginResultDto })
  @ApiResponse({ status: 401, description: '用户名或密码错误' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, accessToken, refreshToken } =
      await this.authService.login(dto);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken, user };
  }

  @Public()
  @Post('refresh')
  @ApiOperation({
    summary: '刷新令牌',
    description: '读取 HttpOnly cookie 换发短效 access token，并轮换长效 token',
  })
  @ApiResponse({ status: 201, description: '换发成功', type: RefreshResultDto })
  @ApiResponse({ status: 401, description: '缺少或无效的刷新令牌' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!token) {
      return this.authService.throwMissingRefresh();
    }
    try {
      const { accessToken, refreshToken } =
        await this.authService.refresh(token);
      this.setRefreshCookie(res, refreshToken);
      return { accessToken };
    } catch (err) {
      // 刷新失败（无效/复用/账号禁用）：清除失效 cookie，避免每次请求都打 401
      res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
      throw err;
    }
  }

  @ApiBearerAuth()
  @Post('logout')
  @ApiOperation({
    summary: '登出',
    description: '撤销当前会话整个家族并清除 cookie',
  })
  @ApiResponse({ status: 201, description: '登出成功', type: LogoutResultDto })
  @ApiResponse({ status: 401, description: '未登录或令牌失效' })
  async logout(
    @CurrentUser() user: CurrentUserPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    await this.authService.logout(user.jti, refreshToken);
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    return { success: true };
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: '当前用户信息' })
  @ApiResponse({
    status: 200,
    description: '返回当前登录用户',
    type: UserEntity,
  })
  @ApiResponse({ status: 401, description: '未登录或令牌失效' })
  me(@CurrentUser() user: CurrentUserPayload): Promise<User> {
    return this.authService.me(user.userId);
  }

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, this.cookieOptions());
  }

  private cookieOptions(): Record<string, unknown> {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.authService.cookieSecure(),
      path: '/',
      maxAge: this.authService.refreshTtl() * 1000,
    };
  }
}
