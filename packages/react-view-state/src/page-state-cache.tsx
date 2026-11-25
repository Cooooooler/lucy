import { useSelector } from '@tanstack/react-store';
import { createStore, type Store } from '@tanstack/store';
import {
  createContext,
  use,
  useCallback,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

/**
 * 页面级 UI 状态缓存：把「再次进入路由时需要恢复」的 state 托管到模块作用域的 store。
 *
 * 用法：在路由的 component 外面包一层 `<PageStateCache cacheKey="...">`，页面内用
 * `usePageState(field, initial)` 替代 `useState`。页面卸载后 store 仍然存活，重新挂载时
 * 第一次渲染就读到上次的值，不需要 effect、也不会闪一帧初始值。
 *
 * 边界：
 * - 只缓存 UI 状态（筛选条件、滚动锚点、展开项…）。服务端数据归 TanStack Query，
 *   两套缓存并存会互相打架。
 * - 不缓存不可序列化的值（DOM 节点、Form 实例），否则以后想接 sessionStorage 就没法做。
 * - 组件是外壳：没走 `usePageState` 的 `useState` 不会被缓存。抽屉开关、表单状态通常
 *   也不该被恢复。
 * - 内存态，F5 即清空；要跨刷新恢复需另加持久化。
 */
type PageState = Record<string, unknown>;

/**
 * cacheKey -> 该页面的状态容器。
 *
 * 页面卸载后不清理，这就是「缓存」本体。key 用固定字符串或路由 id（不要拼路由参数，
 * 否则注册表会按参数无界增长）；登出时用 {@link clearPageStateCaches} 统一复位。
 */
const stores = new Map<string, Store<PageState>>();

function storeOf(cacheKey: string): Store<PageState> {
  let store = stores.get(cacheKey);
  if (!store) {
    store = createStore<PageState>({});
    stores.set(cacheKey, store);
  }
  return store;
}

const PageStateContext = createContext<Store<PageState> | null>(null);

export type PageStateCacheProps = {
  /** 页面标识；页面内所有 `usePageState` 的字段都挂在这份容器下 */
  cacheKey: string;
  children: ReactNode;
};

/**
 * 页面状态缓存的作用域容器。
 *
 * 只负责「绑定到哪份 store」——store 在模块作用域注册，重复挂载拿到的是同一份，
 * 因此不需要在这里做任何保存/恢复动作。
 */
export const PageStateCache = ({ cacheKey, children }: PageStateCacheProps) => (
  <PageStateContext value={storeOf(cacheKey)}>{children}</PageStateContext>
);

/**
 * 读取一个被缓存的页面状态，签名与 `useState` 一致。
 *
 * `field` 在同一 `cacheKey` 内应当唯一；`initial` 只在 store 里还没有该字段时生效
 * （挂载时冻结，之后不会再被初始值覆盖）。返回的函数式更新与 `useState` 相同。
 */
export function usePageState<T>(
  field: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const store = use(PageStateContext);
  if (!store) {
    throw new Error('usePageState 必须放在 <PageStateCache> 内使用');
  }

  // 初值只消费一次：用 state 冻结而不是 ref —— 读 ref.current 发生在渲染期，
  // React Compiler 会把它判为「渲染期读 ref」。函数初值也按值保存（不当作 lazy init）。
  const [frozenInitial] = useState<T>(() => initial);

  const value = useSelector(store, (state) =>
    field in state ? (state[field] as T) : frozenInitial,
  );

  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      store.setState((state) => {
        const prev = field in state ? (state[field] as T) : frozenInitial;
        const value =
          typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;
        // 相等时不换对象，避免每次写入都触发整页订阅者重渲染
        return Object.is(state[field], value)
          ? state
          : { ...state, [field]: value };
      });
    },
    [frozenInitial, field, store],
  );

  return [value, setValue];
}

/** 清空全部页面的缓存（登出 / 会话过期时调用，避免下一个账号读到上一个账号的状态） */
export function clearPageStateCaches(): void {
  for (const store of stores.values()) {
    store.setState(() => ({}));
  }
}

/** 清空单个页面的缓存（例如删除某个实体的详情页缓存） */
export function resetPageStateCache(cacheKey: string): void {
  stores.get(cacheKey)?.setState(() => ({}));
}
