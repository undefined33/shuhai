import { BrowserWindow, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { updateConfig, type AppConfig } from './app-config.js';
import { assertAllowedExternalUrl } from './external-url.js';
import { withContentSecurityPolicy } from './content-security-policy.js';

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

  attachContentSecurityPolicy(window);

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

  attachExternalNavigationGuards(window);

  return window;
}

function attachContentSecurityPolicy(window: BrowserWindow): void {
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: withContentSecurityPolicy(details.responseHeaders),
    });
  });
}

function persistWindowBounds(window: BrowserWindow): void {
  void updateConfig({ windowBounds: window.getBounds() });
}

function attachExternalNavigationGuards(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (url === window.webContents.getURL()) {
      return;
    }

    event.preventDefault();
    void openExternalUrl(url);
  });
}

async function openExternalUrl(url: string): Promise<void> {
  try {
    assertAllowedExternalUrl(url);
    await shell.openExternal(url);
  } catch {
    // Ignore blocked navigation attempts; the renderer shows errors for explicit user clicks.
  }
}
