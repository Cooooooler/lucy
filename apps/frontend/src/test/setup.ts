import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// 测试期间显式指定 API baseURL 为 '/api/'，与 vite dev 服务器（带 /api proxy）行为
// 一致。被 client.ts 顶层读取，必须在 client.ts 导入前赋值，否则 baseURL 已被
// 解析。setupFiles 在每个测试文件 import 之前执行，时机合适。
(globalThis as { __lucyApiBaseUrl?: string }).__lucyApiBaseUrl = '/api/';

afterEach(() => {
  cleanup();
});

// vitest 4 的 jsdom 环境不提供可用的 window.localStorage（vitest 4 的 jsdom 环境把
// window.localStorage 换成了空对象 / 回落到 Node 的原生实现）。这里无条件替换为内存
// 实现，保证 ahooks useLocalStorageState 等可正常工作。
// 注意：不要用 typeof window.localStorage 等读取原值——Node 25 默认暴露实验性全局
// localStorage（非功能性 stub），读取其 getter 会触发
// `Warning: --localstorage-file was provided without a valid path`。直接 defineProperty
// 覆盖（不读原值）即可既替换实现又不触发该无害警告。
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
}

if (typeof window !== 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
}

// antd 6 / pro-components 在多处读 matchMedia（如 responsiveObserver、
// useBreakpoint、StatisticsCard）。jsdom 不实现，统一桩为「无匹配 + 无监听」，
// 不影响任何渲染路径（生产 CSS 媒体查询仍由浏览器负责）。
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// jsdom 不实现 ResizeObserver，antd Dropdown / Splitter / rc-resize-observer
// 等会在挂载时使用它；统一桩为 no-op，避免组件一渲染就 ReferenceError。
if (typeof window !== 'undefined' && !('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {
      void 0;
    }

    unobserve(): void {
      void 0;
    }

    disconnect(): void {
      void 0;
    }
  }
  // antd 通过 window.ResizeObserver 拿到
  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    configurable: true,
    value: ResizeObserverStub,
  });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    configurable: true,
    value: ResizeObserverStub,
  });
}
