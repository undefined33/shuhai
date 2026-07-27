import { describe, expect, it, vi } from 'vitest';
import type { BookmarkOperationJournalEnvelope } from '../src/shared/bookmark-types.js';
import {
  createBookmarkExecutionPayloadIdentity,
  parseBookmarkOperationCommand,
  parseBookmarkOperationCommandResponse,
} from '../src/shared/bookmark-types.js';
import {
  BookmarkOperationCommandError,
  acceptBookmarkOperationCurrentState,
  cancelBookmarkOperation,
  executeBookmarkMoves,
  executeBookmarkUrlUpdates,
  executeDeleteBookmarks,
  reconcileInterruptedBookmarkOperations,
  restoreBookmarkOperation,
} from '../src/utils/bookmark-operations.js';
import { BOOKMARK_OPERATIONS_KEY } from '../src/utils/storage.js';
import {
  getBookmarkMocks,
  getBookmarkTreeSnapshot,
  getStorageMocks,
  getStorageSnapshot,
  setBookmarkTree,
  setRuntimeLastError,
  setStorageSnapshot,
} from './setup.js';

type TreeNode = chrome.bookmarks.BookmarkTreeNode;

function bookmark(id: string, title: string, url: string, parentId = '1', index = 0): TreeNode {
  return {
    id,
    title,
    url,
    parentId,
    index,
    syncing: false,
  };
}

function folder(
  id: string,
  title: string,
  children: TreeNode[] = [],
  parentId = '1',
  index = 0,
): TreeNode {
  children.forEach((child, childIndex) => {
    child.parentId = id;
    child.index = childIndex;
  });
  return {
    id,
    title,
    parentId,
    index,
    syncing: false,
    children,
  };
}

function tree(children: TreeNode[]): TreeNode[] {
  children.forEach((child, index) => {
    child.parentId = '1';
    child.index = index;
  });
  return [
    {
      id: '0',
      title: '',
      syncing: false,
      children: [
        {
          id: '1',
          title: 'Bookmarks Bar',
          parentId: '0',
          index: 0,
          syncing: false,
          children,
        },
      ],
    },
  ];
}

function deepFolderChain(segments: readonly string[]): TreeNode {
  let current: TreeNode | undefined;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    current = folder(`deep-folder-${index}`, segments[index] as string, current ? [current] : []);
  }
  if (!current) {
    throw new Error('Deep folder fixture requires at least one segment');
  }
  return current;
}

interface FoundTreeNode {
  node: TreeNode;
  siblings: TreeNode[];
}

