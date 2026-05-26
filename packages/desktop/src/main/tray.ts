import { Menu, Tray, app, nativeImage } from 'electron';

interface AppTrayOptions {
  showMainWindow: () => void;
  syncNow: () => Promise<void>;
  quit: () => void;
}

let tray: Tray | null = null;

export function createAppTray(options: AppTrayOptions): Tray {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('ShuHai 书海');
  tray.setContextMenu(createTrayMenu(options));
  tray.on('double-click', options.showMainWindow);
  return tray;
}

function createTrayMenu(options: AppTrayOptions): Menu {
  return Menu.buildFromTemplate([
    { label: '打开主窗口', click: options.showMainWindow },
    {
      label: '立即同步',
      click: () => {
        void options.syncNow();
      },
    },
    { type: 'separator' },
    { label: '退出', click: options.quit },
  ]);
}

function createTrayIcon(): Electron.NativeImage {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect x="7" y="4" width="18" height="24" rx="3" fill="#2563eb"/>
      <path d="M12 4h10a3 3 0 0 1 3 3v21l-5-3-5 3V7a3 3 0 0 0-3-3z" fill="#10b981"/>
      <path d="M11 10h8M11 15h8" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;
  const image = nativeImage.createFromDataURL(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  );

  if (process.platform === 'darwin') {
    image.setTemplateImage(true);
  }

  return image;
}

app.on('before-quit', () => {
  tray?.destroy();
  tray = null;
});
