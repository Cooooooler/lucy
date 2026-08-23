import { describe, expect, it } from 'vitest';

import { FILE_NEST_VERSION } from './index.js';

describe('FILE_NEST_VERSION', () => {
  it('declares the package version', () => {
    expect(FILE_NEST_VERSION).toBe('0.1.0');
  });
});
