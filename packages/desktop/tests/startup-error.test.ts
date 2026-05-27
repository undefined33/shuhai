import { describe, expect, it, vi } from 'vitest';
import {
  formatStartupError,
  handleStartupError,
  isDatabaseStartupError,
  type StartupErrorActions,
} from '../src/main/startup-error.js';

describe('startup error recovery', () => {
  it('detects database startup failures', () => {
    expect(isDatabaseStartupError(new Error('SQLITE_NOTADB: file is not a database'))).toBe(true);
    expect(isDatabaseStartupError(new Error('disk image is malformed'))).toBe(true);
    expect(isDatabaseStartupError(new Error('window failed to load'))).toBe(false);
  });

  it('shows reset and relaunch flow for database errors', async () => {
    const actions = createActions({ response: 0 });

    await handleStartupError(new Error('SQLITE_NOTADB: file is not a database'), actions);

    expect(actions.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      message: '本地数据库无法打开',
      buttons: ['重置数据库并重启', '退出'],
    }));
    expect(actions.resetDatabase).toHaveBeenCalledTimes(1);
    expect(actions.relaunch).toHaveBeenCalledTimes(1);
    expect(actions.quit).toHaveBeenCalledTimes(1);
    expect(actions.showErrorBox).not.toHaveBeenCalled();
  });

  it('does not reset the database when the user exits', async () => {
    const actions = createActions({ response: 1 });

    await handleStartupError(new Error('SQLITE_BUSY: database is locked'), actions);

    expect(actions.resetDatabase).not.toHaveBeenCalled();
    expect(actions.relaunch).not.toHaveBeenCalled();
    expect(actions.quit).toHaveBeenCalledTimes(1);
  });

  it('uses a generic Chinese error box for non-database startup failures', async () => {
    const actions = createActions({ response: 0 });

    await handleStartupError(new Error('renderer failed'), actions);

    expect(actions.showErrorBox).toHaveBeenCalledWith(
      'ShuHai 启动失败',
      expect.stringContaining('请重启应用'),
    );
    expect(actions.showMessageBox).not.toHaveBeenCalled();
    expect(actions.quit).toHaveBeenCalledTimes(1);
  });

  it('formats unknown startup errors', () => {
    expect(formatStartupError('')).toBe('未知错误');
  });
});

function createActions(result: { response: number }): StartupErrorActions {
  return {
    logError: vi.fn(),
    showErrorBox: vi.fn(),
    showMessageBox: vi.fn().mockResolvedValue(result),
    resetDatabase: vi.fn().mockResolvedValue(undefined),
    relaunch: vi.fn(),
    quit: vi.fn(),
  };
}
