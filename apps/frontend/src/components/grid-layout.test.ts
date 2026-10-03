import { describe, expect, it } from 'vitest';
import {
  columnWidthOperand,
  computeGridLayout,
  GRID_GAP,
  GRID_MAX_COLUMNS,
  GRID_MIN_COLUMN_WIDTH,
  GRID_TOP_GAP,
} from './grid-layout';

describe('GRID_TOP_GAP', () => {
  it('顶部留白让第一行卡片不贴着工具栏', () => {
    expect(GRID_TOP_GAP).toBeGreaterThan(0);
  });
});

describe('columnWidthOperand', () => {
  it('只扣列间距，内边距由 PageShell 承担', () => {
    // 内边距来自 PageShell，虚拟卡片的包含块已是滚动容器的内容盒，不再重复扣除
    expect(columnWidthOperand(3, 16)).toBe('(100% - 32px) / 3'); // 2*16
    // 单列没有列间距 → 与内容盒等宽
    expect(columnWidthOperand(1, 16)).toBe('(100% - 0px) / 1');
  });
});

describe('computeGridLayout', () => {
  it('窄屏单列', () => {
    const layout = computeGridLayout(375);
    expect(layout.columns).toBe(1);
    expect(layout.columnWidth).toBe(375);
  });

  it('中屏两列，列宽扣掉列间距', () => {
    const layout = computeGridLayout(768);
    expect(layout.columns).toBe(2);
    expect(layout.columnWidth).toBe((768 - GRID_GAP) / 2);
  });

  it('宽屏最多到上限列数', () => {
    expect(computeGridLayout(1280).columns).toBe(4);
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
