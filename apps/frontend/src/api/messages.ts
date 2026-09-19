/**
 * 成功提示事件总线：后端是文案的唯一来源，`unwrapEnvelope` 解包成功信封后，
 * 把 `message` 广播到这里；`ApiMessageBridge` 在应用根订阅并经 antd `message`
 * 展示。纯 TS、无 React 依赖，便于单测。
 */
export type ApiSuccessListener = (text: string) => void;

const listeners = new Set<ApiSuccessListener>();

/** 订阅成功提示。返回退订函数，组件卸载时调用。 */
export function onApiSuccessMessage(listener: ApiSuccessListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 广播一条成功提示（空串不广播，由调用方保证）。 */
export function emitApiSuccessMessage(text: string): void {
  // 快照遍历 + 逐个兜底：广播发生在解包同步路径上，任一订阅者抛错
  // 或同步退订都不能污染已成功的数据流，也不能跳过其余订阅者。
  for (const listener of [...listeners]) {
    try {
      listener(text);
    } catch {
      // 单个展示失败不影响请求结果与其他订阅者
    }
  }
}