function findTreeNode(id: string, nodes = getBookmarkTreeSnapshot()): FoundTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) {
      return { node, siblings: nodes };
    }
    if (node.children) {
      const found = findTreeNode(id, node.children);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

function replaceNodeUrl(id: string, url: string): void {
  const snapshot = getBookmarkTreeSnapshot();
  const found = findTreeNode(id, snapshot);
  if (!found) {
    throw new Error(`Missing test node ${id}`);
  }
  found.node.url = url;
  setBookmarkTree(snapshot);
}

function removeTreeNode(id: string): void {
  const snapshot = getBookmarkTreeSnapshot();
  const found = findTreeNode(id, snapshot);
  if (!found) {
    return;
  }
  found.siblings.splice(found.siblings.indexOf(found.node), 1);
  found.siblings.forEach((node, index) => {
    node.index = index;
  });
  setBookmarkTree(snapshot);
}

function appendTreeNode(parentId: string, node: TreeNode): void {
  const snapshot = getBookmarkTreeSnapshot();
  const parent = findTreeNode(parentId, snapshot)?.node;
  if (!parent) {
    throw new Error(`Missing test parent ${parentId}`);
  }
  parent.children ??= [];
  node.parentId = parent.id;
  node.index = parent.children.length;
  parent.children.push(node);
  setBookmarkTree(snapshot);
}

function moveTreeNode(id: string, parentId: string, index?: number): TreeNode {
  const snapshot = getBookmarkTreeSnapshot();
  const found = findTreeNode(id, snapshot);
  const parent = findTreeNode(parentId, snapshot)?.node;
  if (!found || !parent) {
    throw new Error('Missing move fixture');
  }
  found.siblings.splice(found.siblings.indexOf(found.node), 1);
  found.siblings.forEach((node, siblingIndex) => {
    node.index = siblingIndex;
  });
  parent.children ??= [];
  const targetIndex = Math.min(index ?? parent.children.length, parent.children.length);
  found.node.parentId = parentId;
  parent.children.splice(targetIndex, 0, found.node);
  parent.children.forEach((node, siblingIndex) => {
    node.index = siblingIndex;
  });
  setBookmarkTree(snapshot);
  return structuredClone(found.node);
}

function storedJournal(): BookmarkOperationJournalEnvelope {
  return getStorageSnapshot()[BOOKMARK_OPERATIONS_KEY] as BookmarkOperationJournalEnvelope;
}

function installSuccessfulStorageSet(): void {
  getStorageMocks().set.mockImplementation(
    (items: Record<string, unknown>, callback?: () => void) => {
      setStorageSnapshot({
        ...getStorageSnapshot(),
        ...structuredClone(items),
      });
      callback?.();
    },
  );
}

describe('bookmark operation journal', () => {
  it('uses a fixed SHA-256 payload identity and strict request/response parsers', async () => {
    const first = await createBookmarkExecutionPayloadIdentity(
      'update_bookmark_urls',
      [{ id: 'bookmark-1', url: 'https://example.com/new' }],
      'manual',
    );
    const second = await createBookmarkExecutionPayloadIdentity(
      'update_bookmark_urls',
      [{ url: 'https://example.com/new', id: 'bookmark-1' }],
      'manual',
    );

    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect(() =>
      parseBookmarkOperationCommand({
        type: 'bookmarkOperations:delete',
        requestId: 'request-1',
        bookmarkIds: ['bookmark-1'],
        unknown: true,
      }),
    ).toThrow();
  });

  it('persists delete attempt before mutation and replays an immutable receipt', async () => {
    setBookmarkTree(tree([bookmark('bookmark-1', 'Delete me', 'https://example.com/delete')]));
    const mocks = getBookmarkMocks();
    mocks.remove.mockImplementationOnce((id: string, callback?: () => void) => {
      const operation = storedJournal().operations[0];
      expect(operation?.items[0]).toMatchObject({
        bookmarkId: id,
        executionStatus: 'pending',
        executionAttemptCount: 1,
      });
      removeTreeNode(id);
      callback?.();
    });

    const first = await executeDeleteBookmarks('delete-request-1', ['bookmark-1']);
    const historical = structuredClone(first.receipt);
    const replay = await executeDeleteBookmarks('delete-request-1', ['bookmark-1']);

    expect(first.operation.status).toBe('complete');
    expect(first.operation.items[0]).toMatchObject({
      executionStatus: 'succeeded',
      restoreStatus: 'pending',
    });
    expect(replay.receipt).toEqual(historical);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(() => parseBookmarkOperationCommandResponse({ ...replay, unknown: true })).toThrow();
    await expect(
      executeDeleteBookmarks('delete-request-1', ['different-bookmark']),
    ).rejects.toMatchObject({ code: 'request_id_conflict' });
  });

  it('does not attribute a no-attempt missing delete to the operation', async () => {
    setBookmarkTree(tree([]));

    const response = await executeDeleteBookmarks('delete-missing-1', ['bookmark-missing']);

    expect(response.operation.status).toBe('failed');
    expect(response.operation.items[0]).toMatchObject({
      executionStatus: 'failed',
      executionAttemptCount: 0,
      errorCode: 'bookmark_not_found',
    });
    expect(getBookmarkMocks().remove).not.toHaveBeenCalled();
  });

  it('fails closed on a present null journal before reading or mutating bookmarks', async () => {
    setBookmarkTree(tree([bookmark('bookmark-1', 'Protected', 'https://example.com/protected')]));
    setStorageSnapshot({ [BOOKMARK_OPERATIONS_KEY]: null });

    await expect(
      executeDeleteBookmarks('delete-null-journal', ['bookmark-1']),
    ).rejects.toMatchObject({ code: 'journal_corrupt' });
    expect(getBookmarkMocks().remove).not.toHaveBeenCalled();
    expect(getStorageSnapshot()[BOOKMARK_OPERATIONS_KEY]).toBeNull();
  });

  it('treats an already-target URL as skipped without offering restore', async () => {
    setBookmarkTree(tree([bookmark('bookmark-1', 'Already', 'https://example.com/new')]));

    const response = await executeBookmarkUrlUpdates(
      'url-already-request',
      [{ id: 'bookmark-1', url: 'https://example.com/new' }],
      'manual',
    );

    expect(response.operation.status).toBe('complete');
    expect(response.operation.items[0]).toMatchObject({
      executionStatus: 'skipped',
      errorCode: 'already_target',
      restoreStatus: 'not_needed',
    });
    expect(getBookmarkMocks().update).not.toHaveBeenCalled();
  });

  it('replays URL update request IDs and rejects a different normalized payload', async () => {
    setBookmarkTree(tree([bookmark('bookmark-1', 'URL', 'https://example.com/old')]));

    const first = await executeBookmarkUrlUpdates(
      'url-idempotent-request',
      [{ id: 'bookmark-1', url: 'https://example.com/new' }],
      'manual',
    );
    const replay = await executeBookmarkUrlUpdates(
      'url-idempotent-request',
      [{ url: 'https://example.com/new', id: 'bookmark-1' }],
      'manual',
    );

    expect(replay.receipt).toEqual(first.receipt);
    expect(getBookmarkMocks().update).toHaveBeenCalledTimes(1);
    await expect(
      executeBookmarkUrlUpdates(
        'url-idempotent-request',
        [{ id: 'bookmark-1', url: 'https://example.com/other' }],
        'manual',
      ),
    ).rejects.toMatchObject({ code: 'request_id_conflict' });
    expect(getBookmarkMocks().update).toHaveBeenCalledTimes(1);
  });

  it('reconciles an uncertain URL mutation from current Chrome state', async () => {
    setBookmarkTree(tree([bookmark('bookmark-1', 'URL', 'https://example.com/old')]));
    getBookmarkMocks().update.mockImplementationOnce(
      (
        id: string,
        changes: { title?: string; url?: string },
        callback?: (result: TreeNode) => void,
      ) => {
        replaceNodeUrl(id, changes.url ?? '');
        setRuntimeLastError('Uncertain callback');
        callback?.(bookmark(id, 'URL', changes.url ?? '', '1', 0));
        setRuntimeLastError(undefined);
      },
    );

    const response = await executeBookmarkUrlUpdates(
      'url-uncertain-request',
      [{ id: 'bookmark-1', url: 'https://example.com/new' }],
      'manual',
    );

    expect(response.operation.status).toBe('complete');
    expect(response.operation.items[0]?.executionStatus).toBe('succeeded');
  });

  it('reconciles a real attempt breakpoint without replaying the mutation', async () => {
    setBookmarkTree(tree([bookmark('bookmark-1', 'URL', 'https://example.com/old')]));
    let failedOutcomeWrite = false;
    getStorageMocks().set.mockImplementation(
      (items: Record<string, unknown>, callback?: () => void) => {
        const envelope = items[BOOKMARK_OPERATIONS_KEY] as
          | BookmarkOperationJournalEnvelope
          | undefined;
        const item = envelope?.operations[0]?.items[0];
        if (!failedOutcomeWrite && item?.executionStatus === 'succeeded') {
          failedOutcomeWrite = true;
          setRuntimeLastError('QUOTA_BYTES exceeded');
          callback?.();
          setRuntimeLastError(undefined);
          return;
        }
        setStorageSnapshot({
          ...getStorageSnapshot(),
          ...structuredClone(items),
        });
        callback?.();
      },
    );

    await expect(
      executeBookmarkUrlUpdates(
        'url-breakpoint-request',
        [{ id: 'bookmark-1', url: 'https://example.com/new' }],
        'manual',
      ),
    ).rejects.toMatchObject({ code: 'storage_write_failed' });
    expect(storedJournal().operations[0]?.items[0]).toMatchObject({
      executionStatus: 'pending',
      executionAttemptCount: 1,
    });
    expect(getBookmarkMocks().update).toHaveBeenCalledTimes(1);

    installSuccessfulStorageSet();
    await Promise.resolve();
    const operations = await reconcileInterruptedBookmarkOperations([]);

    expect(operations[0]?.items[0]?.executionStatus).toBe('succeeded');
    expect(operations[0]?.commands[0]?.status).toBe('succeeded');
    expect(getBookmarkMocks().update).toHaveBeenCalledTimes(1);
  });

  it('stops before the next mutation when an outcome write fails', async () => {
    setBookmarkTree(
      tree([
        bookmark('bookmark-1', 'One', 'https://example.com/one-old'),
        bookmark('bookmark-2', 'Two', 'https://example.com/two-old'),
      ]),
    );
    let failedOutcomeWrite = false;
    getStorageMocks().set.mockImplementation(
      (items: Record<string, unknown>, callback?: () => void) => {
        const envelope = items[BOOKMARK_OPERATIONS_KEY] as
          | BookmarkOperationJournalEnvelope
          | undefined;
        if (
          !failedOutcomeWrite &&
          envelope?.operations[0]?.items[0]?.executionStatus === 'succeeded'
        ) {
          failedOutcomeWrite = true;
          setRuntimeLastError('QUOTA_BYTES exceeded');
          callback?.();
          setRuntimeLastError(undefined);
          return;
        }
        setStorageSnapshot({
          ...getStorageSnapshot(),
          ...structuredClone(items),
        });
        callback?.();
      },
    );

    await expect(
      executeBookmarkUrlUpdates(
        'url-stop-after-quota',
        [
          { id: 'bookmark-1', url: 'https://example.com/one-new' },
          { id: 'bookmark-2', url: 'https://example.com/two-new' },
        ],
        'manual',
      ),
    ).rejects.toMatchObject({ code: 'storage_write_failed' });
    expect(getBookmarkMocks().update).toHaveBeenCalledTimes(1);

    installSuccessfulStorageSet();
    await Promise.resolve();
    const operations = await reconcileInterruptedBookmarkOperations([]);
    expect(operations[0]?.status).toBe('partial');
    expect(operations[0]?.items.map((item) => item.executionStatus)).toEqual([
      'succeeded',
      'failed',
    ]);
    expect(getBookmarkMocks().update).toHaveBeenCalledTimes(1);
  });

  it('persists active cancel before signalling and reports partial after one success', async () => {
    setBookmarkTree(
      tree([
        bookmark('bookmark-1', 'One', 'https://example.com/one'),
        bookmark('bookmark-2', 'Two', 'https://example.com/two'),
      ]),
    );
    let releaseMutation: (() => void) | undefined;
    getBookmarkMocks().remove.mockImplementationOnce((id: string, callback?: () => void) => {
      releaseMutation = () => {
        removeTreeNode(id);
        callback?.();
      };
    });

    const executePromise = executeDeleteBookmarks('delete-cancel-run', [
      'bookmark-1',
      'bookmark-2',
    ]);
    await vi.waitFor(() => {
      expect(getBookmarkMocks().remove).toHaveBeenCalledTimes(1);
    });
    const activeReplayPromise = executeDeleteBookmarks('delete-cancel-run', [
      'bookmark-1',
      'bookmark-2',
    ]);
    const operationId = storedJournal().operations[0]?.id;
    if (!operationId) {
      throw new Error('missing operation id');
    }
    const cancelPromise = cancelBookmarkOperation('delete-cancel-command', operationId);
    await vi.waitFor(() => {
      const cancelReceipt = storedJournal().operations[0]?.commands.find(
        (command) => command.requestId === 'delete-cancel-command',
      );
      expect(cancelReceipt?.status).toBe('pending');
    });
    releaseMutation?.();

    const [executeResponse, activeReplay, cancelResponse] = await Promise.all([
      executePromise,
      activeReplayPromise,
      cancelPromise,
    ]);
    expect(executeResponse.operation.status).toBe('partial');
    expect(executeResponse.operation.items.map((item) => item.executionStatus)).toEqual([
      'succeeded',
      'skipped',
    ]);
    expect(cancelResponse.receipt.status).toBe('succeeded');
    expect(cancelResponse.operation.status).toBe('partial');
    expect(activeReplay.receipt).toEqual(executeResponse.receipt);
    expect(getBookmarkMocks().remove).toHaveBeenCalledTimes(1);
    const cancelReplay = await cancelBookmarkOperation('delete-cancel-command', operationId);
    expect(cancelReplay.receipt).toEqual(cancelResponse.receipt);
  });

  it('does not start delete mutation after cancel is persisted during the preflight read', async () => {
    setBookmarkTree(
      tree([bookmark('bookmark-1', 'Cancel before delete', 'https://example.com/cancel')]),
    );
    let getCallCount = 0;
    let releaseRead: (() => void) | undefined;
    getBookmarkMocks().get.mockImplementation(
      (idOrIds: string | string[], callback: (results: TreeNode[]) => void) => {
        getCallCount += 1;
        const id = Array.isArray(idOrIds) ? idOrIds[0] : idOrIds;
        const node = id ? findTreeNode(id)?.node : undefined;
        const respond = () => callback(node ? [structuredClone(node)] : []);
        if (getCallCount === 2) {
          releaseRead = respond;
          return;
        }
        respond();
      },
    );

    const executePromise = executeDeleteBookmarks('cancel-during-delete-read', ['bookmark-1']);
    await vi.waitFor(() => expect(releaseRead).toBeTypeOf('function'));
    const operationId = storedJournal().operations[0]?.id;
    if (!operationId) {
      throw new Error('missing operation id');
    }
    const cancelPromise = cancelBookmarkOperation('cancel-during-delete-command', operationId);
    await vi.waitFor(() => {
      expect(
        storedJournal().operations[0]?.commands.find(
          (command) => command.requestId === 'cancel-during-delete-command',
        )?.status,
      ).toBe('pending');
    });
    releaseRead?.();

    const [executed, cancelled] = await Promise.all([executePromise, cancelPromise]);
    expect(executed.operation.status).toBe('cancelled');
    expect(executed.operation.items[0]).toMatchObject({
      executionStatus: 'skipped',
      executionAttemptCount: 0,
      errorCode: 'operation_cancelled',
    });
    expect(cancelled.receipt.status).toBe('succeeded');
    expect(getBookmarkMocks().remove).not.toHaveBeenCalled();
  });

  it('does not create a target folder after cancel is persisted during folder preflight', async () => {
    setBookmarkTree(tree([bookmark('bookmark-1', 'Cancel folder', 'https://example.com/folder')]));
    let releaseChildren: (() => void) | undefined;
    getBookmarkMocks().getChildren.mockImplementationOnce(
      (parentId: string, callback: (results: TreeNode[]) => void) => {
        const children = findTreeNode(parentId)?.node.children ?? [];
        releaseChildren = () => callback(structuredClone(children));
      },
    );

    const executePromise = executeBookmarkMoves('cancel-during-folder-read', [
      { bookmarkId: 'bookmark-1', targetFolder: 'New Folder' },
    ]);
    await vi.waitFor(() => expect(releaseChildren).toBeTypeOf('function'));
    const operationId = storedJournal().operations[0]?.id;
    if (!operationId) {
      throw new Error('missing operation id');
    }
    const cancelPromise = cancelBookmarkOperation('cancel-during-folder-command', operationId);
    await vi.waitFor(() => {
      expect(
        storedJournal().operations[0]?.commands.find(
          (command) => command.requestId === 'cancel-during-folder-command',
        )?.status,
      ).toBe('pending');
    });
    releaseChildren?.();

    const [executed, cancelled] = await Promise.all([executePromise, cancelPromise]);
    expect(executed.operation.status).toBe('cancelled');
    expect(executed.operation.items[0]).toMatchObject({
      executionStatus: 'skipped',
      executionAttemptCount: 0,
      errorCode: 'operation_cancelled',
      targetStatus: 'failed',
      targetErrorCode: 'operation_cancelled',
    });
    expect(cancelled.receipt.status).toBe('succeeded');
    expect(getBookmarkMocks().create).not.toHaveBeenCalled();
    expect(getBookmarkMocks().move).not.toHaveBeenCalled();
  });

  it('restores URL only from the operation target and accepts a manual conflict explicitly', async () => {
    setBookmarkTree(tree([bookmark('bookmark-1', 'URL', 'https://example.com/old')]));
    const executed = await executeBookmarkUrlUpdates(
      'url-restore-execute',
      [{ id: 'bookmark-1', url: 'https://example.com/new' }],
      'manual',
    );
    replaceNodeUrl('bookmark-1', 'https://example.com/old');

    const restored = await restoreBookmarkOperation('url-restore-command', executed.operation.id);

    expect(restored.operation.status).toBe('restore_partial');
    expect(restored.operation.items[0]).toMatchObject({
      restoreStatus: 'conflict',
      restoreAttemptCount: 0,
    });
    const updatesBeforeAccept = getBookmarkMocks().update.mock.calls.length;
    const accepted = await acceptBookmarkOperationCurrentState(
      'url-accept-command',
      executed.operation.id,
    );
    const acceptedReplay = await acceptBookmarkOperationCurrentState(
      'url-accept-command',
      executed.operation.id,
    );
    expect(accepted.operation.status).toBe('resolved');
    expect(accepted.operation.items[0]?.restoreStatus).toBe('accepted_current');
    expect(acceptedReplay.receipt).toEqual(accepted.receipt);
    expect(getBookmarkMocks().update).toHaveBeenCalledTimes(updatesBeforeAccept);
    await expect(
      acceptBookmarkOperationCurrentState('url-accept-command', 'other-operation'),
    ).rejects.toMatchObject({ code: 'request_id_conflict' });
  });

  it('stops later restore mutations after a conflict', async () => {
    setBookmarkTree(
      tree([
        bookmark('bookmark-1', 'One', 'https://example.com/one-old'),
        bookmark('bookmark-2', 'Two', 'https://example.com/two-old'),
      ]),
    );
    const executed = await executeBookmarkUrlUpdates(
      'restore-stop-execute',
      [
        { id: 'bookmark-1', url: 'https://example.com/one-new' },
        { id: 'bookmark-2', url: 'https://example.com/two-new' },
      ],
      'manual',
    );
    replaceNodeUrl('bookmark-1', 'https://example.com/one-old');
    getBookmarkMocks().update.mockClear();

    const restored = await restoreBookmarkOperation('restore-stop-command', executed.operation.id);

    expect(restored.operation.status).toBe('restore_partial');
    expect(restored.operation.items.map((item) => item.restoreStatus)).toEqual([
      'conflict',
      'pending',
    ]);
    expect(getBookmarkMocks().update).not.toHaveBeenCalled();
  });

  it('allows accept_current to resolve a persisted restore_failed item', async () => {
    setBookmarkTree(tree([bookmark('bookmark-1', 'URL', 'https://example.com/old')]));
    const executed = await executeBookmarkUrlUpdates(
      'restore-failed-execute',
      [{ id: 'bookmark-1', url: 'https://example.com/new' }],
      'manual',
    );
    getBookmarkMocks().update.mockImplementationOnce(
      (
        id: string,
        _changes: { title?: string; url?: string },
        callback?: (result: TreeNode) => void,
      ) => {
        callback?.(bookmark(id, 'URL', 'https://example.com/new', '1', 0));
      },
    );
    const restored = await restoreBookmarkOperation(
      'restore-failed-command',
      executed.operation.id,
    );
    expect(restored.operation.items[0]?.restoreStatus).toBe('restore_failed');

    const accepted = await acceptBookmarkOperationCurrentState(
      'restore-failed-accept',
      executed.operation.id,
    );
    expect(accepted.operation.status).toBe('resolved');
    expect(accepted.operation.items[0]?.restoreStatus).toBe('accepted_current');
  });

  it('reconciles a pending accept_current receipt after its terminal write is interrupted', async () => {
    setBookmarkTree(tree([bookmark('bookmark-1', 'URL', 'https://example.com/old')]));
    const executed = await executeBookmarkUrlUpdates(
      'accept-break-execute',
      [{ id: 'bookmark-1', url: 'https://example.com/new' }],
      'manual',
    );
    replaceNodeUrl('bookmark-1', 'https://example.com/old');
    const restored = await restoreBookmarkOperation('accept-break-restore', executed.operation.id);
    expect(restored.operation.status).toBe('restore_partial');
    const updateCount = getBookmarkMocks().update.mock.calls.length;
    let failedTerminalWrite = false;
    getStorageMocks().set.mockImplementation(
      (items: Record<string, unknown>, callback?: () => void) => {
        const envelope = items[BOOKMARK_OPERATIONS_KEY] as
          | BookmarkOperationJournalEnvelope
          | undefined;
        const receipt = envelope?.operations[0]?.commands.find(
          (command) => command.requestId === 'accept-break-command',
        );
        if (!failedTerminalWrite && receipt?.status === 'succeeded') {
          failedTerminalWrite = true;
          setRuntimeLastError('QUOTA_BYTES exceeded');
          callback?.();
          setRuntimeLastError(undefined);
          return;
        }
        setStorageSnapshot({
          ...getStorageSnapshot(),
          ...structuredClone(items),
        });
        callback?.();
      },
    );

    await expect(
      acceptBookmarkOperationCurrentState('accept-break-command', executed.operation.id),
    ).rejects.toMatchObject({ code: 'storage_write_failed' });
    expect(
      storedJournal().operations[0]?.commands.find(
        (command) => command.requestId === 'accept-break-command',
      )?.status,
    ).toBe('pending');

    installSuccessfulStorageSet();
    const operations = await reconcileInterruptedBookmarkOperations([]);
    expect(operations[0]?.status).toBe('resolved');
    expect(operations[0]?.items[0]?.restoreStatus).toBe('accepted_current');
    const replay = await acceptBookmarkOperationCurrentState(
      'accept-break-command',
      executed.operation.id,
    );
    expect(replay.receipt.status).toBe('succeeded');
    expect(getBookmarkMocks().update).toHaveBeenCalledTimes(updateCount);
  });

  it('cancels an active restore after the in-flight mutation and leaves later items pending', async () => {
    setBookmarkTree(
      tree([
        bookmark('bookmark-1', 'One', 'https://example.com/one-old'),
        bookmark('bookmark-2', 'Two', 'https://example.com/two-old'),
      ]),
    );
    const executed = await executeBookmarkUrlUpdates(
      'url-restore-cancel-execute',
      [
        { id: 'bookmark-1', url: 'https://example.com/one-new' },
        { id: 'bookmark-2', url: 'https://example.com/two-new' },
      ],
      'manual',
    );
    getBookmarkMocks().update.mockClear();
    let releaseRestore: (() => void) | undefined;
    getBookmarkMocks().update.mockImplementationOnce(
      (
        id: string,
        changes: { title?: string; url?: string },
        callback?: (result: TreeNode) => void,
      ) => {
        releaseRestore = () => {
          replaceNodeUrl(id, changes.url ?? '');
          callback?.(bookmark(id, 'One', changes.url ?? '', '1', 0));
        };
      },
    );

    const restorePromise = restoreBookmarkOperation(
      'url-restore-cancel-command',
      executed.operation.id,
    );
    await vi.waitFor(() => {
      expect(getBookmarkMocks().update).toHaveBeenCalledTimes(1);
    });
    const busy = await restoreBookmarkOperation('url-restore-busy-command', executed.operation.id);
    expect(busy.receipt).toMatchObject({
      status: 'failed',
      result: { errorCode: 'operation_busy' },
    });
    const cancelPromise = cancelBookmarkOperation(
      'url-restore-cancel-intent',
      executed.operation.id,
    );
    await vi.waitFor(() => {
      expect(
        storedJournal().operations[0]?.commands.some(
          (command) =>
            command.requestId === 'url-restore-cancel-intent' && command.status === 'pending',
        ),
      ).toBe(true);
    });
    releaseRestore?.();

    const [restoreResponse, cancelResponse] = await Promise.all([restorePromise, cancelPromise]);
    expect(restoreResponse.operation.status).toBe('restore_partial');
    expect(restoreResponse.operation.items.map((item) => item.restoreStatus)).toEqual([
      'restored',
      'pending',
    ]);
    expect(cancelResponse.receipt.status).toBe('succeeded');
    expect(getBookmarkMocks().update).toHaveBeenCalledTimes(1);
    expect(
      cancelResponse.operation.commands.some(
        (command) => command.requestId === 'url-restore-busy-command',
      ),
    ).toBe(true);
  });

  it('replays restore and cancel request IDs without a second mutation', async () => {
    setBookmarkTree(tree([bookmark('bookmark-1', 'URL', 'https://example.com/old')]));
    const executed = await executeBookmarkUrlUpdates(
      'command-replay-execute',
      [{ id: 'bookmark-1', url: 'https://example.com/new' }],
      'manual',
    );
    const restored = await restoreBookmarkOperation(
      'command-replay-restore',
      executed.operation.id,
    );
    const mutationCount = getBookmarkMocks().update.mock.calls.length;
    const replay = await restoreBookmarkOperation('command-replay-restore', executed.operation.id);

    expect(replay.receipt).toEqual(restored.receipt);
    expect(getBookmarkMocks().update).toHaveBeenCalledTimes(mutationCount);
    await expect(
      restoreBookmarkOperation('command-replay-restore', 'other-operation'),
    ).rejects.toMatchObject({ code: 'request_id_conflict' });

    const cancelled = await cancelBookmarkOperation('command-replay-cancel', executed.operation.id);
    const cancelReplay = await cancelBookmarkOperation(
      'command-replay-cancel',
      executed.operation.id,
    );
    expect(cancelReplay.receipt).toEqual(cancelled.receipt);
    expect(cancelled.receipt).toMatchObject({
      status: 'failed',
      result: { errorCode: 'invalid_operation_state' },
    });
    await expect(
      cancelBookmarkOperation('command-replay-cancel', 'other-operation'),
    ).rejects.toMatchObject({ code: 'request_id_conflict' });
  });

  it('reconciles a persisted cancel intent after an execution outcome breakpoint', async () => {
    setBookmarkTree(
      tree([
        bookmark('bookmark-1', 'One', 'https://example.com/one'),
        bookmark('bookmark-2', 'Two', 'https://example.com/two'),
      ]),
    );
    let releaseMutation: (() => void) | undefined;
    getBookmarkMocks().remove.mockImplementationOnce((id: string, callback?: () => void) => {
      releaseMutation = () => {
        removeTreeNode(id);
        callback?.();
      };
    });
    let failedOutcomeWrite = false;
    getStorageMocks().set.mockImplementation(
      (items: Record<string, unknown>, callback?: () => void) => {
        const envelope = items[BOOKMARK_OPERATIONS_KEY] as
          | BookmarkOperationJournalEnvelope
          | undefined;
        const operation = envelope?.operations[0];
        const cancelReceipt = operation?.commands.find(
          (command) => command.requestId === 'cancel-break-command',
        );
        if (
          !failedOutcomeWrite &&
          cancelReceipt?.status === 'pending' &&
          operation?.items[0]?.executionStatus === 'succeeded'
        ) {
          failedOutcomeWrite = true;
          setRuntimeLastError('QUOTA_BYTES exceeded');
          callback?.();
          setRuntimeLastError(undefined);
          return;
        }
        setStorageSnapshot({
          ...getStorageSnapshot(),
          ...structuredClone(items),
        });
        callback?.();
      },
    );

    const executePromise = executeDeleteBookmarks('cancel-break-execute', [
      'bookmark-1',
      'bookmark-2',
    ]);
    await vi.waitFor(() => {
      expect(getBookmarkMocks().remove).toHaveBeenCalledTimes(1);
    });
    const operationId = storedJournal().operations[0]?.id;
    if (!operationId) {
      throw new Error('missing operation id');
    }
    const cancelPromise = cancelBookmarkOperation('cancel-break-command', operationId);
    await vi.waitFor(() => {
      expect(
        storedJournal().operations[0]?.commands.find(
          (command) => command.requestId === 'cancel-break-command',
        )?.status,
      ).toBe('pending');
    });
    releaseMutation?.();

    await expect(executePromise).rejects.toMatchObject({ code: 'storage_write_failed' });
    await expect(cancelPromise).rejects.toMatchObject({ code: 'storage_write_failed' });
    expect(storedJournal().operations[0]?.items[0]).toMatchObject({
      executionStatus: 'pending',
      executionAttemptCount: 1,
    });

    installSuccessfulStorageSet();
    await Promise.resolve();
    const operations = await reconcileInterruptedBookmarkOperations([]);
    expect(operations[0]?.status).toBe('partial');
    expect(operations[0]?.items.map((item) => item.executionStatus)).toEqual([
      'succeeded',
      'skipped',
    ]);
    const replay = await cancelBookmarkOperation('cancel-break-command', operationId);
    expect(replay.receipt.status).toBe('succeeded');
    expect(getBookmarkMocks().remove).toHaveBeenCalledTimes(1);
  });

  it('reconciles a restore outcome breakpoint without replaying restore', async () => {
    setBookmarkTree(tree([bookmark('bookmark-1', 'URL', 'https://example.com/old')]));
    const executed = await executeBookmarkUrlUpdates(
      'restore-break-execute',
      [{ id: 'bookmark-1', url: 'https://example.com/new' }],
      'manual',
    );
    let failedOutcomeWrite = false;
    getStorageMocks().set.mockImplementation(
      (items: Record<string, unknown>, callback?: () => void) => {
        const envelope = items[BOOKMARK_OPERATIONS_KEY] as
          | BookmarkOperationJournalEnvelope
          | undefined;
        const item = envelope?.operations[0]?.items[0];
        if (!failedOutcomeWrite && item?.restoreStatus === 'restored') {
          failedOutcomeWrite = true;
          setRuntimeLastError('QUOTA_BYTES exceeded');
          callback?.();
          setRuntimeLastError(undefined);
          return;
        }
        setStorageSnapshot({
          ...getStorageSnapshot(),
          ...structuredClone(items),
        });
        callback?.();
      },
    );

    await expect(
      restoreBookmarkOperation('restore-break-command', executed.operation.id),
    ).rejects.toMatchObject({ code: 'storage_write_failed' });
    expect(storedJournal().operations[0]?.items[0]).toMatchObject({
      restoreStatus: 'pending',
      restoreAttemptCount: 1,
    });
    expect(getBookmarkMocks().update).toHaveBeenCalledTimes(2);

    installSuccessfulStorageSet();
    await Promise.resolve();
    const operations = await reconcileInterruptedBookmarkOperations([]);
    expect(operations[0]?.status).toBe('restored');
    expect(operations[0]?.items[0]?.restoreStatus).toBe('restored');
    expect(getBookmarkMocks().update).toHaveBeenCalledTimes(2);
  });

  it('persists the restore receipt and restoring state in one journal write', async () => {
    setBookmarkTree(tree([bookmark('bookmark-1', 'URL', 'https://example.com/old')]));
    const executed = await executeBookmarkUrlUpdates(
      'atomic-restore-execute',
      [{ id: 'bookmark-1', url: 'https://example.com/new' }],
      'manual',
    );
    const snapshots: BookmarkOperationJournalEnvelope[] = [];
    getStorageMocks().set.mockImplementation(
      (items: Record<string, unknown>, callback?: () => void) => {
        const envelope = items[BOOKMARK_OPERATIONS_KEY] as
          | BookmarkOperationJournalEnvelope
          | undefined;
        if (envelope) {
          snapshots.push(structuredClone(envelope));
        }
        setStorageSnapshot({
          ...getStorageSnapshot(),
          ...structuredClone(items),
        });
        callback?.();
      },
    );

    await restoreBookmarkOperation('atomic-restore-command', executed.operation.id);

    const firstPendingRestore = snapshots.find((envelope) =>
      envelope.operations[0]?.commands.some(
        (command) => command.requestId === 'atomic-restore-command' && command.status === 'pending',
      ),
    )?.operations[0];
    expect(firstPendingRestore?.status).toBe('restoring');
    expect(
      snapshots.some(
        (envelope) =>
          envelope.operations[0]?.status !== 'restoring' &&
          envelope.operations[0]?.commands.some(
            (command) =>
              command.requestId === 'atomic-restore-command' && command.status === 'pending',
          ),
      ),
    ).toBe(false);
  });

  it('reserves every retryable restore before appending its pending receipt', async () => {
    setBookmarkTree(tree([bookmark('bookmark-1', 'URL', 'https://example.com/old')]));
    const executed = await executeBookmarkUrlUpdates(
      'retry-budget-execute',
      [{ id: 'bookmark-1', url: 'https://example.com/new' }],
      'manual',
    );
    replaceNodeUrl('bookmark-1', 'https://example.com/external-change');
    const conflicted = await restoreBookmarkOperation(
      'retry-budget-first-restore',
      executed.operation.id,
    );
    expect(conflicted.operation.items[0]?.restoreStatus).toBe('conflict');

    const before = storedJournal();
    const beforeCommandCount = before.operations[0]?.commands.length;
    setStorageSnapshot({
      ...getStorageSnapshot(),
      [BOOKMARK_OPERATIONS_KEY]: {
        ...before,
        revision: Number.MAX_SAFE_INTEGER - 2,
      },
    });
    getBookmarkMocks().update.mockClear();

    await expect(
      restoreBookmarkOperation('retry-budget-second-restore', executed.operation.id),
    ).rejects.toMatchObject({ code: 'journal_reserve_exceeded' });

    const after = storedJournal();
    expect(after.operations[0]?.commands).toHaveLength(beforeCommandCount ?? 0);
    expect(
      after.operations[0]?.commands.some(
        (command) => command.requestId === 'retry-budget-second-restore',
      ),
    ).toBe(false);
    expect(getBookmarkMocks().update).not.toHaveBeenCalled();
  });

  it('rejects a terminal restore item at the attempt limit without appending a pending receipt', async () => {
    setBookmarkTree(tree([bookmark('bookmark-1', 'URL', 'https://example.com/old')]));
    const executed = await executeBookmarkUrlUpdates(
      'attempt-limit-execute',
      [{ id: 'bookmark-1', url: 'https://example.com/new' }],
      'manual',
    );
    replaceNodeUrl('bookmark-1', 'https://example.com/external-change');
    const conflicted = await restoreBookmarkOperation(
      'attempt-limit-first-restore',
      executed.operation.id,
    );
    expect(conflicted.operation.items[0]?.restoreStatus).toBe('conflict');

    const before = storedJournal();
    const exhausted = structuredClone(before.operations[0]);
    const item = exhausted?.items[0];
    if (!exhausted || !item) {
      throw new Error('Missing exhausted restore fixture');
    }
    item.restoreAttemptCount = 64;
    item.restoreAttemptedAt = item.restoreCompletedAt;
    const exhaustedEnvelope = {
      ...before,
      revision: Number.MAX_SAFE_INTEGER - 2,
      operations: [exhausted],
    };
    setStorageSnapshot({
      ...getStorageSnapshot(),
      [BOOKMARK_OPERATIONS_KEY]: exhaustedEnvelope,
    });
    getBookmarkMocks().update.mockClear();

    const rejected = await restoreBookmarkOperation(
      'attempt-limit-second-restore',
      executed.operation.id,
    );

    expect(rejected.receipt).toMatchObject({
      status: 'failed',
      result: { errorCode: 'invalid_operation_state' },
    });
    expect(rejected.operation.status).toBe('restore_partial');
    expect(
      rejected.operation.commands.some(
        (command) =>
          command.requestId === 'attempt-limit-second-restore' && command.status === 'pending',
      ),
    ).toBe(false);
    expect(storedJournal().revision).toBe(Number.MAX_SAFE_INTEGER - 1);
    expect(getBookmarkMocks().update).not.toHaveBeenCalled();
  });

  it('reuses one target folder and conflicts on multiple same-name folders', async () => {
    setBookmarkTree(
      tree([
        bookmark('bookmark-1', 'Move', 'https://example.com/move'),
        folder('target-1', 'Target', []),
      ]),
    );

    const reused = await executeBookmarkMoves('move-reuse-request', [
      { bookmarkId: 'bookmark-1', targetFolder: 'Target' },
    ]);
    expect(reused.operation.status).toBe('complete');
    expect(reused.operation.items[0]).toMatchObject({
      executionStatus: 'succeeded',
      targetParentId: 'target-1',
      folderResolution: [
        expect.objectContaining({
          status: 'existing',
          baselineIds: ['target-1'],
        }),
      ],
    });
    expect(getBookmarkMocks().create).not.toHaveBeenCalled();
    const moveCount = getBookmarkMocks().move.mock.calls.length;
    const replay = await executeBookmarkMoves('move-reuse-request', [
      { targetFolder: 'Target', bookmarkId: 'bookmark-1' },
    ]);
    expect(replay.receipt).toEqual(reused.receipt);
    expect(getBookmarkMocks().move).toHaveBeenCalledTimes(moveCount);
    await expect(
      executeBookmarkMoves('move-reuse-request', [
        { bookmarkId: 'bookmark-1', targetFolder: 'Other' },
      ]),
    ).rejects.toMatchObject({ code: 'request_id_conflict' });

    setStorageSnapshot({});
    setBookmarkTree(
      tree([
        bookmark('bookmark-2', 'Move', 'https://example.com/move-2'),
        folder('target-a', 'Target', []),
        folder('target-b', 'Target', []),
      ]),
    );
    getBookmarkMocks().create.mockClear();
    getBookmarkMocks().move.mockClear();
    const conflict = await executeBookmarkMoves('move-conflict-request', [
      { bookmarkId: 'bookmark-2', targetFolder: 'Target' },
    ]);
    expect(conflict.operation.status).toBe('failed');
    expect(conflict.operation.items[0]).toMatchObject({
      executionStatus: 'conflict',
      errorCode: 'target_folder_conflict',
    });
    expect(getBookmarkMocks().create).not.toHaveBeenCalled();
    expect(getBookmarkMocks().move).not.toHaveBeenCalled();
    expect(getBookmarkMocks().remove).not.toHaveBeenCalled();
  });

  it.each([1, 8])(
    'accepts %i bookmarks targeting one valid 511-byte, sixteen-level folder path',
    async (itemCount) => {
      const segments = Array.from({ length: 16 }, (_, index) =>
        String(index).padStart(2, '0').padEnd(31, 'x'),
      );
      const targetFolder = segments.join('/');
      const bookmarks = Array.from({ length: itemCount }, (_, index) =>
        bookmark(`deep-bookmark-${index}`, `Deep ${index}`, `https://example.com/deep/${index}`),
      );
      setBookmarkTree(tree([...bookmarks, deepFolderChain(segments)]));

      const response = await executeBookmarkMoves(
        `deep-path-request-${itemCount}`,
        bookmarks.map((item) => ({
          bookmarkId: item.id,
          targetFolder,
        })),
      );

      expect(targetFolder).toHaveLength(511);
      expect(response.operation.status).toBe('complete');
      expect(response.operation.summary.succeeded).toBe(itemCount);
      expect(getBookmarkMocks().create).not.toHaveBeenCalled();
      expect(getBookmarkMocks().move).toHaveBeenCalledTimes(itemCount);
    },
  );

  it('rejects an oversized deep move journal before the first Chrome mutation', async () => {
    const segments = Array.from({ length: 16 }, (_, index) =>
      String(index).padStart(2, '0').padEnd(31, 'x'),
    );
    const targetFolder = segments.join('/');
    const bookmarks = Array.from({ length: 79 }, (_, index) =>
      bookmark(`oversized-${index}`, `Oversized ${index}`, `https://example.com/${index}`),
    );
    setBookmarkTree(tree(bookmarks));

    await expect(
      executeBookmarkMoves(
        'oversized-deep-path-request',
        bookmarks.map((item) => ({
          bookmarkId: item.id,
          targetFolder,
        })),
      ),
    ).rejects.toMatchObject({ code: 'journal_reserve_exceeded' });

    expect(getBookmarkMocks().create).not.toHaveBeenCalled();
    expect(getBookmarkMocks().move).not.toHaveBeenCalled();
    expect(getBookmarkMocks().update).not.toHaveBeenCalled();
    expect(getBookmarkMocks().remove).not.toHaveBeenCalled();
    expect(getStorageSnapshot()[BOOKMARK_OPERATIONS_KEY]).toBeUndefined();
  });

  it('stores only two folder IDs as sufficient duplicate-conflict evidence', async () => {
    const duplicateFolders = Array.from({ length: 250 }, (_, index) =>
      folder(`duplicate-${index}`, 'Target', []),
    );
    setBookmarkTree(
      tree([
        bookmark('duplicate-evidence-bookmark', 'Move', 'https://example.com/move'),
        ...duplicateFolders,
      ]),
    );

    const response = await executeBookmarkMoves('duplicate-evidence-request', [
      { bookmarkId: 'duplicate-evidence-bookmark', targetFolder: 'Target' },
    ]);
    const item = response.operation.items[0];

    expect(response.operation.status).toBe('failed');
    expect(item?.kind).toBe('move');
    expect(item?.kind === 'move' ? item.folderResolution[0]?.baselineIds : []).toHaveLength(2);
    expect(getBookmarkMocks().create).not.toHaveBeenCalled();
    expect(getBookmarkMocks().move).not.toHaveBeenCalled();
  });

  it('reconciles one uncertain folder creation and stops on multiple candidates', async () => {
    setBookmarkTree(tree([bookmark('bookmark-1', 'Move', 'https://example.com/move')]));
    getBookmarkMocks().create.mockImplementationOnce(
      (details: chrome.bookmarks.CreateDetails, callback?: (result: TreeNode) => void) => {
        appendTreeNode('1', folder('created-uncertain', details.title ?? '', []));
        setRuntimeLastError('Uncertain create');
        callback?.(folder('created-uncertain', details.title ?? '', []));
        setRuntimeLastError(undefined);
      },
    );
    const reconciled = await executeBookmarkMoves('move-create-one', [
      { bookmarkId: 'bookmark-1', targetFolder: 'Created' },
    ]);
    expect(reconciled.operation.status).toBe('complete');
    expect(
      (reconciled.operation.items[0] as { folderResolution: Array<{ status: string }> })
        .folderResolution[0]?.status,
    ).toBe('reconciled');

    setStorageSnapshot({});
    setBookmarkTree(tree([bookmark('bookmark-2', 'Move', 'https://example.com/move-2')]));
    getBookmarkMocks().create.mockImplementationOnce(
      (details: chrome.bookmarks.CreateDetails, callback?: (result: TreeNode) => void) => {
        appendTreeNode('1', folder('created-a', details.title ?? '', []));
        appendTreeNode('1', folder('created-b', details.title ?? '', []));
        setRuntimeLastError('Uncertain create');
        callback?.(folder('', details.title ?? '', []));
        setRuntimeLastError(undefined);
      },
    );
    getBookmarkMocks().move.mockClear();
    const conflict = await executeBookmarkMoves('move-create-many', [
      { bookmarkId: 'bookmark-2', targetFolder: 'Created' },
    ]);
    expect(conflict.operation.items[0]?.executionStatus).toBe('conflict');
    expect(getBookmarkMocks().move).not.toHaveBeenCalled();
  });

  it('fails a zero-candidate uncertain folder create and does not move', async () => {
    setBookmarkTree(tree([bookmark('bookmark-1', 'Move', 'https://example.com/move')]));
    getBookmarkMocks().create.mockImplementationOnce(
      (_details: chrome.bookmarks.CreateDetails, callback?: (result: TreeNode) => void) => {
        setRuntimeLastError('Uncertain create');
        callback?.({ id: '', title: '', syncing: false });
        setRuntimeLastError(undefined);
      },
    );

    const response = await executeBookmarkMoves('move-create-zero', [
      { bookmarkId: 'bookmark-1', targetFolder: 'Created' },
    ]);

    expect(response.operation.status).toBe('failed');
    expect(response.operation.items[0]).toMatchObject({
      executionStatus: 'conflict',
      errorCode: 'target_folder_error',
    });
    expect(getBookmarkMocks().move).not.toHaveBeenCalled();
  });

  it('validates the move source before creating target folders', async () => {
    setBookmarkTree(
      tree([
        bookmark('bookmark-1', 'Move', 'https://example.com/move'),
        folder('third-parent', 'Third', []),
      ]),
    );
    let changed = false;

    const response = await executeBookmarkMoves(
      'move-source-check',
      [{ bookmarkId: 'bookmark-1', targetFolder: 'New/Target' }],
      'classification',
      {
        onChange(operation) {
          if (!changed && operation.status === 'prepared') {
            changed = true;
            const snapshot = getBookmarkTreeSnapshot();
            const source = findTreeNode('bookmark-1', snapshot);
            const target = findTreeNode('third-parent', snapshot)?.node;
            if (!source || !target) {
              throw new Error('missing test fixture');
            }
            source.siblings.splice(source.siblings.indexOf(source.node), 1);
            target.children ??= [];
            source.node.parentId = target.id;
            source.node.index = target.children.length;
            target.children.push(source.node);
            setBookmarkTree(snapshot);
          }
        },
      },
    );

    expect(response.operation.items[0]?.executionStatus).toBe('conflict');
    expect(getBookmarkMocks().create).not.toHaveBeenCalled();
    expect(getBookmarkMocks().move).not.toHaveBeenCalled();
  });

  it('replays move request IDs and rejects a different target payload', async () => {
    setBookmarkTree(tree([bookmark('bookmark-1', 'Move', 'https://example.com/move')]));

    const first = await executeBookmarkMoves('move-idempotent-request', [
      { bookmarkId: 'bookmark-1', targetFolder: 'Target', targetIndex: 0 },
    ]);
    const replay = await executeBookmarkMoves('move-idempotent-request', [
      { targetIndex: 0, targetFolder: 'Target', bookmarkId: 'bookmark-1' },
    ]);

    expect(replay.receipt).toEqual(first.receipt);
    expect(getBookmarkMocks().move).toHaveBeenCalledTimes(1);
    await expect(
      executeBookmarkMoves('move-idempotent-request', [
        { bookmarkId: 'bookmark-1', targetFolder: 'Other', targetIndex: 0 },
      ]),
    ).rejects.toMatchObject({ code: 'request_id_conflict' });
    expect(getBookmarkMocks().move).toHaveBeenCalledTimes(1);
  });

  it('reports move partial and stops later mutations after a conflict', async () => {
    setBookmarkTree(
      tree([
        bookmark('bookmark-a', 'A', 'https://example.com/a'),
        bookmark('bookmark-b', 'B', 'https://example.com/b'),
        bookmark('bookmark-c', 'C', 'https://example.com/c'),
        folder('target-1', 'Target', []),
        folder('third-1', 'Third', []),
      ]),
    );
    let changed = false;
    const response = await executeBookmarkMoves(
      'move-partial-request',
      [
        { bookmarkId: 'bookmark-a', targetFolder: 'Target' },
        { bookmarkId: 'bookmark-b', targetFolder: 'Target' },
        { bookmarkId: 'bookmark-c', targetFolder: 'Target' },
      ],
      'classification',
      {
        onChange(operation) {
          if (!changed && operation.summary.succeeded === 1) {
            changed = true;
            moveTreeNode('bookmark-b', 'third-1');
          }
        },
      },
    );

    expect(response.operation.status).toBe('partial');
    expect(response.operation.items.map((item) => item.executionStatus)).toEqual([
      'succeeded',
      'conflict',
      'skipped',
    ]);
    expect(response.operation.items[2]?.errorCode).toBe('conflict_stopped');
    expect(getBookmarkMocks().move).toHaveBeenCalledTimes(1);
  });

  it('records targetParentId and inverse snapshot before invoking move', async () => {
    setBookmarkTree(
      tree([
        bookmark('bookmark-1', 'Move', 'https://example.com/move'),
        folder('target-1', 'Target', []),
      ]),
    );
    getBookmarkMocks().move.mockImplementationOnce(
      (
        id: string,
        destination: chrome.bookmarks.MoveDestination,
        callback?: (result: TreeNode) => void,
      ) => {
        const item = storedJournal().operations[0]?.items[0];
        expect(item).toMatchObject({
          kind: 'move',
          original: {
            parentId: '1',
            index: 0,
            url: 'https://example.com/move',
          },
          targetParentId: 'target-1',
          executionStatus: 'pending',
          executionAttemptCount: 1,
        });
        callback?.(moveTreeNode(id, destination.parentId ?? '', destination.index));
      },
    );

    const response = await executeBookmarkMoves('move-evidence-request', [
      { bookmarkId: 'bookmark-1', targetFolder: 'Target' },
    ]);

    expect(response.operation.status).toBe('complete');
  });

  it('classifies an external no-attempt move to target as already_target', async () => {
    setBookmarkTree(
      tree([
        bookmark('bookmark-1', 'Move', 'https://example.com/move'),
        folder('target-1', 'Target', []),
      ]),
    );
    let movedExternally = false;
    const response = await executeBookmarkMoves(
      'move-already-target',
      [{ bookmarkId: 'bookmark-1', targetFolder: 'Target' }],
      'classification',
      {
        onChange(operation) {
          if (!movedExternally && operation.status === 'prepared') {
            movedExternally = true;
            moveTreeNode('bookmark-1', 'target-1');
          }
        },
      },
    );

    expect(response.operation.items[0]).toMatchObject({
      executionStatus: 'skipped',
      executionAttemptCount: 0,
      errorCode: 'already_target',
      restoreStatus: 'not_needed',
    });
    expect(getBookmarkMocks().move).not.toHaveBeenCalled();
  });

  it('reconciles an interrupted move outcome without moving twice', async () => {
    setBookmarkTree(
      tree([
        bookmark('bookmark-1', 'Move', 'https://example.com/move'),
        folder('target-1', 'Target', []),
      ]),
    );
    let failedOutcomeWrite = false;
    getStorageMocks().set.mockImplementation(
      (items: Record<string, unknown>, callback?: () => void) => {
        const envelope = items[BOOKMARK_OPERATIONS_KEY] as
          | BookmarkOperationJournalEnvelope
          | undefined;
        const item = envelope?.operations[0]?.items[0];
        if (!failedOutcomeWrite && item?.executionStatus === 'succeeded') {
          failedOutcomeWrite = true;
          setRuntimeLastError('QUOTA_BYTES exceeded');
          callback?.();
          setRuntimeLastError(undefined);
          return;
        }
        setStorageSnapshot({
          ...getStorageSnapshot(),
          ...structuredClone(items),
        });
        callback?.();
      },
    );

    await expect(
      executeBookmarkMoves('move-breakpoint-request', [
        { bookmarkId: 'bookmark-1', targetFolder: 'Target' },
      ]),
    ).rejects.toMatchObject({ code: 'storage_write_failed' });
    expect(storedJournal().operations[0]?.items[0]).toMatchObject({
      executionStatus: 'pending',
      executionAttemptCount: 1,
      targetParentId: 'target-1',
    });

    installSuccessfulStorageSet();
    await Promise.resolve();
    const operations = await reconcileInterruptedBookmarkOperations([]);
    expect(operations[0]?.items[0]?.executionStatus).toBe('succeeded');
    expect(getBookmarkMocks().move).toHaveBeenCalledTimes(1);
  });

  it('restores same-parent moves in ascending original index and verifies exact order', async () => {
    setBookmarkTree(
      tree([
        bookmark('bookmark-a', 'A', 'https://example.com/a'),
        bookmark('bookmark-b', 'B', 'https://example.com/b'),
        folder('target-1', 'Target', []),
      ]),
    );
    const executed = await executeBookmarkMoves('move-order-execute', [
      { bookmarkId: 'bookmark-a', targetFolder: 'Target' },
      { bookmarkId: 'bookmark-b', targetFolder: 'Target' },
    ]);
    getBookmarkMocks().move.mockClear();

    const restored = await restoreBookmarkOperation('move-order-restore', executed.operation.id);

    expect(restored.operation.status).toBe('restored');
    expect(getBookmarkMocks().move.mock.calls.map((call) => call[0])).toEqual([
      'bookmark-a',
      'bookmark-b',
    ]);
    expect(
      findTreeNode('1')
        ?.node.children?.slice(0, 2)
        .map((node) => node.id),
    ).toEqual(['bookmark-a', 'bookmark-b']);
  });

  it('persists a final move-order drift as restore conflict instead of corrupting the journal', async () => {
    setBookmarkTree(
      tree([
        bookmark('bookmark-a', 'A', 'https://example.com/a'),
        folder('target-1', 'Target', []),
        folder('holding-1', 'Holding', [
          bookmark('drifter-1', 'Drifter', 'https://example.com/drifter'),
        ]),
      ]),
    );
    const executed = await executeBookmarkMoves('move-drift-execute', [
      { bookmarkId: 'bookmark-a', targetFolder: 'Target' },
    ]);
    let drifted = false;

    const restored = await restoreBookmarkOperation('move-drift-restore', executed.operation.id, {
      onChange(operation) {
        if (
          !drifted &&
          operation.status === 'restoring' &&
          operation.items[0]?.restoreStatus === 'restored'
        ) {
          drifted = true;
          moveTreeNode('drifter-1', '1', 0);
        }
      },
    });

    expect(restored.operation.status).toBe('restore_partial');
    expect(restored.operation.items[0]).toMatchObject({
      restoreStatus: 'conflict',
      restoreErrorCode: 'restore_conflict',
    });
    expect(restored.receipt.status).toBe('succeeded');
    expect(restored.operation.commands.some((command) => command.status === 'pending')).toBe(false);
  });

  it('marks a no-attempt manual move-back as conflict instead of restored', async () => {
    setBookmarkTree(
      tree([
        bookmark('bookmark-1', 'Move', 'https://example.com/move'),
        folder('target-1', 'Target', []),
      ]),
    );
    const executed = await executeBookmarkMoves('move-manual-execute', [
      { bookmarkId: 'bookmark-1', targetFolder: 'Target' },
    ]);
    await new Promise<void>((resolve) => {
      getBookmarkMocks().move('bookmark-1', { parentId: '1', index: 0 }, () => resolve());
    });
    getBookmarkMocks().move.mockClear();

    const restored = await restoreBookmarkOperation('move-manual-restore', executed.operation.id);

    expect(restored.operation.status).toBe('restore_partial');
    expect(restored.operation.items[0]).toMatchObject({
      restoreStatus: 'conflict',
      restoreAttemptCount: 0,
    });
    expect(getBookmarkMocks().move).not.toHaveBeenCalled();
  });

  it('uses parent-scoped delete baselines and conflicts on an unattributed duplicate', async () => {
    setBookmarkTree(
      tree([
        bookmark('bookmark-1', 'Same', 'https://example.com/same'),
        bookmark('bookmark-2', 'Same', 'https://example.com/same'),
      ]),
    );
    const executed = await executeDeleteBookmarks('delete-duplicate-execute', ['bookmark-1']);
    appendTreeNode('1', bookmark('manual-restore', 'Same', 'https://example.com/same'));
    getBookmarkMocks().create.mockClear();

    const restored = await restoreBookmarkOperation(
      'delete-duplicate-restore',
      executed.operation.id,
    );

    expect(restored.operation.status).toBe('restore_partial');
    expect(restored.operation.items[0]?.restoreStatus).toBe('conflict');
    expect(getBookmarkMocks().create).not.toHaveBeenCalled();
  });

  it('restores two intentionally deleted duplicates with operation-attributed IDs', async () => {
    setBookmarkTree(
      tree([
        bookmark('bookmark-1', 'Same', 'https://example.com/same'),
        bookmark('bookmark-2', 'Same', 'https://example.com/same'),
      ]),
    );
    const executed = await executeDeleteBookmarks('delete-both-duplicates', [
      'bookmark-1',
      'bookmark-2',
    ]);

    const restored = await restoreBookmarkOperation(
      'restore-both-duplicates',
      executed.operation.id,
    );

    expect(restored.operation.status).toBe('restored');
    expect(restored.operation.items.map((item) => item.restoreStatus)).toEqual([
      'restored',
      'restored',
    ]);
    expect(
      new Set(
        restored.operation.items.map((item) =>
          item.kind === 'delete' ? item.restoredBookmarkId : undefined,
        ),
      ).size,
    ).toBe(2);
  });

  it('creates a visible recovery folder when the original parent is gone', async () => {
    setBookmarkTree(
      tree([
        folder('original-parent', 'Original', [
          bookmark('bookmark-a', 'A', 'https://example.com/a'),
          bookmark('bookmark-b', 'B', 'https://example.com/b'),
          bookmark('bookmark-1', 'Recover', 'https://example.com/recover'),
        ]),
      ]),
    );
    const executed = await executeDeleteBookmarks('delete-recovery-execute', ['bookmark-1']);
    removeTreeNode('original-parent');

    const restored = await restoreBookmarkOperation(
      'delete-recovery-restore',
      executed.operation.id,
    );

    expect(restored.operation.status).toBe('restored');
    expect(restored.operation.items[0]).toMatchObject({
      original: { index: 2 },
      restoreStatus: 'restored',
    });
    expect(restored.operation.recoveryFolder).toMatchObject({
      title: 'ShuHai Recovery',
      status: 'created',
    });
    expect(getBookmarkMocks().create).toHaveBeenCalledTimes(2);
    expect(getBookmarkMocks().remove).toHaveBeenCalledTimes(1);
  });

  it('does not use Recovery when reading the existing original parent fails', async () => {
    setBookmarkTree(
      tree([
        folder('original-parent', 'Original', [
          bookmark('bookmark-1', 'Recover', 'https://example.com/recover'),
        ]),
      ]),
    );
    const executed = await executeDeleteBookmarks('delete-parent-read-execute', ['bookmark-1']);
    getBookmarkMocks().create.mockClear();
    getBookmarkMocks().get.mockImplementationOnce(
      (_idOrIds: string | string[], callback: (results: TreeNode[]) => void) => {
        setRuntimeLastError('Temporary bookmark read failure');
        callback([]);
        setRuntimeLastError(undefined);
      },
    );

    const restored = await restoreBookmarkOperation(
      'delete-parent-read-restore',
      executed.operation.id,
    );

    expect(restored.operation.status).toBe('restore_partial');
    expect(restored.operation.items[0]).toMatchObject({
      restoreStatus: 'conflict',
      restoreErrorCode: 'state_read_failed',
    });
    expect(restored.operation.recoveryFolder).toBeUndefined();
    expect(getBookmarkMocks().create).not.toHaveBeenCalled();
  });

  it('rejects over-limit batches before any Chrome or storage side effect', async () => {
    const ids = Array.from({ length: 251 }, (_, index) => `bookmark-${index}`);

    await expect(executeDeleteBookmarks('delete-over-limit', ids)).rejects.toEqual(
      expect.objectContaining<Partial<BookmarkOperationCommandError>>({
        code: 'invalid_request',
      }),
    );
    expect(getBookmarkMocks().get).not.toHaveBeenCalled();
    expect(getStorageMocks().set).not.toHaveBeenCalled();
  });

  it('keeps all 64 receipts and rejects the next command', async () => {
    setBookmarkTree(tree([bookmark('bookmark-1', 'URL', 'https://example.com/old')]));
    const executed = await executeBookmarkUrlUpdates(
      'command-limit-execute',
      [{ id: 'bookmark-1', url: 'https://example.com/new' }],
      'manual',
    );
    for (let index = 0; index < 63; index += 1) {
      const response = await cancelBookmarkOperation(
        `command-limit-${index}`,
        executed.operation.id,
      );
      expect(response.receipt.status).toBe('failed');
    }
    const before = storedJournal().operations[0];
    expect(before?.commands).toHaveLength(64);

    await expect(
      cancelBookmarkOperation('command-limit-overflow', executed.operation.id),
    ).rejects.toMatchObject({ code: 'command_limit_exceeded' });
    expect(storedJournal().operations[0]?.commands).toHaveLength(64);
  });

  it('handles 101 successful items and preserves two concurrent operations', async () => {
    const bookmarks = Array.from({ length: 103 }, (_, index) =>
      bookmark(`bookmark-${index}`, `Bookmark ${index}`, `https://example.com/${index}/old`),
    );
    setBookmarkTree(tree(bookmarks));
    const large = executeBookmarkUrlUpdates(
      'url-large-request',
      Array.from({ length: 101 }, (_, index) => ({
        id: `bookmark-${index}`,
        url: `https://example.com/${index}/new`,
      })),
      'manual',
    );
    const concurrent = executeBookmarkUrlUpdates(
      'url-concurrent-request',
      [
        {
          id: 'bookmark-101',
          url: 'https://example.com/101/new',
        },
        {
          id: 'bookmark-102',
          url: 'https://example.com/102/new',
        },
      ],
      'manual',
    );

    const [largeResponse, concurrentResponse] = await Promise.all([large, concurrent]);
    expect(largeResponse.operation).toMatchObject({
      status: 'complete',
      summary: { succeeded: 101 },
    });
    expect(concurrentResponse.operation).toMatchObject({
      status: 'complete',
      summary: { succeeded: 2 },
    });
    expect(storedJournal().operations).toHaveLength(2);
    expect(
      storedJournal().operations.flatMap((operation) =>
        operation.commands.map((command) => command.requestId),
      ),
    ).toEqual(expect.arrayContaining(['url-large-request', 'url-concurrent-request']));
  }, 10_000);
});
