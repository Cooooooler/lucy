/** 卡片间距（列间与行间共用） */
export const GRID_GAP = 16;
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
  /** 单列宽度（px，已扣除 padding 与列间距） */
  columnWidth: number;
  /** 左右内边距（px） */
  padding: number;
  /** 间距（px） */
  gap: number;
}

/**
 * 左右内边距随容器宽度分档（对齐原 Tailwind 的 px-4 / sm:px-6 / md:px-8）。
 * 虚拟列表用绝对定位，容器的 padding 对绝对定位子元素不生效，故改为显式参与几何计算。
 */
export function computeHorizontalPadding(width: number): number {
  if (width >= 768) return 32;
  if (width >= 640) return 24;
  return 16;
}

/**
 * 根据滚动容器宽度计算网格几何：列数、列宽与内边距。
 * 等价于 `repeat(auto-fill, minmax(300px, 1fr))`，但列数可提前算出以驱动虚拟化的 lanes。
 */
export function computeGridLayout(width: number): GridLayout {
  const padding = computeHorizontalPadding(width);
  const available = Math.max(0, width - padding * 2);
  const columns = Math.max(
    1,
    Math.min(
      GRID_MAX_COLUMNS,
      Math.floor((available + GRID_GAP) / (GRID_MIN_COLUMN_WIDTH + GRID_GAP)),
    ),
  );
  const columnWidth = Math.max(
    0,
    (available - GRID_GAP * (columns - 1)) / columns,
  );
  return { columns, columnWidth, padding, gap: GRID_GAP };
}

/**
 * 卡片列宽的 CSS **算式主体**（调用方自行包一层 `calc()`）：
 * 与虚拟网格共用同一份几何，避免两处手抄后漂移——例如骨架里再扣一次内边距，就会比真实
 * 卡片窄 `2·padding/columns`、整行右端多出一截空白，恰好违背「骨架与列表几何同源」的初衷。
 *
 * 返回形如 `(100% - 48px) / 3` 的运算式，便于嵌进更复杂的表达式
 * （`left: calc(32px + 2 * ((100% - 48px) / 3 + 16px))`）——`calc()` 不能嵌套 `calc()`。
 *
 * 两条调用路径的**包含块不同**，所以内边距要按包含块实际包含的量传入：
 * - 虚拟网格：`100%` 解析到 `position: relative` 的包装层，它**没有**内边距（内边距由卡片
 *   `left` 补出来），因此传真实 `padding`；
 * - 加载骨架：`100%` 解析到带 `paddingLeft/Right` 的 flex 容器**内容盒**，内边距已被排除，
 *   因此传 `0`。
 */
export function columnWidthOperand(
  columns: number,
  gap: number,
  padding: number,
): string {
  return `(100% - ${padding * 2 + gap * (columns - 1)}px) / ${columns}`;
}
