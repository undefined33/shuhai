import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classificationMessageDisposition,
  getActiveTabInfo,
  loadStateWithIndependentOperations,
  normalizeExtensionState,
} from '../src/popup/App.js';
import type { BookmarkOperation } from '../src/shared/bookmark-types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('popup state normalization', () => {
  it('retains independently loaded recovery operations when the main state read fails', async () => {
    const stateFailure = new Error('unrelated state corruption');
    const operations = [
      { id: 'recoverable-operation-one' },
      { id: 'recoverable-operation-two' },
    ] as BookmarkOperation[];
    const loadState = vi.fn(async () => Promise.reject(stateFailure));
    const loadOperations = vi.fn(async () => operations);

    const result = await loadStateWithIndependentOperations(loadState, loadOperations);

    expect(loadState).toHaveBeenCalledOnce();
    expect(loadOperations).toHaveBeenCalledOnce();
    expect(result.state).toEqual({ status: 'rejected', reason: stateFailure });
    expect(result.operations).toEqual({ status: 'fulfilled', value: operations });
  });

  it('rejects a late classification completion after cancellation was requested', () => {
    expect(
      classificationMessageDisposition(
        {
          type: 'complete',
          requestId: 'classify-request',
          plan: {
            mode: 'safe',
            moves: [],
            newFolders: [],
            unchanged: 1,
            totalBookmarks: 1,
            generatedAt: new Date(0).toISOString(),
          },
          progress: {
            done: 1,
            total: 1,
            batch: 1,
            totalBatches: 1,
            elapsedMs: 1,
          },
          cancelled: false,
        },
        'classify-request',
        'cancel-request',
      ),
    ).toBe('cancelled');
  });

  it('accepts only the correlated classification cancel acknowledgement', () => {
    expect(
      classificationMessageDisposition(
        {
          type: 'cancelled',
          requestId: 'cancel-request',
          targetRequestId: 'classify-request',
        },
        'classify-request',
        'cancel-request',
      ),
    ).toBe('cancelled');
    expect(
      classificationMessageDisposition(
        {
          type: 'cancelled',
          requestId: 'other-cancel',
          targetRequestId: 'classify-request',
        },
        'classify-request',
        'cancel-request',
      ),
    ).toBe('invalid');
  });

  it('fills arrays and settings when an older background returns a partial state', () => {
    const state = normalizeExtensionState({
      bookmarks: [{ id: '1', title: 'A', url: 'https://example.com' }],
      settings: {
        useAi: true,
        customRules: 'invalid',
      },
    });

    expect(state.bookmarks).toHaveLength(1);
    expect(state.folders).toEqual([]);
    expect(state.exportManifests).toEqual([]);
    expect(state.pendingCaptures).toEqual([]);
    expect(state.urlHealthRecords).toEqual([]);
    expect(state.bookmarkOperations).toEqual([]);
    expect(state.lastMoveRecordCount).toBe(0);
    expect(state.settings.useAi).toBe(true);
    expect(state.settings.customRules).toEqual([]);
    expect(state.settings.defaultClassifyMode).toBe('safe');
    expect(state.settings.aiProviders).toHaveLength(3);
  });

  it('falls back to defaults for malformed state payloads', () => {
    const state = normalizeExtensionState({
      bookmarkOperations: [{ id: 'untrusted-partial-operation' }],
    });

    expect(state.bookmarks).toEqual([]);
    expect(state.folders).toEqual([]);
    expect(state.bookmarkOperations).toEqual([]);
    expect(state.settings.activeProviderId).toBe('deepseek-default');
    expect(state.settings.aiProviders[0]).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-chat',
    });
    expect(state.settings.exportDirectory).toBe('Bookmarks');
  });

  it('reads the active tab from the last focused browser window', async () => {
    const query = vi.fn(
      (_queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void): void => {
        callback([{ title: 'Bookmarks / X', url: 'https://x.com/i/bookmarks' } as chrome.tabs.Tab]);
      },
    );
    vi.stubGlobal('chrome', {
      runtime: { lastError: undefined },
      tabs: { query },
    });

    await expect(getActiveTabInfo()).resolves.toMatchObject({
      title: 'Bookmarks / X',
      url: 'https://x.com/i/bookmarks',
    });
    expect(query).toHaveBeenCalledWith(
      { active: true, lastFocusedWindow: true },
      expect.any(Function),
    );
  });

  it('fails closed when Chrome cannot resolve the active tab', async () => {
    const query = vi.fn(
      (_queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void): void =>
        callback([]),
    );
    vi.stubGlobal('chrome', {
      runtime: { lastError: { message: 'No focused window' } },
      tabs: { query },
    });

    await expect(getActiveTabInfo()).resolves.toBeUndefined();
  });
});
