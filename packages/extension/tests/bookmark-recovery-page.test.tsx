import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type {
  BookmarkOperation,
  BookmarkOperationItem,
  BookmarkOperationStatus,
  MoveBookmarkOperationItem,
} from '../src/shared/bookmark-types.js';
import BookmarkRecoveryPage from '../src/tasks/bookmarks/BookmarkRecoveryPage.js';

function item(
  bookmarkId: string,
  overrides: Partial<MoveBookmarkOperationItem> = {},
): MoveBookmarkOperationItem {
  return {
    kind: 'move',
    bookmarkId,
    title: `Bookmark ${bookmarkId}`,
    executionStatus: 'succeeded',
    restoreStatus: 'pending',
    executionAttemptCount: 1,
    restoreAttemptCount: 0,
    targetFolder: 'Research',
    targetStatus: 'resolved',
    folderResolution: [],
    ...overrides,
  };
}

function operation(
  id: string,
  status: BookmarkOperationStatus,
  items: BookmarkOperationItem[],
): BookmarkOperation {
  const succeeded = items.filter((candidate) => candidate.executionStatus === 'succeeded').length;
  const failed = items.filter((candidate) => candidate.executionStatus === 'failed').length;
  const executionConflicts = items.filter(
    (candidate) => candidate.executionStatus === 'conflict',
  ).length;
  const restoreConflicts = items.filter(
    (candidate) => candidate.restoreStatus === 'conflict',
  ).length;
  return {
    id,
    requestId: `request-${id}`,
    payloadIdentity: `sha256:${id.padEnd(64, 'a').slice(0, 64)}`,
    version: 1,
    type: 'move_bookmarks',
    status,
    source: 'classification',
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: `2026-07-24T00:00:0${id.length}.000Z`,
    requestedCount: items.length,
    items,
    summary: {
      requested: items.length,
      pending: 0,
      succeeded,
      failed,
      skipped: 0,
      executionConflicts,
      restorePending: items.filter((candidate) => candidate.restoreStatus === 'pending').length,
      restored: items.filter((candidate) => candidate.restoreStatus === 'restored').length,
      restoreFailed: items.filter((candidate) => candidate.restoreStatus === 'restore_failed')
        .length,
      restoreConflicts,
      acceptedCurrent: items.filter((candidate) => candidate.restoreStatus === 'accepted_current')
        .length,
    },
    commands: [],
  };
}

function renderRecovery(operations: BookmarkOperation[], selectedOperationId?: string): string {
  return renderToStaticMarkup(
    <BookmarkRecoveryPage
      busy={false}
      onAcceptCurrent={() => undefined}
      onCancel={() => undefined}
      onRestore={() => undefined}
      onSelect={() => undefined}
      operations={operations}
      selectedOperationId={selectedOperationId}
    />,
  );
}

describe('bookmark recovery page', () => {
  it('renders an actionable empty state without implying that history was lost', () => {
    const markup = renderRecovery([]);

    expect(markup).toContain('还没有书签操作记录');
    expect(markup).toContain('逐项状态和可用的恢复动作');
  });

  it('keeps every retained operation visible and shows terminal recovery actions', () => {
    const completed = operation('complete', 'complete', [item('one')]);
    const conflict = operation('conflict', 'restore_partial', [
      item('two', { restoreStatus: 'conflict' }),
    ]);
    const markup = renderRecovery([completed, conflict], conflict.id);

    expect(markup.match(/整理书签/gu)).toHaveLength(3);
    expect(markup).toContain('部分恢复');
    expect(markup).toContain('恢复成功项');
    expect(markup).toContain('接受当前状态');
    expect(markup).toContain('恢复冲突');
    expect(markup).not.toContain('text-[11px]');
  });

  it('offers only safe stop while an operation is still active', () => {
    const running = operation('running', 'running', [item('one')]);
    const markup = renderRecovery([running], running.id);

    expect(markup).toContain('安全停止');
    expect(markup).not.toContain('恢复成功项');
    expect(markup).not.toContain('接受当前状态');
  });
});
