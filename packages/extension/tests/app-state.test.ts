import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classificationMessageDisposition,
  getActiveTabInfo,
  loadStateWithIndependentOperations,
  normalizeExtensionState,
  requestAiClassificationConsent,
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
      model: 'deepseek-v4-flash',
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

  it('shows the fixed AI disclosure and does not request permission without confirmation', async () => {
    const provider = {
      ...normalizeExtensionState({}).settings.aiProviders[0],
      hasApiKey: true,
    };
    const confirmRequest = vi.fn<(message: string) => boolean>(() => false);
    const requestPermission = vi.fn(async () => true);

    const result = await requestAiClassificationConsent(
      provider,
      7,
      confirmRequest,
      requestPermission,
    );

    expect(confirmRequest).toHaveBeenCalledOnce();
    const disclosure = confirmRequest.mock.calls[0]?.[0] ?? '';
    expect(disclosure).toContain('https://api.deepseek.com');
    expect(disclosure).toContain('候选数量: 7');
    expect(disclosure).toContain('受限标题、网站 hostname、已有目标目录标签');
    expect(disclosure).toContain('不会发送: 完整 URL');
    expect(requestPermission).not.toHaveBeenCalled();
    expect(result).toEqual({ permissionDenied: false });
  });

  it('falls back to a local-only request when provider permission is denied', async () => {
    const provider = {
      ...normalizeExtensionState({}).settings.aiProviders[0],
      hasApiKey: true,
    };
    const requestPermission = vi.fn(async () => false);

    const result = await requestAiClassificationConsent(provider, 3, () => true, requestPermission);

    expect(requestPermission).toHaveBeenCalledWith('https://api.deepseek.com/*');
    expect(result).toEqual({ permissionDenied: true });
    expect(result).not.toHaveProperty('ai');
  });

  it('skips both disclosure and permission when local rules find no AI candidates', async () => {
    const provider = {
      ...normalizeExtensionState({}).settings.aiProviders[0],
      hasApiKey: true,
    };
    const confirmRequest = vi.fn<(message: string) => boolean>(() => true);
    const requestPermission = vi.fn(async () => true);

    await expect(
      requestAiClassificationConsent(provider, 0, confirmRequest, requestPermission),
    ).resolves.toEqual({ permissionDenied: false });
    expect(confirmRequest).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
