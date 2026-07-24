import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SidePanelIdle } from '../src/sidepanel/SidePanelApp.js';
import {
  SIDE_PANEL_RETRY_DELAYS_MS,
  canRefreshSidePanelRoute,
  createTrailingRefreshGate,
  selectSidePanelRoute,
} from '../src/sidepanel/sidepanel-route.js';
import type { SurfaceSummary } from '../src/shared/surface-contract.js';

function summary(overrides: Partial<SurfaceSummary> = {}): SurfaceSummary {
  return {
    bookmarkCount: 100,
    folderCount: 10,
    vaultConfigured: false,
    aiConfigured: false,
    lastSavedAt: null,
    activeTask: null,
    pendingLaunch: null,
    ...overrides,
  };
}

describe('Side Panel task shell', () => {
  it('routes idle, X, and bookmark launch states without importing task truth', () => {
    expect(selectSidePanelRoute(summary())).toEqual({ kind: 'idle' });
    expect(
      selectSidePanelRoute(
        summary({
          pendingLaunch: {
            intentId: 'surface-x',
            target: 'x-single',
            windowId: 7,
            expiresAtMs: 10_000,
          },
        }),
      ),
    ).toEqual({ kind: 'x-task', intentId: 'surface-x', target: 'x-single' });
    expect(
      selectSidePanelRoute(
        summary({
          pendingLaunch: {
            intentId: 'surface-bookmarks',
            target: 'bookmarks-transition',
            windowId: 7,
            expiresAtMs: 10_000,
          },
        }),
      ),
    ).toEqual({ kind: 'bookmarks-transition', intentId: 'surface-bookmarks' });
  });

  it('keeps persistent active task truth ahead of a transient launch intent', () => {
    expect(
      selectSidePanelRoute(
        summary({
          activeTask: {
            kind: 'x-sync',
            status: 'paused',
            updatedAt: '2026-07-24T12:00:00.000Z',
          },
          pendingLaunch: {
            intentId: 'surface-bookmarks',
            target: 'bookmarks-transition',
            windowId: 7,
            expiresAtMs: 10_000,
          },
        }),
      ),
    ).toEqual({ kind: 'x-task', target: 'x-sync' });
  });

  it('bounds race retries to two seconds and refreshes only idle/loading routes', () => {
    expect(SIDE_PANEL_RETRY_DELAYS_MS.at(-1)).toBe(2_000);
    expect(SIDE_PANEL_RETRY_DELAYS_MS).toHaveLength(5);
    expect(canRefreshSidePanelRoute('loading')).toBe(true);
    expect(canRefreshSidePanelRoute('error')).toBe(false);
    expect(canRefreshSidePanelRoute({ kind: 'idle' })).toBe(true);
    expect(canRefreshSidePanelRoute({ kind: 'x-task', target: 'x-sync' })).toBe(false);
  });

  it('runs one trailing refresh when the registry changes during an in-flight summary', async () => {
    let releaseFirst!: () => void;
    const firstRun = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let runs = 0;
    const gate = createTrailingRefreshGate(
      () => {
        runs += 1;
        return runs === 1 ? firstRun : Promise.resolve();
      },
      () => true,
    );

    const first = gate.refresh();
    const coalesced = gate.refresh();
    expect(coalesced).toBe(first);
    await Promise.resolve();
    expect(runs).toBe(1);

    releaseFirst();
    await first;
    await vi.waitFor(() => expect(runs).toBe(2));
  });

  it('drops a queued refresh after the first result leaves idle/loading', async () => {
    let releaseFirst!: () => void;
    const firstRun = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let runs = 0;
    const gate = createTrailingRefreshGate(
      () => {
        runs += 1;
        return firstRun;
      },
      () => false,
    );

    const first = gate.refresh();
    void gate.refresh();
    await Promise.resolve();
    releaseFirst();
    await first;
    await Promise.resolve();

    expect(runs).toBe(1);
  });

  it('renders the idle shell as two direct task entries with readable copy', () => {
    const markup = renderToStaticMarkup(
      <SidePanelIdle onBookmarks={() => undefined} onX={() => undefined} />,
    );

    expect(markup.match(/<button/gu)).toHaveLength(2);
    expect(markup).toContain('整理 Chrome 书签');
    expect(markup).toContain('查看 X 收藏同步');
    expect(markup).not.toContain('text-[11px]');
  });
});
