import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PopupReadyView,
  executePopupAction,
  resolvePopupAction,
  type PopupActionOperations,
} from '../src/popup/PopupApp.js';
import { classifyPopupTabUrl, getPopupBrowserContext } from '../src/popup/popup-context.js';
import type { SurfaceSummary } from '../src/shared/surface-contract.js';

function summary(overrides: Partial<SurfaceSummary> = {}): SurfaceSummary {
  return {
    bookmarkCount: 1_469,
    folderCount: 106,
    vaultConfigured: true,
    aiConfigured: false,
    lastSavedAt: null,
    activeTask: null,
    pendingLaunch: null,
    ...overrides,
  };
}

function operations(calls: string[]): PopupActionOperations {
  return {
    openSidePanel: vi.fn(async () => {
      calls.push('open');
    }),
    launchSurface: vi.fn(async (_windowId, target) => {
      calls.push(`surface:${target}`);
    }),
    launchXSingle: vi.fn(async () => {
      calls.push('x-single');
    }),
    launchXSync: vi.fn(async () => {
      calls.push('x-sync');
    }),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('popup context shell', () => {
  it.each([
    ['https://x.com/i/bookmarks', 'x-bookmarks'],
    ['https://x.com/researcher/status/123456789?ref=home', 'x-status'],
    ['https://x.com/researcher/status/not-a-number', 'ordinary'],
    ['https://mobile.x.com/researcher/status/123', 'ordinary'],
    ['https://example.com/', 'ordinary'],
    [undefined, 'ordinary'],
  ] as const)('classifies %s as %s', (url, expected) => {
    expect(classifyPopupTabUrl(url)).toBe(expected);
  });

  it('gives an active task priority over the current tab', () => {
    const action = resolvePopupAction(
      summary({
        activeTask: {
          kind: 'x-single',
          status: 'ready_for_review',
          updatedAt: '2026-07-24T12:00:00.000Z',
        },
      }),
      'x-bookmarks',
    );

    expect(action.kind).toBe('continue');
    expect(action.label).toBe('继续当前任务');
  });

  it('fails closed when Chrome cannot return exactly one active tab URL', async () => {
    const runtime = {
      lastError: undefined as chrome.runtime.LastError | undefined,
    };
    vi.stubGlobal('chrome', {
      runtime,
      windows: {
        getCurrent(callback: (window: chrome.windows.Window) => void) {
          callback({ id: 7 } as chrome.windows.Window);
        },
      },
      tabs: {
        query(_query: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) {
          runtime.lastError = { message: 'tab query failed' };
          callback([]);
          runtime.lastError = undefined;
        },
      },
    });

    await expect(getPopupBrowserContext()).rejects.toThrow('active_tab_unavailable');
  });

  it.each([
    ['x-bookmarks', 'x-sync'],
    ['x-status', 'x-single'],
    ['ordinary', 'bookmarks'],
  ] as const)('renders exactly one primary action for %s', (tabKind, expectedKind) => {
    const action = resolvePopupAction(summary(), tabKind);
    const markup = renderToStaticMarkup(
      <PopupReadyView
        action={action}
        busy={false}
        onAction={() => undefined}
        summary={summary()}
      />,
    );

    expect(action.kind).toBe(expectedKind);
    expect(markup.match(/<button/gu)).toHaveLength(1);
    expect(markup).not.toContain('state:get');
  });

  it('opens the Side Panel before the X bookmark launch chain', async () => {
    const calls: string[] = [];
    const action = resolvePopupAction(summary(), 'x-bookmarks');

    await executePopupAction(action, { windowId: 7, tabKind: 'x-bookmarks' }, operations(calls));

    expect(calls).toEqual(['open', 'surface:x-sync', 'x-sync']);
  });

  it('does not publish a launch intent until the user-gesture panel open resolves', async () => {
    const calls: string[] = [];
    const opened = deferred();
    const fixture = operations(calls);
    vi.mocked(fixture.openSidePanel).mockImplementationOnce(() => {
      calls.push('open:pending');
      return opened.promise;
    });

    const pending = executePopupAction(
      resolvePopupAction(summary(), 'x-bookmarks'),
      { windowId: 7, tabKind: 'x-bookmarks' },
      fixture,
    );
    await Promise.resolve();
    expect(calls).toEqual(['open:pending']);

    opened.resolve();
    await pending;
    expect(calls).toEqual(['open:pending', 'surface:x-sync', 'x-sync']);
  });

  it('opens first and waits for X single-item creation before publishing the surface intent', async () => {
    const calls: string[] = [];
    const action = resolvePopupAction(summary(), 'x-status');

    await executePopupAction(action, { windowId: 7, tabKind: 'x-status' }, operations(calls));

    expect(calls).toEqual(['open', 'x-single', 'surface:x-single']);
  });

  it('publishes a slow single-item surface intent only after the domain job succeeds', async () => {
    const calls: string[] = [];
    const created = deferred();
    const fixture = operations(calls);
    vi.mocked(fixture.launchXSingle).mockImplementationOnce(() => {
      calls.push('x-single:pending');
      return created.promise;
    });

    const pending = executePopupAction(
      resolvePopupAction(summary(), 'x-status'),
      { windowId: 7, tabKind: 'x-status' },
      fixture,
    );
    await Promise.resolve();
    expect(calls).toEqual(['open', 'x-single:pending']);
    expect(fixture.launchSurface).not.toHaveBeenCalled();

    created.resolve();
    await pending;
    expect(calls).toEqual(['open', 'x-single:pending', 'surface:x-single']);
  });

  it('does not claim an X sync launch when the bounded surface intent fails', async () => {
    const calls: string[] = [];
    const fixture = operations(calls);
    vi.mocked(fixture.launchSurface).mockRejectedValueOnce(new Error('surface unavailable'));

    await expect(
      executePopupAction(
        resolvePopupAction(summary(), 'x-bookmarks'),
        { windowId: 7, tabKind: 'x-bookmarks' },
        fixture,
      ),
    ).rejects.toThrow('surface unavailable');

    expect(calls).toEqual(['open']);
    expect(fixture.launchXSync).not.toHaveBeenCalled();
  });
});
