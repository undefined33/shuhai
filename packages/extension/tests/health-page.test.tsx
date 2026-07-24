import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookmarkOperation, UrlHealthRecord } from '../src/shared/bookmark-types.js';
import {
  BookmarkOperationSchema,
  summarizeBookmarkOperationItems,
} from '../src/shared/bookmark-types.js';
import HealthPage, { openHistoricalHealthUrl } from '../src/popup/pages/HealthPage.js';

const noop = () => undefined;

function historicalRecord(overrides: Partial<UrlHealthRecord> = {}): UrlHealthRecord {
  return {
    bookmarkId: 'bookmark-1',
    bookmarkTitle: '旧检查记录',
    bookmarkUrl: 'https://example.com/article',
    parentPath: 'Bookmarks',
    status: 'dead',
    checkedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 100,
    httpStatus: 404,
    ...overrides,
  };
}

function recoverableOperation(id: string, status: BookmarkOperation['status']): BookmarkOperation {
  const timestamp = new Date(0).toISOString();
  const requestId = `request-${id}`;
  const payloadIdentity = `sha256:${'a'.repeat(64)}`;
  const bookmarkId = `bookmark-${id}`;
  const restoreConflict = status === 'restore_partial';
  const items: BookmarkOperation['items'] = [
    {
      kind: 'delete',
      bookmarkId,
      title: `可恢复记录 ${id}`,
      original: {
        title: `可恢复记录 ${id}`,
        url: `https://example.com/${id}`,
        parentId: 'parent-1',
        index: 0,
      },
      matchingCountBefore: 1,
      restoreBaselineBookmarkIds: [bookmarkId],
      restoreTargetParentId: 'parent-1',
      executionStatus: 'succeeded',
      restoreStatus: restoreConflict ? 'conflict' : 'pending',
      executionAttemptedAt: timestamp,
      executionCompletedAt: timestamp,
      executionAttemptCount: 1,
      ...(restoreConflict
        ? {
            restoreErrorCode: 'restore_conflict' as const,
            restoreAttemptedAt: timestamp,
            restoreCompletedAt: timestamp,
            restoreAttemptCount: 1,
          }
        : { restoreAttemptCount: 0 }),
    },
  ];
  const summary = summarizeBookmarkOperationItems(items);
  const receipt = {
    requestId,
    action: 'execute' as const,
    payloadIdentity,
    status: 'succeeded' as const,
    createdAt: timestamp,
    updatedAt: timestamp,
    result: {
      ok: true,
      operationStatus: 'complete' as const,
      summary,
      completedAt: timestamp,
    },
  };
  return BookmarkOperationSchema.parse({
    id,
    requestId,
    payloadIdentity,
    version: 1,
    type: 'delete_bookmarks',
    status,
    source: 'health',
    createdAt: timestamp,
    updatedAt: timestamp,
    requestedCount: 1,
    items,
    summary,
    commands: [receipt],
  });
}

function renderHealthPage(
  records: UrlHealthRecord[],
  operations: BookmarkOperation[] = [],
  historyAvailable = true,
): string {
  return renderToStaticMarkup(
    <HealthPage
      historyAvailable={historyAvailable}
      onAcceptCurrent={noop}
      onCancelOperation={noop}
      onClear={noop}
      onRestoreOperation={noop}
      operations={operations}
      records={records}
    />,
  );
}

describe('HealthPage retired scanner boundary', () => {
  beforeEach(() => {
    Object.defineProperty(chrome, 'tabs', {
      configurable: true,
      value: { create: vi.fn() },
    });
  });

  it('renders history-only controls and no scan or bookmark mutation controls', () => {
    const markup = renderHealthPage([historicalRecord()]);

    expect(markup).toContain('旧检查结果，仅供人工核实');
    expect(markup).toContain('清空本地历史');
    expect(markup).toContain('复制原 URL');
    expect(markup).not.toContain('开始检查');
    expect(markup).not.toContain('继续检查');
    expect(markup).not.toContain('重试检查');
    expect(markup).not.toContain('修正链接');
    expect(markup).not.toContain('更新到跳转');
    expect(markup).not.toContain('全选当前');
  });

  it('keeps multiple independent recovery operations available after state loading fails', () => {
    const markup = renderHealthPage(
      [],
      [
        recoverableOperation('operation-one', 'complete'),
        recoverableOperation('operation-two', 'restore_partial'),
      ],
      false,
    );

    expect(markup).toContain('书签数据未能安全读取');
    expect(markup).toContain('恢复成功项 1');
    expect(markup).toContain('接受当前状态 1');
    expect(markup).toContain('可恢复记录 operation-one');
    expect(markup).toContain('可恢复记录 operation-two');
    expect(markup).not.toContain('没有保留旧检查记录');
  });

  it.each([
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:text/html,unsafe'],
    ['file', 'file:///C:/secret.txt'],
    ['credentials', 'https://user:password@example.com/'],
    ['control character', 'https://example.com/\nunsafe'],
    ['over 8 KiB', `https://example.com/${'a'.repeat(8_193)}`],
  ])('does not navigate to an unsafe historical URL with %s', (_caseName, url) => {
    expect(openHistoricalHealthUrl(url)).toBe(false);
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('opens a validated HTTP(S) URL only in a non-active tab', () => {
    expect(openHistoricalHealthUrl('https://example.com/article')).toBe(true);
    expect(chrome.tabs.create).toHaveBeenCalledOnce();
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      active: false,
      url: 'https://example.com/article',
    });
  });

  it('fails closed when Chrome rejects a valid navigation request synchronously', () => {
    vi.mocked(chrome.tabs.create).mockImplementation(() => {
      throw new Error('context invalidated');
    });

    expect(openHistoricalHealthUrl('https://example.com/article')).toBe(false);
  });
});
