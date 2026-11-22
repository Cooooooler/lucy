import { contextBridge } from 'electron';

/**
 * 渲染进程目前只通过 HTTP 访问后端，这里先暴露最小的运行时信息；
 * 后续需要主进程能力（文件、窗口、通知等）时在此增加 IPC 桥接。
 */
const desktopApi = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
};

contextBridge.exposeInMainWorld('lucyDesktop', desktopApi);

export type DesktopApi = typeof desktopApi;
