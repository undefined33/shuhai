export interface StartupErrorDialogOptions {
  type: 'error';
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
  noLink: boolean;
}

export interface StartupErrorActions {
  logError(error: unknown): void;
  showErrorBox(title: string, content: string): void;
  showMessageBox(options: StartupErrorDialogOptions): Promise<{ response: number }>;
  resetDatabase(): Promise<void>;
  relaunch(): void;
  quit(): void;
}

export async function handleStartupError(
  error: unknown,
  actions: StartupErrorActions,
): Promise<void> {
  actions.logError(error);
  const message = formatStartupError(error);

  if (isDatabaseStartupError(error)) {
    const result = await actions.showMessageBox({
      type: 'error',
      title: 'ShuHai 启动失败',
      message: '本地数据库无法打开',
      detail: `${message}\n\n可以重置 ShuHai 本地数据库后重启。此操作不会删除 Chrome 原始书签，但会清空 ShuHai 已保存的分类、检测状态和导出记录。`,
      buttons: ['重置数据库并重启', '退出'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });

    if (result.response === 0) {
      await actions.resetDatabase();
      actions.relaunch();
    }

    actions.quit();
    return;
  }

  actions.showErrorBox(
    'ShuHai 启动失败',
    `${message}\n\n请重启应用；如果问题仍然存在，请检查 Chrome Profile、Vault 路径或查看日志。`,
  );
  actions.quit();
}

export function formatStartupError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  const text = String(error);
  return text.trim().length > 0 ? text : '未知错误';
}

export function isDatabaseStartupError(error: unknown): boolean {
  const message = formatStartupError(error).toLowerCase();
  return [
    'sqlite',
    'database',
    'better_sqlite3',
    'better-sqlite3',
    'disk image is malformed',
    'file is not a database',
  ].some((pattern) => message.includes(pattern));
}
