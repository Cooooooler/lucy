import type { User } from '@lucy/shared';
import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { User as UserEntity } from '../users/user.entity.js';
import { AuthService } from './auth.service.js';
import { AuthTokensDto } from './dto/auth-tokens.dto.js';
import { LoginResultDto } from './dto/login-result.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RegisterDto } from './dto/register.dto.js';

const REFRESH_COOKIE = 'refreshToken';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: '注册', description: '创建新账号并返回用户信息' })
  @ApiResponse({ status: 201, description: '注册成功', type: UserEntity })
  register(@Body() dto: RegisterDto): Promise<User> {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @ApiOperation({
    summary: '登录',
    description: '账号密码登录，返回 access/refresh 令牌',
  })
  @ApiResponse({ status: 201, description: '登录成功', type: LoginResultDto })
  @ApiResponse({ status: 401, description: '用户名或密码错误' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.login(dto);
    this.setRefreshCookie(res, tokens.refreshToken);
    return tokens;
  }

  @Public()
  @Post('refresh')
  @ApiOperation({
    summary: '刷新令牌',
    description: '用 refresh token 换发新令牌对',
  })
  @ApiResponse({ status: 201, description: '换发成功', type: AuthTokensDto })
  @ApiResponse({ status: 401, description: '刷新令牌无效' })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token =
      dto.refreshToken ?? (req.cookies?.[REFRESH_COOKIE] as string | undefined);
    if (!token) {
      return this.authService.throwMissingRefresh();
    }
    const tokens = await this.authService.refresh(token);
    this.setRefreshCookie(res, tokens.refreshToken);
    return tokens;
  }

  @ApiBearerAuth()
  @Post('logout')
  @ApiOperation({
    summary: '登出',
    description: '撤销当前 access 与 refresh 令牌',
  })
  @ApiResponse({ status: 201, description: '登出成功' })
  @ApiResponse({ status: 401, description: '未登录或令牌失效' })
  async logout(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken =
      dto.refreshToken ?? (req.cookies?.[REFRESH_COOKIE] as string | undefined);
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
      secure: false,
      path: '/',
      maxAge: this.authService.refreshTtl() * 1000,
    };
  }
}
