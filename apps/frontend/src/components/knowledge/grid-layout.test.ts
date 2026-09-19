import { describe, expect, it } from 'vitest';
import {
  columnWidthOperand,
  computeGridLayout,
  computeHorizontalPadding,
  GRID_GAP,
  GRID_MAX_COLUMNS,
  GRID_MIN_COLUMN_WIDTH,
} from './grid-layout';

describe('columnWidthOperand', () => {
  it('扣掉 2·padding 与 (columns−1)·gap，得到列宽算式主体', () => {
    // 虚拟网格：包含块无内边距，传真实 padding（3 列、padding 32、gap 16）
    expect(columnWidthOperand(3, 16, 32)).toBe('(100% - 96px) / 3'); // 2*32 + 2*16
    // 加载骨架：容器的 padding 已被内容盒排除，传 0 —— 再扣一次就会比真实卡片窄
    expect(columnWidthOperand(3, 16, 0)).toBe('(100% - 32px) / 3');
    // 单列没有列间距，但仍要扣掉 2·padding（虚拟网格那条路径）
    expect(columnWidthOperand(1, 16, 24)).toBe('(100% - 48px) / 1');
    // 单列 + 内容盒已排除内边距 = 与容器等宽
    expect(columnWidthOperand(1, 16, 0)).toBe('(100% - 0px) / 1');
  });
});

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
