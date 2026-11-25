import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/** 每个用例后卸载组件，避免残留 DOM 影响 `getByRole` 等查询 */
afterEach(() => {
  cleanup();
});

// jsdom 不实现 scrollTo（hook 的 resetToTop 会调用它）；
// 测试里通过 `vi.spyOn(element, 'scrollTo')` 观察调用
if (typeof Element !== 'undefined') {
  Object.defineProperty(Element.prototype, 'scrollTo', {
    writable: true,
    configurable: true,
    value: () => {},
  });
}
