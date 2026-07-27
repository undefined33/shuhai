import { describe, expect, it, vi } from 'vitest';

import {
  initializeXSyncPageProtectedResources,
  invokeXSyncExitAdapter,
  requestXSyncSecurityBootstrap,
  XSyncSecurityBootstrapFailureNotice,
  type XSyncBootstrapStatusSender,
  type XSyncProtectedResourceDependencies,
} from '../src/popup/pages/XSyncPage.js';
import { X_SYNC_SECURITY_BOOTSTRAP_FAILED_MESSAGE } from '../src/popup/pages/x-sync-ui-model.js';

describe('X sync page security bootstrap', () => {
  it('uses the new surface exit adapter without changing the legacy fallback', () => {
    const onExit = vi.fn();

    expect(invokeXSyncExitAdapter(onExit)).toBe(true);
    expect(onExit).toHaveBeenCalledOnce();
    expect(invokeXSyncExitAdapter(undefined)).toBe(false);
  });

  function protectedDependencies(requestBootstrapStatus: () => Promise<void>): {
    dependencies: XSyncProtectedResourceDependencies;
    connectPort: ReturnType<typeof vi.fn>;
    openStore: ReturnType<typeof vi.fn>;
    readVaultHandle: ReturnType<typeof vi.fn>;
    readLaunchIntent: ReturnType<typeof vi.fn>;
  } {
    const connectXPort = vi.fn();
    const openSyncStore = vi.fn();
    const readVaultHandle = vi.fn();
    const consumeLaunchIntent = vi.fn();
    return {
      dependencies: {
        requestBootstrapStatus,
        connectPort: connectXPort,
        openStore: openSyncStore,
        inspectPermission: vi.fn(),
        readVaultHandle,
        queryVaultPermission: vi.fn(),
        readLaunchIntent: consumeLaunchIntent,
      } as unknown as XSyncProtectedResourceDependencies,
      connectPort: connectXPort,
      openStore: openSyncStore,
      readVaultHandle,
      readLaunchIntent: consumeLaunchIntent,
    };
  }

  it('keeps every production protected resource untouched when bootstrap fails', async () => {
    const requestBootstrapStatus = vi.fn(async () => {
      throw new Error('bootstrap failed');
    });
    const fixture = protectedDependencies(requestBootstrapStatus);

    const result = await initializeXSyncPageProtectedResources(fixture.dependencies);

    expect(result).toEqual({ ok: false, reason: 'security_bootstrap_failed' });
    expect(requestBootstrapStatus).toHaveBeenCalledOnce();
    expect(fixture.connectPort).not.toHaveBeenCalled();
    expect(fixture.openStore).not.toHaveBeenCalled();
    expect(fixture.readVaultHandle).not.toHaveBeenCalled();
    expect(fixture.readLaunchIntent).not.toHaveBeenCalled();
  });

  it('rejects an unvalidated bootstrap success before initialization', async () => {
    const sendMessage = vi.fn<XSyncBootstrapStatusSender>((_request, callback) => {
      callback({ ok: true, data: { ready: true, unexpected: true } });
    });
    const fixture = protectedDependencies(() => requestXSyncSecurityBootstrap(sendMessage));

    const result = await initializeXSyncPageProtectedResources(fixture.dependencies);

    expect(result).toEqual({ ok: false, reason: 'security_bootstrap_failed' });
    expect(fixture.connectPort).not.toHaveBeenCalled();
    expect(fixture.openStore).not.toHaveBeenCalled();
  });

  it('connects the X port only after the initial protected snapshots are ready', async () => {
    const calls: string[] = [];
    const port = { disconnect: vi.fn() };
    const store = {
      close: vi.fn(),
      getActiveJob: vi.fn(async () => {
        calls.push('active-job');
        return undefined;
      }),
    };
    const dependencies = {
      requestBootstrapStatus: vi.fn(async () => {
        calls.push('bootstrap');
      }),
      openStore: vi.fn(async () => {
        calls.push('store');
        return store;
      }),
      inspectPermission: vi.fn(async () => {
        calls.push('permission');
        return 'granted';
      }),
      readVaultHandle: vi.fn(async () => {
        calls.push('vault');
        return null;
      }),
      queryVaultPermission: vi.fn(),
      readLaunchIntent: vi.fn(async () => {
        calls.push('launch-intent');
        return undefined;
      }),
      connectPort: vi.fn(() => {
        calls.push('connect-port');
        return port;
      }),
    } as unknown as XSyncProtectedResourceDependencies;

    const result = await initializeXSyncPageProtectedResources(dependencies);

    expect(result.ok).toBe(true);
    expect(calls.at(-1)).toBe('connect-port');
    expect(calls).toEqual([
      'bootstrap',
      'store',
      'permission',
      'vault',
      'active-job',
      'launch-intent',
      'connect-port',
    ]);
  });

  it('does not open an X port when an initial protected snapshot fails', async () => {
    const fixture = protectedDependencies(async () => undefined);
    fixture.openStore.mockRejectedValueOnce(new Error('store unavailable'));

    const result = await initializeXSyncPageProtectedResources(fixture.dependencies);

    expect(result).toEqual({ ok: false, reason: 'resource_unavailable' });
    expect(fixture.connectPort).not.toHaveBeenCalled();
  });

  it('renders only the fixed bootstrap failure explanation', () => {
    expect(XSyncSecurityBootstrapFailureNotice()).toMatchObject({
      props: {
        children: X_SYNC_SECURITY_BOOTSTRAP_FAILED_MESSAGE,
        role: 'alert',
      },
    });
  });
});
