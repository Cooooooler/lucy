import { App } from 'antd';
import { useEffect } from 'react';
import { onApiSuccessMessage } from '../api/messages';

/**
 * 全局成功提示桥：挂在应用根 `<AntdApp>` 内，订阅后端 success message 并
 * 经 `message.success` 展示。返回 null，不渲染任何 DOM。
 *
 * 前端不决定提示文案与时机（只负责展示）：是否弹出由后端的 `message` 字段
 * 与客户端的变更方法 + `skipSuccessMessage` 标记共同决定，见 `api/client.ts`。
 */
export function ApiMessageBridge() {
  const { message } = App.useApp();

  useEffect(
    () => onApiSuccessMessage((text) => message.success(text)),
    [message],
  );

  return null;
}
