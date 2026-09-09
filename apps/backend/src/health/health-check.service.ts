import { Injectable } from '@nestjs/common';
import { HealthCheckService as TerminusHealthCheckService } from '@nestjs/terminus';
import { HealthResultDto } from './dto/health-result.dto.js';

type IndicatorFn = () => Promise<unknown>;

@Injectable()
export class HealthCheckService {
  constructor(private readonly terminus: TerminusHealthCheckService) {}

  async check(indicators: IndicatorFn[]): Promise<HealthResultDto> {
    try {
      await this.terminus.check(indicators as never);
      return { status: 'ok', db: true, redis: true };
    } catch {
      const db = await this.probe(indicators[0]);
      const redis = await this.probe(indicators[1]);
      return { status: 'degraded', db, redis };
    }
  }

  private async probe(indicator: IndicatorFn | undefined): Promise<boolean> {
    if (!indicator) return true;
    try {
      await indicator();
      return true;
    } catch {
      return false;
    }
  }
}
