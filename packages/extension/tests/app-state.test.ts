import { describe, expect, it } from 'vitest';
import { normalizeExtensionState } from '../src/popup/App.js';

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
  });

  it('falls back to defaults for malformed state payloads', () => {
    const state = normalizeExtensionState(undefined);

    expect(state.bookmarks).toEqual([]);
    expect(state.folders).toEqual([]);
    expect(state.settings.deepSeekModel).toBe('deepseek-chat');
    expect(state.settings.exportDirectory).toBe('Bookmarks');
  });
});
