import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import {
  hardenWindow,
  installGlobalGuards,
  installSessionSecurity,
} from './security';
import { startRendererServer, type RendererServer } from './server';

let rendererServer: RendererServer | undefined;

function createWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // 安全默认：渲染进程不碰 Node，能力只经 preload / IPC 暴露
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  hardenWindow(win.webContents, new URL(url).origin);

  void win.loadURL(url);
  return win;
}

async function resolveRenderer(): Promise<{ url: string; isDev: boolean }> {
  // dev：electron-vite 启动 renderer dev server 后注入该变量
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devUrl) {
    return { url: devUrl, isDev: true };
  }
  // build / preview / 打包后：本地 HTTP 静态服务器 + API 同源反代
  rendererServer = await startRendererServer(join(__dirname, '../renderer'));
  return { url: rendererServer.url, isDev: false };
}

installGlobalGuards();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  void app.whenReady().then(async () => {
    const { url, isDev } = await resolveRenderer();
    installSessionSecurity(isDev);
    createWindow(url);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    void rendererServer?.close();
  });
}
