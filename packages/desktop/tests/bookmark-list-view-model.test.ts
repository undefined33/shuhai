import { describe, expect, it } from 'vitest';
import {
  formatSyncMessage,
  formatUrlCheckProgress,
} from '../src/renderer/pages/bookmark-list-view-model.js';

describe('BookmarkList view model', () => {
  it('formats bookmark sync results for realtime refresh feedback', () => {
    expect(formatSyncMessage({
      added: 2,
      updated: 1,
      removed: 3,
      total: 20,
    })).toBe('书签已同步：新增 2，更新 1，移除 3');
  });

  it('formats URL health check progress', () => {
    expect(formatUrlCheckProgress({
      total: 100,
      completed: 12,
      alive: 8,
      dead: 3,
      redirect: 1,
      errors: 0,
      currentUrl: 'https://example.com',
    })).toBe('检测中：12/100，有效 8，死链 3，重定向 1，错误 0');
  });
});
