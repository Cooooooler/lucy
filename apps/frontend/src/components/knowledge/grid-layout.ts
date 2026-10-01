/** 卡片间距（列间与行间共用） */
export const GRID_GAP = 16;
/**
 * 网格顶部留白：第一行卡片与工具栏之间的间距。
 *
 * 加载骨架与虚拟网格都要用它，两条路径必须同源——骨架少了这段，冷加载完成那一刻
 * 整个网格会整体上移这一段距离。
 */
export const GRID_TOP_GAP = 16;
/** 单列最小宽度：低于此宽度就减少列数 */
export const GRID_MIN_COLUMN_WIDTH = 300;
/** 最大列数（超宽屏不再继续增加） */
export const GRID_MAX_COLUMNS = 4;
/**
 * 卡片高度；虚拟化按固定行高（本值 + GRID_GAP）布局，不再测量元素。
 *
 * 这是**硬约束**：卡片必须保持等高——标题单行省略 + 描述固定 `h-11`。
 * 真实实测高度为卡片 210px、虚拟化 wrapper（卡片 + 底部间距）226px。
 * **改动卡片高度必须同步改这里**，否则虚拟化的行高与真实高度不一致，
 * 会导致滚动位置与恢复锚点整体偏移（固定行高下没有任何回填测量的机会去纠正）。
 */
export const CARD_ESTIMATED_HEIGHT = 210;

export interface GridLayout {
  /** 列数（lanes） */
  columns: number;
  /** 单列宽度（px） */
  columnWidth: number;
  /** 间距（px） */
  gap: number;
}

/**
 * 根据滚动容器宽度计算网格几何：列数与列宽。
 * 等价于 `repeat(auto-fill, minmax(300px, 1fr))`，但列数可提前算出以驱动虚拟化的 lanes。
 *
 * 宽度按**满宽**参与计算（不再扣内边距）：左右内边距由 PageShell 以 Tailwind
 * `px-4 sm:px-6 md:px-8` 提供，而虚拟列表用绝对定位、其包含块就是滚动容器的内容盒——
 * 内容盒已经把 PageShell 的内边距排除在外，再扣一次就会双倍留白（且卡片会比工具条右移一段）。
 * 同一份内边距曾在此用 JS 复刻断点，现已随 PageShell 收敛到单一来源。
 */
export function computeGridLayout(width: number): GridLayout {
  const columns = Math.max(
    1,
    Math.min(
      GRID_MAX_COLUMNS,
      Math.floor((width + GRID_GAP) / (GRID_MIN_COLUMN_WIDTH + GRID_GAP)),
    ),
  );
  const columnWidth = Math.max(0, (width - GRID_GAP * (columns - 1)) / columns);
  return { columns, columnWidth, gap: GRID_GAP };
}

/**
 * 卡片列宽的 CSS **算式主体**（调用方自行包一层 `calc()`）：
 * 与虚拟网格共用同一份几何，避免两处手抄后漂移。
 *
 * 返回形如 `(100% - 32px) / 3` 的运算式，便于嵌进更复杂的表达式
 * （`left: calc(2 * ((100% - 32px) / 3 + 16px))`）——`calc()` 不能嵌套 `calc()`。
 */
export function columnWidthOperand(columns: number, gap: number): string {
  return `(100% - ${gap * (columns - 1)}px) / ${columns}`;
}
