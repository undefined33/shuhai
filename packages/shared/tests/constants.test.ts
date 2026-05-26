import { describe, it, expect } from 'vitest';
import { getChromeBookmarksPath, AI_BATCH_SIZE, URL_CHECK_CONCURRENCY } from '../src/constants.js';

describe('constants', () => {
  it('returns Chrome bookmarks path for current platform', () => {
    const path = getChromeBookmarksPath();
    expect(path).toContain('Bookmarks');
    expect(path).toContain('Default');
  });

  it('supports custom profile', () => {
    const path = getChromeBookmarksPath('Profile 1');
    expect(path).toContain('Profile 1');
    expect(path).not.toContain('Default');
  });

  it('has correct default values', () => {
    expect(AI_BATCH_SIZE).toBe(50);
    expect(URL_CHECK_CONCURRENCY).toBe(5);
  });
});
