import { describe, expect, it } from 'vitest';
import { REDIS_NEST_VERSION } from './index.js';

describe('@coool/redis-nest 骨架', () => {
  it('导出占位版本常量', () => {
    expect(REDIS_NEST_VERSION).toBe('0.1.0');
  });
});
