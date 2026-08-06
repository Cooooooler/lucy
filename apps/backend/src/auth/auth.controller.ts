import type { User } from '@lucy/shared';
import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';

const REFRESH_COOKIE = 'refreshToken';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<User> {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
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

  @Post('logout')
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

  @Get('me')
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
