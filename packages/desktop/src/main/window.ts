import { BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { updateConfig, type AppConfig } from './app-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CreateMainWindowOptions {
  initialBounds?: AppConfig['windowBounds'];
  isQuitting: () => boolean;
}

export async function createMainWindow(options: CreateMainWindowOptions): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: options.initialBounds?.width ?? 1120,
    height: options.initialBounds?.height ?? 760,
    x: options.initialBounds?.x,
    y: options.initialBounds?.y,
    minWidth: 860,
    minHeight: 560,
    show: false,
    title: 'ShuHai 书海',
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  window.on('close', (event) => {
    persistWindowBounds(window);
    if (options.isQuitting()) {
      return;
    }
    event.preventDefault();
    window.hide();
  });

  const devServerUrl = process.env.SHUHAI_RENDERER_DEV_SERVER_URL;
  if (devServerUrl) {
    await window.loadURL(devServerUrl);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    await window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}

function persistWindowBounds(window: BrowserWindow): void {
  void updateConfig({ windowBounds: window.getBounds() });
}
