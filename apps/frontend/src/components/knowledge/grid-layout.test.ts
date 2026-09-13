import { describe, expect, it } from 'vitest';
import {
  computeGridLayout,
  computeHorizontalPadding,
  GRID_GAP,
  GRID_MAX_COLUMNS,
  GRID_MIN_COLUMN_WIDTH,
} from './grid-layout';

describe('computeHorizontalPadding', () => {
  it('按容器宽度分档', () => {
    expect(computeHorizontalPadding(375)).toBe(16);
    expect(computeHorizontalPadding(639)).toBe(16);
    expect(computeHorizontalPadding(640)).toBe(24);
    expect(computeHorizontalPadding(767)).toBe(24);
    expect(computeHorizontalPadding(768)).toBe(32);
    expect(computeHorizontalPadding(1920)).toBe(32);
  });
});

describe('computeGridLayout', () => {
  it('窄屏单列，列宽扣掉内边距', () => {
    const layout = computeGridLayout(375);
    expect(layout.columns).toBe(1);
    expect(layout.padding).toBe(16);
    expect(layout.columnWidth).toBe(375 - 32);
  });

  it('中屏两列，列宽扣掉内边距与列间距', () => {
    const layout = computeGridLayout(768);
    expect(layout.padding).toBe(32);
    expect(layout.columns).toBe(2);
    expect(layout.columnWidth).toBe((768 - 64 - GRID_GAP) / 2);
  });

  it('宽屏最多到上限列数', () => {
    expect(computeGridLayout(1280).columns).toBe(3);
    expect(computeGridLayout(1600).columns).toBe(4);
    expect(computeGridLayout(3840).columns).toBe(GRID_MAX_COLUMNS);
  });

  it('列宽不小于最小列宽（满足 auto-fill 语义）', () => {
    for (const width of [375, 640, 768, 1024, 1280, 1600, 2560]) {
      const layout = computeGridLayout(width);
      expect(layout.columnWidth).toBeGreaterThanOrEqual(
        GRID_MIN_COLUMN_WIDTH - 1,
      );
    }
  });

  it('宽度为 0 时退化为单列且不出现负值', () => {
    const layout = computeGridLayout(0);
    expect(layout.columns).toBe(1);
    expect(layout.columnWidth).toBe(0);
  });
});
