import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class TypeOrmHealthIndicator {
  constructor(
    private readonly indicators: HealthIndicatorService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async isHealthy(key = 'database') {
    return this.indicators.check(key).attempt(async () => {
      await this.dataSource.query('SELECT 1');
    });
  }
}
