import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

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
