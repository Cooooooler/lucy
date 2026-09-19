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
  for (const listener of listeners) {
    listener(text);
  }
}
