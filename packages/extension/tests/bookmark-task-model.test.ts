import { describe, expect, it } from 'vitest';

import type {
  BookmarkOperation,
  ClassificationPlan,
  MovePlan,
} from '../src/shared/bookmark-types.js';
import {
  acquireClassificationStart,
  bookmarkOperationStatusLabel,
  canExitBookmarkTask,
  operationCanAcceptCurrent,
  operationCanCancel,
  operationCanRestore,
  releaseClassificationStart,
  replacePlanMove,
  selectedPlanMoves,
  upsertBookmarkOperation,
} from '../src/tasks/bookmarks/bookmark-task-model.js';

function move(id: string, selected = true): MovePlan {
  return {
    id,
    bookmarkId: `bookmark-${id}`,
    bookmarkTitle: `Bookmark ${id}`,
    bookmarkUrl: `https://example.com/${id}`,
    currentFolder: 'Old',
    targetFolder: id === 'a' ? 'Research' : 'Tools',
    confidence: 0.8,
    reason: 'rule',
    tags: [],
    selected,
  };
}

function plan(): ClassificationPlan {
  return {
    mode: 'safe',
    moves: [move('a'), move('b', false)],
    newFolders: ['Research', 'Tools'],
    unchanged: 3,
    totalBookmarks: 5,
    generatedAt: '2026-07-24T00:00:00.000Z',
  };
}

function operation(id: string, overrides: Partial<BookmarkOperation> = {}): BookmarkOperation {
  return {
    id,
    requestId: `request-${id}`,
    payloadIdentity: `sha256:${'a'.repeat(64)}`,
    version: 1,
    type: 'move_bookmarks',
    status: 'complete',
    source: 'classification',
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: `2026-07-24T00:00:0${id === 'new' ? '2' : '1'}.000Z`,
    requestedCount: 1,
    items: [
      {
        kind: 'move',
        bookmarkId: `bookmark-${id}`,
        title: `Bookmark ${id}`,
        executionStatus: 'succeeded',
        restoreStatus: 'pending',
        executionAttemptCount: 1,
        restoreAttemptCount: 0,
        targetFolder: 'Research',
        targetStatus: 'resolved',
        folderResolution: [],
      },
    ],
    summary: {
      requested: 1,
      pending: 0,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      executionConflicts: 0,
      restorePending: 1,
      restored: 0,
      restoreFailed: 0,
      restoreConflicts: 0,
      acceptedCurrent: 0,
    },
    commands: [],
    ...overrides,
  };
}

describe('bookmark task model', () => {
  it('allows only one classification start while AI consent is pending', () => {
    const gate = { current: false };

    expect(acquireClassificationStart(gate)).toBe(true);
    expect(acquireClassificationStart(gate)).toBe(false);
    releaseClassificationStart(gate);
    expect(acquireClassificationStart(gate)).toBe(true);
  });

  it('updates one proposal without mutating the existing plan', () => {
    const current = plan();
    const nextMove = { ...current.moves[0], targetFolder: 'Security', selected: false };
    const next = replacePlanMove(current, nextMove, []);

    expect(next).not.toBe(current);
    expect(current.moves[0]?.targetFolder).toBe('Research');
    expect(next.moves[0]).toEqual(nextMove);
    expect(next.newFolders).toEqual(['Security', 'Tools']);
    expect(selectedPlanMoves(next)).toEqual([]);
  });

  it('does not relabel an existing target folder as a new folder after selection edits', () => {
    const current = plan();
    const next = replacePlanMove(current, { ...current.moves[0]!, selected: false }, ['Research']);

    expect(next.newFolders).toEqual(['Tools']);
  });

  it('keeps the newest journal truth when progress updates arrive', () => {
    const previous = operation('old');
    const next = operation('new');
    const updated = upsertBookmarkOperation([previous, operation('new')], next);

    expect(updated.map((item) => item.id)).toEqual(['new', 'old']);
    expect(updated.filter((item) => item.id === 'new')).toHaveLength(1);
  });

  it('derives restore, accept, cancel, and status actions from journal truth', () => {
    const restorable = operation('restore');
    expect(operationCanRestore(restorable)).toBe(true);
    expect(operationCanAcceptCurrent(restorable)).toBe(false);
    expect(operationCanCancel(restorable)).toBe(false);
    expect(bookmarkOperationStatusLabel(restorable)).toBe('已完成');

    const conflict = operation('conflict', {
      status: 'restore_partial',
      items: [
        {
          ...restorable.items[0]!,
          restoreStatus: 'conflict',
        },
      ],
    });
    expect(operationCanAcceptCurrent(conflict)).toBe(true);

    const running = operation('running', { status: 'running' });
    expect(operationCanCancel(running)).toBe(true);
    expect(operationCanRestore(running)).toBe(false);
    expect(operationCanAcceptCurrent(running)).toBe(false);
  });

  it('blocks task exit while a confirmation or mutation is active', () => {
    expect(canExitBookmarkTask('idle', false)).toBe(true);
    expect(canExitBookmarkTask('idle', true)).toBe(false);
    expect(canExitBookmarkTask('authorizing', false)).toBe(false);
    expect(canExitBookmarkTask('classifying', false)).toBe(false);
    expect(canExitBookmarkTask('mutating', false)).toBe(false);
  });
});
