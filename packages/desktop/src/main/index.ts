import { app, BrowserWindow, dialog } from 'electron';
import {
  registerIpcHandlers,
  sendBookmarksChanged,
  sendSyncNextRun,
  sendSyncStatus,
} from './ipc.js';
import { createMainWindow } from './window.js';
import { createAppTray } from './tray.js';
import { loadConfig, type AppConfig } from './app-config.js';
import { closeDatabase, initializeDatabase, resetDatabaseFiles } from './db/index.js';
import {
  AutoSyncScheduler,
  ChromeBookmarkWatcher,
  type SyncResult,
  type SyncStatus,
  type SyncStatusState,
} from './sync/index.js';
import { handleStartupError } from './startup-error.js';
import { createLogger, initializeLogging } from './logger.js';

let mainWindow: BrowserWindow | null = null;
let bookmarkWatcher: ChromeBookmarkWatcher | null = null;
let autoSyncScheduler: AutoSyncScheduler | null = null;
let isQuitting = false;
const logger = createLogger('main');

function showMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

async function restartBookmarkWatcher(config: AppConfig): Promise<void> {
  bookmarkWatcher?.stop();
  logger.info('Chrome bookmark sync starting', { profile: config.chromeProfile });
  sendSyncStatus(mainWindow, createSyncStatus(
    'syncing',
    config.chromeProfile,
    '正在同步 Chrome 书签...',
  ));

  bookmarkWatcher = new ChromeBookmarkWatcher({
    profile: config.chromeProfile,
    onSync: (result) => {
      logger.info('Chrome bookmark sync changed bookmarks', { result });
      sendBookmarksChanged(mainWindow, result);
    },
    onError: (error) => {
      logger.error('Bookmark sync failed', { error });
      sendSyncStatus(mainWindow, createSyncStatus(
        'error',
        config.chromeProfile,
        '书签同步失败，请检查 Chrome Profile 后重试。',
        error.message,
      ));
    },
  });

  const syncResult = await bookmarkWatcher.syncNow();
  logger.info('Chrome bookmark sync completed', { result: syncResult });
  const startResult = bookmarkWatcher.start();
  if (startResult.success) {
    sendSyncStatus(mainWindow, createSyncStatus(
      'watching',
      config.chromeProfile,
      '书签同步正常，正在监听 Chrome 变化。',
    ));
  } else {
    sendSyncStatus(mainWindow, createSyncStatus(
      'not-started',
      config.chromeProfile,
      '未启动实时同步，请确认 Chrome 已安装并选择正确的 Profile。',
      startResult.reason,
    ));
  }
}

function restartAutoSync(config: Pick<AppConfig, 'syncIntervalMinutes'>): void {
  autoSyncScheduler?.stop(false);
  autoSyncScheduler = new AutoSyncScheduler({
    intervalMinutes: config.syncIntervalMinutes,
    syncNow: runScheduledSync,
    onNextRun: (state) => sendSyncNextRun(mainWindow, state),
  });
  autoSyncScheduler.start();
}

async function handleConfigChanged(config: AppConfig): Promise<void> {
  await restartBookmarkWatcher(config);
  restartAutoSync(config);
}

async function runScheduledSync(): Promise<SyncResult | void> {
  if (!bookmarkWatcher) {
    logger.warn('Automatic sync skipped because watcher is not initialized');
    return undefined;
  }

  return bookmarkWatcher.syncNow();
}

async function bootstrap(): Promise<void> {
  initializeLogging();
  logger.info('Application bootstrap started');
  initializeDatabase();
  logger.info('Database initialized');
  const config = await loadConfig();

  registerIpcHandlers({
    onConfigChanged: handleConfigChanged,
  });

  mainWindow = await createMainWindow({
    initialBounds: config.windowBounds,
    isQuitting: () => isQuitting,
  });

  createAppTray({
    showMainWindow,
    syncNow: async () => {
      await runScheduledSync();
    },
    quit: () => {
      isQuitting = true;
      mainWindow?.destroy();
      app.quit();
    },
  });

  await restartBookmarkWatcher(config);
  restartAutoSync(config);
  logger.info('Application bootstrap completed');
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);

  app.whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      void handleStartupError(error, {
        logError: (reason) => logger.error('Failed to start', { error: reason }),
        showErrorBox: (title, content) => dialog.showErrorBox(title, content),
        showMessageBox: (options) => dialog.showMessageBox(options),
        resetDatabase: resetDatabaseFiles,
        relaunch: () => app.relaunch(),
        quit: () => app.exit(0),
      });
    });
}

app.on('activate', showMainWindow);

app.on('before-quit', () => {
  isQuitting = true;
  logger.info('Application is quitting');
  autoSyncScheduler?.stop(false);
  autoSyncScheduler = null;
  bookmarkWatcher?.stop();
  bookmarkWatcher = null;
  closeDatabase();
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') {
    return;
  }
  // Keep the app alive so the tray menu can reopen the main window.
});

function createSyncStatus(
  state: SyncStatusState,
  profile: string,
  message: string,
  reason?: string,
): SyncStatus {
  return {
    state,
    profile,
    message,
    reason,
    updatedAt: new Date().toISOString(),
  };
}
