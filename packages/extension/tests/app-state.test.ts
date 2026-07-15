import { afterEach, describe, expect, it, vi } from 'vitest';
import { getActiveTabInfo, normalizeExtensionState } from '../src/popup/App.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('popup state normalization', () => {
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
    expect(state.lastMoveRecordCount).toBe(0);
    expect(state.settings.useAi).toBe(true);
    expect(state.settings.customRules).toEqual([]);
    expect(state.settings.defaultClassifyMode).toBe('safe');
    expect(state.settings.aiProviders).toHaveLength(3);
  });

  it('falls back to defaults for malformed state payloads', () => {
    const state = normalizeExtensionState(undefined);

    expect(state.bookmarks).toEqual([]);
    expect(state.folders).toEqual([]);
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
