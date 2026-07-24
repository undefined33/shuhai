import type {
  BookmarkFolderResolutionRecord,
  BookmarkMoveRequestItem,
  BookmarkNode,
  BookmarkOperation,
  BookmarkOperationCommandAction,
  BookmarkOperationCommandRecord,
  BookmarkOperationCommandResponse,
  BookmarkOperationErrorCode,
  BookmarkOperationItem,
  BookmarkOperationSource,
  BookmarkOperationStatus,
  BookmarkSnapshot,
  BookmarkUrlUpdateRequestItem,
  DeleteBookmarkOperationItem,
  MoveBookmarkOperationItem,
  UpdateBookmarkUrlOperationItem,
} from '../shared/bookmark-types.js';
import {
  BOOKMARK_OPERATION_COMMAND_LIMIT,
  BOOKMARK_OPERATION_FOLDER_CONFLICT_EVIDENCE_LIMIT,
  BOOKMARK_OPERATION_LIMITS,
  BOOKMARK_OPERATION_SCHEMA_VERSION,
  bookmarkOperationItemNeedsRestore,
  createBookmarkCommandPayloadIdentity,
  createBookmarkExecutionPayloadIdentity,
  normalizeBookmarkOperationUrl,
  normalizeBookmarkTargetPath,
  parseBookmarkOperationCommand,
  parseBookmarkOperationCommandResponse,
  summarizeBookmarkOperationItems,
} from '../shared/bookmark-types.js';
import {
  createBookmark,
  createFolder,
  flattenBookmarkTree,
  getBookmarkById,
  getBookmarkChildren,
  getFullTree,
  moveBookmark,
  removeBookmark,
  updateBookmarkUrl,
} from './chrome-bookmarks.js';
import {
  getBookmarkOperation,
  getBookmarkOperationByRequestId,
  getBookmarkOperationReserveBytes,
  getBookmarkOperations,
  insertBookmarkOperation,
  updateBookmarkOperation,
} from './storage.js';

const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]+$/u;
const RECOVERY_FOLDER_TITLE = 'ShuHai Recovery';

export interface BookmarkOperationRunOptions {
  now?: () => Date;
  operationIdFactory?: () => string;
  onChange?: (operation: BookmarkOperation) => void;
}

export class BookmarkOperationCommandError extends Error {
  constructor(readonly code: BookmarkOperationErrorCode) {
    super(code);
    this.name = 'BookmarkOperationCommandError';
  }
}

interface ActiveRun {
  operationId: string;
  requestId: string;
  action: 'execute' | 'restore';
  operation: BookmarkOperation;
  abortController: AbortController;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
  options?: BookmarkOperationRunOptions;
}

interface CommandGateResponse {
  response?: BookmarkOperationCommandResponse;
  waitFor?: Promise<void>;
  operationId?: string;
  requestId?: string;
}

type ExecutionResult = 'continue' | 'stop';
type MutationAdmission<T> =
  | { status: 'cancelled' }
  | { status: 'attempt_rejected' }
  | { status: 'started'; completion: Promise<T> };

const activeRuns = new Map<string, ActiveRun>();
let coordinatorTail: Promise<void> = Promise.resolve();
let primaryRunTail: Promise<void> = Promise.resolve();
let mutationAdmissionTail: Promise<void> = Promise.resolve();

function withCoordinator<T>(callback: () => Promise<T>): Promise<T> {
  const result = coordinatorTail.then(callback, callback);
  coordinatorTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function withMutationAdmission<T>(callback: () => Promise<T>): Promise<T> {
  const result = mutationAdmissionTail.then(callback, callback);
  mutationAdmissionTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function nowIso(options?: BookmarkOperationRunOptions): string {
  return (options?.now?.() ?? new Date()).toISOString();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function syncOperation(target: BookmarkOperation, source: BookmarkOperation): void {
  Object.assign(target, clone(source));
}

function operationId(options?: BookmarkOperationRunOptions): string {
  return options?.operationIdFactory?.() ?? `bookmark-op:${crypto.randomUUID()}`;
}

function pendingReceipt(
  requestId: string,
  action: BookmarkOperationCommandAction,
  payloadIdentity: string,
  timestamp: string,
): BookmarkOperationCommandRecord {
  return {
    requestId,
    action,
    payloadIdentity,
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function finishReceipt(
  operation: BookmarkOperation,
  requestId: string,
  status: 'succeeded' | 'failed',
  timestamp: string,
  errorCode?: BookmarkOperationErrorCode,
): void {
  const receipt = operation.commands.find((command) => command.requestId === requestId);
  if (!receipt || receipt.status !== 'pending') {
    throw new BookmarkOperationCommandError('invalid_operation_state');
  }
  receipt.status = status;
  receipt.updatedAt = timestamp;
  receipt.result = {
    ok: status === 'succeeded',
    operationStatus: operation.status,
    summary: clone(operation.summary),
    completedAt: timestamp,
    ...(errorCode ? { errorCode } : {}),
  };
}

function finishPendingCancelReceipts(operation: BookmarkOperation, timestamp: string): void {
  for (const receipt of operation.commands) {
    if (receipt.action === 'cancel' && receipt.status === 'pending') {
      finishReceipt(operation, receipt.requestId, 'succeeded', timestamp);
    }
  }
}

async function persistOperationReference(
  operation: BookmarkOperation,
  options: BookmarkOperationRunOptions | undefined,
  mutate: (draft: BookmarkOperation, timestamp: string) => void,
  afterSummary?: (draft: BookmarkOperation, timestamp: string) => void,
): Promise<BookmarkOperation> {
  const timestamp = nowIso(options);
  const written = await updateBookmarkOperation(operation.id, (draft) => {
    mutate(draft, timestamp);
    draft.summary = summarizeBookmarkOperationItems(draft.items);
    draft.updatedAt = timestamp;
    afterSummary?.(draft, timestamp);
  });
  syncOperation(operation, written.operation);
  options?.onChange?.(clone(operation));
  return operation;
}

function terminalResponse(
  operation: BookmarkOperation,
  requestId: string,
): BookmarkOperationCommandResponse {
  const receipt = operation.commands.find((command) => command.requestId === requestId);
  if (!receipt || receipt.status === 'pending' || !receipt.result) {
    throw new BookmarkOperationCommandError('invalid_operation_state');
  }
  return parseBookmarkOperationCommandResponse({
    receipt,
    operation,
  });
}

async function loadTerminalResponse(
  operationIdValue: string,
  requestId: string,
): Promise<BookmarkOperationCommandResponse> {
  const operation = await getBookmarkOperation(operationIdValue);
  if (!operation) {
    throw new BookmarkOperationCommandError('operation_not_found');
  }
  return terminalResponse(operation, requestId);
}

function parseSource(source: BookmarkOperationSource): BookmarkOperationSource {
  if (source !== 'health' && source !== 'classification' && source !== 'manual') {
    throw new BookmarkOperationCommandError('invalid_request');
  }
  return source;
}

function parseDeleteRequest(requestId: string, bookmarkIds: readonly string[]) {
  try {
    return parseBookmarkOperationCommand({
      type: 'bookmarkOperations:delete',
      requestId,
      bookmarkIds,
    });
  } catch {
    throw new BookmarkOperationCommandError('invalid_request');
  }
}

function parseUpdateRequest(requestId: string, updates: readonly BookmarkUrlUpdateRequestItem[]) {
  try {
    return parseBookmarkOperationCommand({
      type: 'bookmarkOperations:updateUrls',
      requestId,
      updates,
    });
  } catch {
    throw new BookmarkOperationCommandError('invalid_request');
  }
}

function parseMoveRequest(requestId: string, moves: readonly BookmarkMoveRequestItem[]) {
  try {
    return parseBookmarkOperationCommand({
      type: 'bookmarkOperations:move',
      requestId,
      moves,
    });
  } catch {
    throw new BookmarkOperationCommandError('invalid_request');
  }
}

function parseOperationCommandRequest(
  type:
    | 'bookmarkOperations:restore'
    | 'bookmarkOperations:acceptCurrent'
    | 'bookmarkOperations:cancel',
  requestId: string,
  operationIdValue: string,
): { requestId: string; operationId: string } {
  try {
    const parsed = parseBookmarkOperationCommand({
      type,
      requestId,
      operationId: operationIdValue,
    });
    if (parsed.type !== type || !('operationId' in parsed)) {
      throw new Error('invalid command');
    }
    return {
      requestId: parsed.requestId,
      operationId: parsed.operationId,
    };
  } catch {
    throw new BookmarkOperationCommandError('invalid_request');
  }
}

function safeTitle(node: BookmarkNode | undefined): string {
  return node && node.title.length <= BOOKMARK_OPERATION_LIMITS.title ? node.title : '';
}

function snapshotFromNode(node: BookmarkNode | undefined): BookmarkSnapshot | undefined {
  if (
    !node?.url ||
    !node.parentId ||
    !SAFE_ID_PATTERN.test(node.parentId) ||
    node.parentId.length > BOOKMARK_OPERATION_LIMITS.bookmarkId ||
    !Number.isInteger(node.index) ||
    (node.index ?? -1) < 0 ||
    node.title.length > BOOKMARK_OPERATION_LIMITS.title
  ) {
    return undefined;
  }
  try {
    return {
      title: node.title,
      url: normalizeBookmarkOperationUrl(node.url),
      parentId: node.parentId,
      index: node.index as number,
    };
  } catch {
    return undefined;
  }
}

function itemBase(
  bookmarkId: string,
  title: string,
  _timestamp: string,
): Pick<
  BookmarkOperationItem,
  | 'bookmarkId'
  | 'title'
  | 'executionStatus'
  | 'restoreStatus'
  | 'executionAttemptCount'
  | 'restoreAttemptCount'
> {
  return {
    bookmarkId,
    title,
    executionStatus: 'pending',
    restoreStatus: 'not_needed',
    executionAttemptCount: 0,
    restoreAttemptCount: 0,
  };
}

function failPreparedItem(
  item: BookmarkOperationItem,
  errorCode: BookmarkOperationErrorCode,
  timestamp: string,
): void {
  item.executionStatus = 'failed';
  item.errorCode = errorCode;
  item.executionCompletedAt = timestamp;
}

async function prepareDeleteItems(
  bookmarkIds: readonly string[],
  timestamp: string,
): Promise<DeleteBookmarkOperationItem[]> {
  const items: DeleteBookmarkOperationItem[] = [];
  for (const bookmarkId of bookmarkIds) {
    let node: BookmarkNode | undefined;
    try {
      node = await getBookmarkById(bookmarkId);
    } catch {
      const item: DeleteBookmarkOperationItem = {
        ...itemBase(bookmarkId, '', timestamp),
        kind: 'delete',
      };
      failPreparedItem(item, 'state_read_failed', timestamp);
      items.push(item);
      continue;
    }

    const item: DeleteBookmarkOperationItem = {
      ...itemBase(bookmarkId, safeTitle(node), timestamp),
      kind: 'delete',
    };
    if (!node) {
      failPreparedItem(item, 'bookmark_not_found', timestamp);
      items.push(item);
      continue;
    }
    if (!node.url) {
      failPreparedItem(item, 'not_a_bookmark', timestamp);
      items.push(item);
      continue;
    }
    const original = snapshotFromNode(node);
    if (!original) {
      failPreparedItem(item, 'invalid_bookmark_data', timestamp);
      items.push(item);
      continue;
    }

    try {
      const siblings = await getBookmarkChildren(original.parentId);
      const baselineIds = siblings
        .filter(
          (candidate) =>
            candidate.title === original.title &&
            candidate.url !== undefined &&
            normalizeBookmarkOperationUrl(candidate.url) === original.url,
        )
        .map((candidate) => candidate.id);
      if (
        baselineIds.length > BOOKMARK_OPERATION_LIMITS.duplicateBaselineIds ||
        baselineIds.some(
          (id) => id.length > BOOKMARK_OPERATION_LIMITS.bookmarkId || !SAFE_ID_PATTERN.test(id),
        )
      ) {
        item.original = original;
        failPreparedItem(item, 'duplicate_ambiguous', timestamp);
        items.push(item);
        continue;
      }
      item.original = original;
      item.matchingCountBefore = baselineIds.length;
      item.restoreBaselineBookmarkIds = baselineIds;
    } catch {
      item.original = original;
      failPreparedItem(item, 'state_read_failed', timestamp);
    }
    items.push(item);
  }
  return items;
}

async function prepareUpdateItems(
  updates: readonly BookmarkUrlUpdateRequestItem[],
  timestamp: string,
): Promise<UpdateBookmarkUrlOperationItem[]> {
  const items: UpdateBookmarkUrlOperationItem[] = [];
  for (const update of updates) {
    let node: BookmarkNode | undefined;
    try {
      node = await getBookmarkById(update.id);
    } catch {
      const item: UpdateBookmarkUrlOperationItem = {
        ...itemBase(update.id, '', timestamp),
        kind: 'update_url',
        newUrl: update.url,
      };
      failPreparedItem(item, 'state_read_failed', timestamp);
      items.push(item);
      continue;
    }
    const item: UpdateBookmarkUrlOperationItem = {
      ...itemBase(update.id, safeTitle(node), timestamp),
      kind: 'update_url',
      newUrl: update.url,
    };
    if (!node) {
      failPreparedItem(item, 'bookmark_not_found', timestamp);
    } else if (!node.url) {
      failPreparedItem(item, 'not_a_bookmark', timestamp);
    } else {
      const original = snapshotFromNode(node);
      if (!original) {
        failPreparedItem(item, 'invalid_bookmark_data', timestamp);
      } else {
        item.original = original;
        item.oldUrl = original.url;
      }
    }
    items.push(item);
  }
  return items;
}

async function prepareMoveItems(
  moves: readonly BookmarkMoveRequestItem[],
  timestamp: string,
): Promise<MoveBookmarkOperationItem[]> {
  const items: MoveBookmarkOperationItem[] = [];
  for (const move of moves) {
    let node: BookmarkNode | undefined;
    try {
      node = await getBookmarkById(move.bookmarkId);
    } catch {
      const item: MoveBookmarkOperationItem = {
        ...itemBase(move.bookmarkId, '', timestamp),
        kind: 'move',
        targetFolder: move.targetFolder,
        ...(move.targetIndex === undefined ? {} : { requestedTargetIndex: move.targetIndex }),
        targetStatus: 'pending',
        folderResolution: [],
      };
      failPreparedItem(item, 'state_read_failed', timestamp);
      items.push(item);
      continue;
    }
    const item: MoveBookmarkOperationItem = {
      ...itemBase(move.bookmarkId, safeTitle(node), timestamp),
      kind: 'move',
      targetFolder: move.targetFolder,
      ...(move.targetIndex === undefined ? {} : { requestedTargetIndex: move.targetIndex }),
      targetStatus: 'pending',
      folderResolution: [],
    };
    if (!node) {
      failPreparedItem(item, 'bookmark_not_found', timestamp);
    } else if (!node.url) {
      failPreparedItem(item, 'not_a_bookmark', timestamp);
    } else {
      const original = snapshotFromNode(node);
      if (!original) {
        failPreparedItem(item, 'invalid_bookmark_data', timestamp);
      } else {
        item.original = original;
      }
    }
    items.push(item);
  }
  return items;
}

function createPreparedOperation(
  requestId: string,
  payloadIdentity: string,
  type: BookmarkOperation['type'],
  source: BookmarkOperationSource,
  items: BookmarkOperationItem[],
  timestamp: string,
  options?: BookmarkOperationRunOptions,
): BookmarkOperation {
  const operation: BookmarkOperation = {
    id: operationId(options),
    requestId,
    payloadIdentity,
    version: BOOKMARK_OPERATION_SCHEMA_VERSION,
    type,
    status: 'prepared',
    source,
    createdAt: timestamp,
    updatedAt: timestamp,
    requestedCount: items.length,
    items,
    summary: summarizeBookmarkOperationItems(items),
    commands: [pendingReceipt(requestId, 'execute', payloadIdentity, timestamp)],
  };
  return operation;
}

function createActiveRun(
  operation: BookmarkOperation,
  requestId: string,
  action: 'execute' | 'restore',
  options?: BookmarkOperationRunOptions,
): ActiveRun {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    operationId: operation.id,
    requestId,
    action,
    operation,
    abortController: new AbortController(),
    promise,
    resolve,
    reject,
    options,
  };
}

function startActiveRun(active: ActiveRun, runner: (active: ActiveRun) => Promise<void>): void {
  activeRuns.set(active.operationId, active);
  const running = primaryRunTail.then(
    () => runner(active),
    () => runner(active),
  );
  primaryRunTail = running.then(
    () => undefined,
    () => undefined,
  );
  void running.then(active.resolve, active.reject).finally(() => {
    if (activeRuns.get(active.operationId) === active) {
      activeRuns.delete(active.operationId);
    }
  });
}

function isNodeIdentity(node: BookmarkNode | undefined, snapshot: BookmarkSnapshot): boolean {
  if (!node?.url || node.title !== snapshot.title) {
    return false;
  }
  try {
    return normalizeBookmarkOperationUrl(node.url) === snapshot.url;
  } catch {
    return false;
  }
}

function isNodeAtSource(node: BookmarkNode | undefined, snapshot: BookmarkSnapshot): boolean {
  return isNodeIdentity(node, snapshot) && node?.parentId === snapshot.parentId;
}

function isFolderNode(node: BookmarkNode | undefined, parentId: string, title: string): boolean {
  return Boolean(node && !node.url && node.parentId === parentId && node.title === title);
}

async function readNode(id: string): Promise<BookmarkNode | undefined> {
  return getBookmarkById(id);
}

function getItem<T extends BookmarkOperationItem['kind']>(
  operation: BookmarkOperation,
  index: number,
  kind: T,
): Extract<BookmarkOperationItem, { kind: T }> {
  const item = operation.items[index];
  if (!item || item.kind !== kind) {
    throw new BookmarkOperationCommandError('invalid_operation_state');
  }
  return item as Extract<BookmarkOperationItem, { kind: T }>;
}

function setExecutionAttempt(item: BookmarkOperationItem, timestamp: string): boolean {
  if (item.executionAttemptCount >= BOOKMARK_OPERATION_LIMITS.attemptCount) {
    return false;
  }
  item.executionAttemptCount += 1;
  item.executionAttemptedAt = timestamp;
  item.executionCompletedAt = undefined;
  item.errorCode = undefined;
  return true;
}

function finishExecution(
  item: BookmarkOperationItem,
  status: Exclude<BookmarkOperationItem['executionStatus'], 'pending'>,
  timestamp: string,
  errorCode?: BookmarkOperationErrorCode,
): void {
  item.executionStatus = status;
  item.executionCompletedAt = timestamp;
  item.errorCode = errorCode;
  if (status === 'succeeded') {
    item.restoreStatus = 'pending';
    item.restoreErrorCode = undefined;
    item.restoreCompletedAt = undefined;
  } else {
    item.restoreStatus = 'not_needed';
  }
}

function setRestoreAttempt(item: BookmarkOperationItem, timestamp: string): boolean {
  if (item.restoreAttemptCount >= BOOKMARK_OPERATION_LIMITS.attemptCount) {
    return false;
  }
  item.restoreAttemptCount += 1;
  item.restoreAttemptedAt = timestamp;
  item.restoreStatus = 'pending';
  item.restoreCompletedAt = undefined;
  item.restoreErrorCode = undefined;
  return true;
}

function finishRestore(
  item: BookmarkOperationItem,
  status: 'restored' | 'restore_failed' | 'conflict',
  timestamp: string,
  errorCode?: BookmarkOperationErrorCode,
): void {
  item.restoreStatus = status;
  item.restoreCompletedAt = timestamp;
  item.restoreErrorCode = errorCode;
}

function executionTerminalStatus(operation: BookmarkOperation): BookmarkOperationStatus {
  const succeeded = operation.items.filter((item) => item.executionStatus === 'succeeded').length;
  const problems = operation.items.filter(
    (item) =>
      item.executionStatus === 'failed' ||
      item.executionStatus === 'conflict' ||
      (item.executionStatus === 'skipped' && item.errorCode !== 'already_target'),
  ).length;
  const cancelled = operation.items.some((item) => item.errorCode === 'operation_cancelled');
  if (succeeded === 0 && cancelled) {
    return 'cancelled';
  }
  if (succeeded === 0 && problems > 0) {
    return 'failed';
  }
  if (problems > 0) {
    return 'partial';
  }
  return 'complete';
}

function restoreTerminalStatus(operation: BookmarkOperation): BookmarkOperationStatus {
  const successfulItems = operation.items.filter((item) => item.executionStatus === 'succeeded');
  if (
    successfulItems.length > 0 &&
    successfulItems.every((item) => item.restoreStatus === 'restored')
  ) {
    return 'restored';
  }
  if (
    successfulItems.length > 0 &&
    successfulItems.every(
      (item) => item.restoreStatus === 'restored' || item.restoreStatus === 'accepted_current',
    ) &&
    successfulItems.some((item) => item.restoreStatus === 'accepted_current')
  ) {
    return 'resolved';
  }
  return 'restore_partial';
}

function cancellationRequested(active: ActiveRun): boolean {
  return (
    active.abortController.signal.aborted ||
    active.operation.commands.some(
      (command) => command.action === 'cancel' && command.status === 'pending',
    )
  );
}

function beginMutation<T>(
  active: ActiveRun,
  persistAttempt: () => Promise<boolean>,
  mutate: () => Promise<T>,
): Promise<MutationAdmission<T>> {
  return withMutationAdmission(async () => {
    if (cancellationRequested(active)) {
      return { status: 'cancelled' };
    }
    if (!(await persistAttempt())) {
      return { status: 'attempt_rejected' };
    }
    return {
      status: 'started',
      completion: mutate(),
    };
  });
}

function markRemainingExecution(
  operation: BookmarkOperation,
  startIndex: number,
  errorCode: 'operation_cancelled' | 'conflict_stopped',
  timestamp: string,
): void {
  for (let index = startIndex; index < operation.items.length; index += 1) {
    const item = operation.items[index];
    if (item?.executionStatus === 'pending') {
      finishExecution(item, 'skipped', timestamp, errorCode);
    }
  }
}

async function defaultRootParentId(): Promise<string> {
  const tree = await getFullTree();
  const rootParentId = flattenBookmarkTree(tree).rootParentId;
  if (
    !rootParentId ||
    rootParentId.length > BOOKMARK_OPERATION_LIMITS.bookmarkId ||
    !SAFE_ID_PATTERN.test(rootParentId)
  ) {
    throw new BookmarkOperationCommandError('target_folder_error');
  }
  return rootParentId;
}

async function sameNameFolderIds(parentId: string, title: string): Promise<string[]> {
  const children = await getBookmarkChildren(parentId);
  return children.filter((node) => !node.url && node.title === title).map((node) => node.id);
}

function folderRecord(
  operation: BookmarkOperation,
  itemIndex: number | undefined,
  path: string,
): BookmarkFolderResolutionRecord | undefined {
  if (itemIndex === undefined) {
    return operation.recoveryFolder?.path === path ? operation.recoveryFolder : undefined;
  }
  const item = getItem(operation, itemIndex, 'move');
  return item.folderResolution.find((record) => record.path === path);
}

function writeFolderRecord(
  operation: BookmarkOperation,
  itemIndex: number | undefined,
  record: BookmarkFolderResolutionRecord,
): void {
  if (itemIndex === undefined) {
    operation.recoveryFolder = record;
    return;
  }
  const item = getItem(operation, itemIndex, 'move');
  const index = item.folderResolution.findIndex((candidate) => candidate.path === record.path);
  if (index === -1) {
    item.folderResolution.push(record);
  } else {
    item.folderResolution[index] = record;
  }
}

async function persistFolderRecord(
  active: ActiveRun,
  itemIndex: number | undefined,
  record: BookmarkFolderResolutionRecord,
): Promise<void> {
  await persistOperationReference(active.operation, active.options, (draft) => {
    writeFolderRecord(draft, itemIndex, clone(record));
  });
}

async function resolveFolderLevel(
  active: ActiveRun,
  itemIndex: number | undefined,
  path: string,
  parentId: string,
  title: string,
): Promise<string> {
  const existingRecord = folderRecord(active.operation, itemIndex, path);
  if (existingRecord && (existingRecord.parentId !== parentId || existingRecord.title !== title)) {
    throw new BookmarkOperationCommandError('target_folder_conflict');
  }
  if (
    existingRecord &&
    (existingRecord.status === 'existing' ||
      existingRecord.status === 'created' ||
      existingRecord.status === 'reconciled')
  ) {
    const node = existingRecord.folderId ? await readNode(existingRecord.folderId) : undefined;
    if (
      existingRecord.folderId &&
      isFolderNode(node, existingRecord.parentId, existingRecord.title)
    ) {
      return existingRecord.folderId;
    }
    throw new BookmarkOperationCommandError('target_folder_conflict');
  }
  if (existingRecord?.status === 'failed' || existingRecord?.status === 'conflict') {
    throw new BookmarkOperationCommandError(existingRecord.errorCode ?? 'target_folder_conflict');
  }

  if (existingRecord?.status === 'attempted') {
    let candidates: string[];
    try {
      const currentIds = await sameNameFolderIds(parentId, title);
      candidates = currentIds.filter((id) => !existingRecord.baselineIds.includes(id));
    } catch {
      const conflict: BookmarkFolderResolutionRecord = {
        ...existingRecord,
        status: 'conflict',
        errorCode: 'state_read_failed',
      };
      await persistFolderRecord(active, itemIndex, conflict);
      throw new BookmarkOperationCommandError('state_read_failed');
    }
    if (candidates.length === 1) {
      const reconciled: BookmarkFolderResolutionRecord = {
        ...existingRecord,
        status: 'reconciled',
        folderId: candidates[0],
      };
      await persistFolderRecord(active, itemIndex, reconciled);
      return candidates[0] as string;
    }
    const status = candidates.length === 0 ? 'failed' : 'conflict';
    const failed: BookmarkFolderResolutionRecord = {
      ...existingRecord,
      status,
      errorCode: candidates.length === 0 ? 'target_folder_error' : 'target_folder_conflict',
    };
    await persistFolderRecord(active, itemIndex, failed);
    throw new BookmarkOperationCommandError(failed.errorCode ?? 'target_folder_error');
  }

  let baselineIds: string[];
  try {
    baselineIds = await sameNameFolderIds(parentId, title);
  } catch {
    throw new BookmarkOperationCommandError('state_read_failed');
  }
  if (baselineIds.length === 1) {
    const existing: BookmarkFolderResolutionRecord = {
      path,
      title,
      parentId,
      baselineIds,
      status: 'existing',
      folderId: baselineIds[0],
      attemptCount: 0,
    };
    await persistFolderRecord(active, itemIndex, existing);
    return baselineIds[0] as string;
  }
  if (baselineIds.length > 1) {
    const conflict: BookmarkFolderResolutionRecord = {
      path,
      title,
      parentId,
      baselineIds: baselineIds.slice(0, BOOKMARK_OPERATION_FOLDER_CONFLICT_EVIDENCE_LIMIT),
      status: 'conflict',
      attemptCount: 0,
      errorCode: 'target_folder_conflict',
    };
    await persistFolderRecord(active, itemIndex, conflict);
    throw new BookmarkOperationCommandError('target_folder_conflict');
  }

  let callbackNode: BookmarkNode | undefined;
  let createThrew = false;
  const timestamp = nowIso(active.options);
  const attempted: BookmarkFolderResolutionRecord = {
    path,
    title,
    parentId,
    baselineIds: [],
    status: 'attempted',
    attemptedAt: timestamp,
    attemptCount: 1,
  };
  const admission = await beginMutation(
    active,
    async () => {
      await persistFolderRecord(active, itemIndex, attempted);
      return true;
    },
    () => createFolder(title, parentId),
  );
  if (admission.status === 'cancelled') {
    throw new BookmarkOperationCommandError('operation_cancelled');
  }
  if (admission.status === 'attempt_rejected') {
    throw new BookmarkOperationCommandError('attempt_limit_exceeded');
  }
  try {
    callbackNode = await admission.completion;
  } catch {
    createThrew = true;
  }

  if (!createThrew && callbackNode) {
    let boundNode: BookmarkNode | undefined;
    try {
      boundNode = await readNode(callbackNode.id);
    } catch {
      boundNode = undefined;
    }
    if (isFolderNode(boundNode, parentId, title)) {
      const created: BookmarkFolderResolutionRecord = {
        ...attempted,
        status: 'created',
        folderId: callbackNode.id,
        callbackId: callbackNode.id,
      };
      await persistFolderRecord(active, itemIndex, created);
      return callbackNode.id;
    }
    const conflict: BookmarkFolderResolutionRecord = {
      ...attempted,
      status: 'conflict',
      errorCode: 'callback_binding_failed',
    };
    await persistFolderRecord(active, itemIndex, conflict);
    throw new BookmarkOperationCommandError('callback_binding_failed');
  }

  let newIds: string[];
  try {
    const currentIds = await sameNameFolderIds(parentId, title);
    newIds = currentIds.filter((id) => !attempted.baselineIds.includes(id));
  } catch {
    const conflict: BookmarkFolderResolutionRecord = {
      ...attempted,
      status: 'conflict',
      errorCode: 'state_read_failed',
    };
    await persistFolderRecord(active, itemIndex, conflict);
    throw new BookmarkOperationCommandError('state_read_failed');
  }
  if (newIds.length === 1) {
    const reconciled: BookmarkFolderResolutionRecord = {
      ...attempted,
      status: 'reconciled',
      folderId: newIds[0],
    };
    await persistFolderRecord(active, itemIndex, reconciled);
    return newIds[0] as string;
  }
  const failed: BookmarkFolderResolutionRecord = {
    ...attempted,
    status: newIds.length === 0 ? 'failed' : 'conflict',
    errorCode: newIds.length === 0 ? 'target_folder_error' : 'target_folder_conflict',
  };
  await persistFolderRecord(active, itemIndex, failed);
  throw new BookmarkOperationCommandError(failed.errorCode ?? 'target_folder_error');
}

async function resolveMoveTargetFolder(active: ActiveRun, itemIndex: number): Promise<string> {
  const item = getItem(active.operation, itemIndex, 'move');
  const segments = normalizeBookmarkTargetPath(item.targetFolder).split('/');
  let parentId = await defaultRootParentId();
  let path = '';
  await persistOperationReference(active.operation, active.options, (draft) => {
    getItem(draft, itemIndex, 'move').targetStatus = 'resolving';
  });
  for (const segment of segments) {
    path = path ? `${path}/${segment}` : segment;
    parentId = await resolveFolderLevel(active, itemIndex, path, parentId, segment);
  }
  await persistOperationReference(active.operation, active.options, (draft) => {
    const draftItem = getItem(draft, itemIndex, 'move');
    draftItem.targetStatus = 'resolved';
    draftItem.targetParentId = parentId;
    draftItem.targetErrorCode = undefined;
  });
  return parentId;
}

async function findExistingFolderPath(targetFolder: string): Promise<string | undefined> {
  const segments = normalizeBookmarkTargetPath(targetFolder).split('/');
  let parentId = await defaultRootParentId();
  for (const segment of segments) {
    const ids = await sameNameFolderIds(parentId, segment);
    if (ids.length === 0) {
      return undefined;
    }
    if (ids.length > 1) {
      throw new BookmarkOperationCommandError('target_folder_conflict');
    }
    parentId = ids[0] as string;
  }
  return parentId;
}

async function finishExecutionItem(
  active: ActiveRun,
  index: number,
  status: Exclude<BookmarkOperationItem['executionStatus'], 'pending'>,
  errorCode?: BookmarkOperationErrorCode,
): Promise<void> {
  await persistOperationReference(active.operation, active.options, (draft, timestamp) => {
    const item = draft.items[index];
    if (!item) {
      throw new BookmarkOperationCommandError('invalid_operation_state');
    }
    finishExecution(item, status, timestamp, errorCode);
  });
}

async function markExecutionAttempt(active: ActiveRun, index: number): Promise<boolean> {
  let allowed = true;
  await persistOperationReference(active.operation, active.options, (draft, timestamp) => {
    const item = draft.items[index];
    if (!item) {
      throw new BookmarkOperationCommandError('invalid_operation_state');
    }
    allowed = setExecutionAttempt(item, timestamp);
    if (!allowed) {
      finishExecution(item, 'conflict', timestamp, 'attempt_limit_exceeded');
    }
  });
  return allowed;
}

async function runDeleteExecution(
  active: ActiveRun,
  index: number,
  allowMutation: boolean,
): Promise<ExecutionResult> {
  const initial = getItem(active.operation, index, 'delete');
  const original = initial.original;
  if (!original) {
    await finishExecutionItem(active, index, 'failed', 'invalid_bookmark_data');
    return 'continue';
  }
  let current: BookmarkNode | undefined;
  try {
    current = await readNode(initial.bookmarkId);
  } catch {
    await finishExecutionItem(active, index, 'conflict', 'state_read_failed');
    return 'stop';
  }

  if (initial.executionAttemptCount > 0) {
    if (!current) {
      await finishExecutionItem(active, index, 'succeeded');
      return 'continue';
    }
    if (isNodeAtSource(current, original)) {
      await finishExecutionItem(active, index, 'failed', 'mutation_failed');
      return 'continue';
    }
    await finishExecutionItem(active, index, 'conflict', 'bookmark_changed');
    return 'stop';
  }
  if (!current) {
    await finishExecutionItem(active, index, 'failed', 'bookmark_not_found');
    return 'continue';
  }
  if (!isNodeAtSource(current, original)) {
    await finishExecutionItem(active, index, 'conflict', 'bookmark_changed');
    return 'stop';
  }
  if (!allowMutation) {
    await finishExecutionItem(active, index, 'failed', 'operation_interrupted');
    return 'continue';
  }
  const admission = await beginMutation(
    active,
    () => markExecutionAttempt(active, index),
    () => removeBookmark(initial.bookmarkId),
  );
  if (admission.status === 'cancelled') {
    await finishExecutionItem(active, index, 'skipped', 'operation_cancelled');
    return 'continue';
  }
  if (admission.status === 'attempt_rejected') {
    return 'stop';
  }
  try {
    await admission.completion;
  } catch {
    // The current Chrome state is authoritative.
  }
  try {
    current = await readNode(initial.bookmarkId);
  } catch {
    await finishExecutionItem(active, index, 'conflict', 'state_read_failed');
    return 'stop';
  }
  if (!current) {
    await finishExecutionItem(active, index, 'succeeded');
    return 'continue';
  }
  if (isNodeAtSource(current, original)) {
    await finishExecutionItem(active, index, 'failed', 'mutation_failed');
    return 'continue';
  }
  await finishExecutionItem(active, index, 'conflict', 'bookmark_changed');
  return 'stop';
}

async function runUpdateExecution(
  active: ActiveRun,
  index: number,
  allowMutation: boolean,
): Promise<ExecutionResult> {
  const initial = getItem(active.operation, index, 'update_url');
  const original = initial.original;
  if (!original || !initial.oldUrl) {
    await finishExecutionItem(active, index, 'failed', 'invalid_bookmark_data');
    return 'continue';
  }
  let current: BookmarkNode | undefined;
  try {
    current = await readNode(initial.bookmarkId);
  } catch {
    await finishExecutionItem(active, index, 'conflict', 'state_read_failed');
    return 'stop';
  }
  let currentUrl: string | undefined;
  try {
    currentUrl = current?.url ? normalizeBookmarkOperationUrl(current.url) : undefined;
  } catch {
    currentUrl = undefined;
  }

  if (initial.executionAttemptCount > 0) {
    if (current && isSameBookmarkExceptUrl(current, original) && currentUrl === initial.newUrl) {
      await finishExecutionItem(active, index, 'succeeded');
      return 'continue';
    }
    if (current && isSameBookmarkExceptUrl(current, original) && currentUrl === initial.oldUrl) {
      await finishExecutionItem(active, index, 'failed', 'mutation_failed');
      return 'continue';
    }
    await finishExecutionItem(active, index, 'conflict', 'bookmark_changed');
    return 'stop';
  }
  if (current && isSameBookmarkExceptUrl(current, original) && currentUrl === initial.newUrl) {
    await finishExecutionItem(active, index, 'skipped', 'already_target');
    return 'continue';
  }
  if (!current || !isSameBookmarkExceptUrl(current, original) || currentUrl !== initial.oldUrl) {
    await finishExecutionItem(active, index, 'conflict', 'bookmark_changed');
    return 'stop';
  }
  if (!allowMutation) {
    await finishExecutionItem(active, index, 'failed', 'operation_interrupted');
    return 'continue';
  }
  const admission = await beginMutation(
    active,
    () => markExecutionAttempt(active, index),
    () => updateBookmarkUrl(initial.bookmarkId, initial.newUrl),
  );
  if (admission.status === 'cancelled') {
    await finishExecutionItem(active, index, 'skipped', 'operation_cancelled');
    return 'continue';
  }
  if (admission.status === 'attempt_rejected') {
    return 'stop';
  }
  try {
    await admission.completion;
  } catch {
    // The current Chrome state is authoritative.
  }
  try {
    current = await readNode(initial.bookmarkId);
    currentUrl = current?.url ? normalizeBookmarkOperationUrl(current.url) : undefined;
  } catch {
    await finishExecutionItem(active, index, 'conflict', 'state_read_failed');
    return 'stop';
  }
  if (current && isSameBookmarkExceptUrl(current, original) && currentUrl === initial.newUrl) {
    await finishExecutionItem(active, index, 'succeeded');
    return 'continue';
  }
  if (current && isSameBookmarkExceptUrl(current, original) && currentUrl === initial.oldUrl) {
    await finishExecutionItem(active, index, 'failed', 'mutation_failed');
    return 'continue';
  }
  await finishExecutionItem(active, index, 'conflict', 'bookmark_changed');
  return 'stop';
}

async function runMoveExecution(
  active: ActiveRun,
  index: number,
  allowMutation: boolean,
): Promise<ExecutionResult> {
  const initial = getItem(active.operation, index, 'move');
  const original = initial.original;
  if (!original) {
    await finishExecutionItem(active, index, 'failed', 'invalid_bookmark_data');
    return 'continue';
  }
  let current: BookmarkNode | undefined;
  try {
    current = await readNode(initial.bookmarkId);
  } catch {
    await finishExecutionItem(active, index, 'conflict', 'state_read_failed');
    return 'stop';
  }

  if (initial.executionAttemptCount > 0) {
    if (
      current &&
      isNodeIdentity(current, original) &&
      current.parentId === initial.targetParentId
    ) {
      await persistOperationReference(active.operation, active.options, (draft, timestamp) => {
        const item = getItem(draft, index, 'move');
        item.actualTargetIndex = current?.index ?? 0;
        finishExecution(item, 'succeeded', timestamp);
      });
      return 'continue';
    }
    if (isNodeAtSource(current, original)) {
      await finishExecutionItem(active, index, 'failed', 'mutation_failed');
      return 'continue';
    }
    await finishExecutionItem(active, index, 'conflict', 'bookmark_changed');
    return 'stop';
  }

  if (!current || !isNodeIdentity(current, original)) {
    await finishExecutionItem(active, index, 'conflict', 'bookmark_changed');
    return 'stop';
  }
  if (current.parentId !== original.parentId) {
    try {
      const existingTarget = await findExistingFolderPath(initial.targetFolder);
      if (existingTarget && current.parentId === existingTarget) {
        await finishExecutionItem(active, index, 'skipped', 'already_target');
        return 'continue';
      }
    } catch {
      await finishExecutionItem(active, index, 'conflict', 'target_folder_conflict');
      return 'stop';
    }
    await finishExecutionItem(active, index, 'conflict', 'bookmark_changed');
    return 'stop';
  }
  if (!allowMutation) {
    await finishExecutionItem(active, index, 'failed', 'operation_interrupted');
    return 'continue';
  }

  let targetParentId: string;
  try {
    targetParentId = await resolveMoveTargetFolder(active, index);
  } catch (error) {
    const code =
      error instanceof BookmarkOperationCommandError ? error.code : 'target_folder_error';
    if (code === 'operation_cancelled') {
      await persistOperationReference(active.operation, active.options, (draft, timestamp) => {
        const item = getItem(draft, index, 'move');
        item.targetStatus = 'failed';
        item.targetErrorCode = code;
        finishExecution(item, 'skipped', timestamp, code);
      });
      return 'continue';
    }
    await persistOperationReference(active.operation, active.options, (draft, timestamp) => {
      const item = getItem(draft, index, 'move');
      item.targetStatus = code === 'target_folder_error' ? 'failed' : 'conflict';
      item.targetErrorCode = code;
      finishExecution(item, 'conflict', timestamp, code);
    });
    return 'stop';
  }
  if (targetParentId === original.parentId) {
    await finishExecutionItem(active, index, 'skipped', 'already_target');
    return 'continue';
  }
  const admission = await beginMutation(
    active,
    () => markExecutionAttempt(active, index),
    () =>
      moveBookmark(initial.bookmarkId, {
        parentId: targetParentId,
        ...(initial.requestedTargetIndex === undefined
          ? {}
          : { index: initial.requestedTargetIndex }),
      }),
  );
  if (admission.status === 'cancelled') {
    await finishExecutionItem(active, index, 'skipped', 'operation_cancelled');
    return 'continue';
  }
  if (admission.status === 'attempt_rejected') {
    return 'stop';
  }
  try {
    await admission.completion;
  } catch {
    // The current Chrome state is authoritative.
  }
  try {
    current = await readNode(initial.bookmarkId);
  } catch {
    await finishExecutionItem(active, index, 'conflict', 'state_read_failed');
    return 'stop';
  }
  if (current && isNodeIdentity(current, original) && current.parentId === targetParentId) {
    await persistOperationReference(active.operation, active.options, (draft, timestamp) => {
      const item = getItem(draft, index, 'move');
      item.actualTargetIndex = current?.index ?? 0;
      finishExecution(item, 'succeeded', timestamp);
    });
    return 'continue';
  }
  if (isNodeAtSource(current, original)) {
    await finishExecutionItem(active, index, 'failed', 'mutation_failed');
    return 'continue';
  }
  await finishExecutionItem(active, index, 'conflict', 'bookmark_changed');
  return 'stop';
}

async function runExecution(active: ActiveRun, allowMutation = true): Promise<void> {
  await persistOperationReference(active.operation, active.options, (draft) => {
    draft.status = 'running';
  });
  for (let index = 0; index < active.operation.items.length; index += 1) {
    const currentItem = active.operation.items[index];
    if (
      cancellationRequested(active) &&
      (allowMutation || (currentItem?.executionAttemptCount ?? 0) === 0)
    ) {
      await persistOperationReference(active.operation, active.options, (draft, timestamp) => {
        markRemainingExecution(draft, index, 'operation_cancelled', timestamp);
      });
      break;
    }
    const item = active.operation.items[index];
    if (!item || item.executionStatus !== 'pending') {
      continue;
    }
    let result: ExecutionResult;
    if (item.kind === 'delete') {
      result = await runDeleteExecution(active, index, allowMutation);
    } else if (item.kind === 'update_url') {
      result = await runUpdateExecution(active, index, allowMutation);
    } else {
      result = await runMoveExecution(active, index, allowMutation);
    }
    if (result === 'stop') {
      await persistOperationReference(active.operation, active.options, (draft, timestamp) => {
        markRemainingExecution(draft, index + 1, 'conflict_stopped', timestamp);
      });
      break;
    }
  }
  await persistOperationReference(
    active.operation,
    active.options,
    (draft) => {
      draft.status = executionTerminalStatus(draft);
    },
    (draft, timestamp) => {
      finishReceipt(draft, active.requestId, 'succeeded', timestamp);
      finishPendingCancelReceipts(draft, timestamp);
    },
  );
}

function isSameBookmarkExceptUrl(
  node: BookmarkNode | undefined,
  snapshot: BookmarkSnapshot,
): boolean {
  return Boolean(node?.url && node.title === snapshot.title && node.parentId === snapshot.parentId);
}

async function deleteIdentityMatches(
  parentId: string,
  original: BookmarkSnapshot,
): Promise<BookmarkNode[]> {
  const children = await getBookmarkChildren(parentId);
  return children.filter((node) => {
    if (!node.url || node.title !== original.title) {
      return false;
    }
    try {
      return normalizeBookmarkOperationUrl(node.url) === original.url;
    } catch {
      return false;
    }
  });
}

async function finishRestoreItem(
  active: ActiveRun,
  index: number,
  status: 'restored' | 'restore_failed' | 'conflict',
  errorCode?: BookmarkOperationErrorCode,
  restoredBookmarkId?: string,
  restoredParentId?: string,
): Promise<void> {
  await persistOperationReference(active.operation, active.options, (draft, timestamp) => {
    const item = draft.items[index];
    if (!item) {
      throw new BookmarkOperationCommandError('invalid_operation_state');
    }
    if (item.kind === 'delete' && restoredBookmarkId && restoredParentId) {
      item.restoredBookmarkId = restoredBookmarkId;
      item.restoredParentId = restoredParentId;
    }
    finishRestore(item, status, timestamp, errorCode);
  });
}

async function markRestoreAttempt(active: ActiveRun, index: number): Promise<boolean> {
  let allowed = true;
  await persistOperationReference(active.operation, active.options, (draft, timestamp) => {
    const item = draft.items[index];
    if (!item) {
      throw new BookmarkOperationCommandError('invalid_operation_state');
    }
    allowed = setRestoreAttempt(item, timestamp);
    if (!allowed) {
      finishRestore(item, 'conflict', timestamp, 'attempt_limit_exceeded');
    }
  });
  return allowed;
}

async function deleteRestoreParent(active: ActiveRun, index: number): Promise<string> {
  const item = getItem(active.operation, index, 'delete');
  const original = item.original;
  if (!original) {
    throw new BookmarkOperationCommandError('invalid_operation_state');
  }
  if (item.restoreTargetParentId) {
    const recordedParent = await readNode(item.restoreTargetParentId);
    if (recordedParent && !recordedParent.url) {
      return item.restoreTargetParentId;
    }
    throw new BookmarkOperationCommandError('parent_recovery_failed');
  }

  let originalParent: BookmarkNode | undefined;
  try {
    originalParent = await readNode(original.parentId);
  } catch {
    throw new BookmarkOperationCommandError('state_read_failed');
  }
  let parentId: string;
  if (originalParent && !originalParent.url) {
    parentId = original.parentId;
  } else {
    const rootParentId = await defaultRootParentId();
    parentId = await resolveFolderLevel(
      active,
      undefined,
      RECOVERY_FOLDER_TITLE,
      rootParentId,
      RECOVERY_FOLDER_TITLE,
    );
  }
  await persistOperationReference(active.operation, active.options, (draft) => {
    getItem(draft, index, 'delete').restoreTargetParentId = parentId;
  });
  return parentId;
}

function deleteRestoredNodeIsBound(
  node: BookmarkNode | undefined,
  original: BookmarkSnapshot,
  parentId: string,
): boolean {
  return Boolean(node && isNodeIdentity(node, original) && node.parentId === parentId);
}

function attributedSiblingRestoreIds(
  operation: BookmarkOperation,
  itemIndex: number,
  parentId: string,
  original: BookmarkSnapshot,
): string[] {
  return operation.items.flatMap((item, index) => {
    if (
      index === itemIndex ||
      item.kind !== 'delete' ||
      item.restoreStatus !== 'restored' ||
      item.restoredParentId !== parentId ||
      !item.restoredBookmarkId ||
      item.original?.title !== original.title ||
      item.original.url !== original.url
    ) {
      return [];
    }
    return [item.restoredBookmarkId];
  });
}

async function runDeleteRestore(
  active: ActiveRun,
  index: number,
  allowMutation: boolean,
): Promise<ExecutionResult> {
  const initial = getItem(active.operation, index, 'delete');
  const original = initial.original;
  const baseline = initial.restoreBaselineBookmarkIds;
  if (!original || !baseline) {
    await finishRestoreItem(active, index, 'conflict', 'invalid_bookmark_data');
    return 'stop';
  }
  let parentId: string;
  try {
    parentId = await deleteRestoreParent(active, index);
  } catch (error) {
    const code =
      error instanceof BookmarkOperationCommandError ? error.code : 'parent_recovery_failed';
    if (code === 'operation_cancelled') {
      await finishRestoreItem(active, index, 'restore_failed', code);
      return 'continue';
    }
    await finishRestoreItem(active, index, 'conflict', code);
    return 'stop';
  }

  const allowedBaseline = [
    ...(parentId === original.parentId ? baseline : []),
    ...attributedSiblingRestoreIds(active.operation, index, parentId, original),
  ];
  let newMatches: BookmarkNode[];
  try {
    const matches = await deleteIdentityMatches(parentId, original);
    newMatches = matches.filter((node) => !allowedBaseline.includes(node.id));
  } catch {
    await finishRestoreItem(active, index, 'conflict', 'state_read_failed');
    return 'stop';
  }

  const stalePendingAttempt =
    initial.restoreAttemptCount > 0 && initial.restoreStatus === 'pending';
  if (stalePendingAttempt) {
    if (newMatches.length === 1) {
      const restored = newMatches[0] as BookmarkNode;
      if (!deleteRestoredNodeIsBound(restored, original, parentId)) {
        await finishRestoreItem(active, index, 'conflict', 'restore_conflict');
        return 'stop';
      }
      await finishRestoreItem(active, index, 'restored', undefined, restored.id, parentId);
      return 'continue';
    }
    await finishRestoreItem(
      active,
      index,
      newMatches.length === 0 ? 'restore_failed' : 'conflict',
      newMatches.length === 0 ? 'mutation_failed' : 'duplicate_ambiguous',
    );
    return newMatches.length === 0 ? 'continue' : 'stop';
  }

  if (newMatches.length > 0) {
    await finishRestoreItem(active, index, 'conflict', 'duplicate_ambiguous');
    return 'stop';
  }
  if (!allowMutation) {
    await finishRestoreItem(active, index, 'restore_failed', 'operation_interrupted');
    return 'continue';
  }
  const admission = await beginMutation(
    active,
    () => markRestoreAttempt(active, index),
    () =>
      createBookmark({
        parentId,
        index: original.index,
        title: original.title,
        url: original.url,
      }),
  );
  if (admission.status === 'cancelled') {
    await finishRestoreItem(active, index, 'restore_failed', 'operation_cancelled');
    return 'continue';
  }
  if (admission.status === 'attempt_rejected') {
    return 'stop';
  }

  let callbackNode: BookmarkNode | undefined;
  let createThrew = false;
  try {
    callbackNode = await admission.completion;
  } catch {
    createThrew = true;
  }
  if (!createThrew && callbackNode) {
    let boundNode: BookmarkNode | undefined;
    try {
      boundNode = await readNode(callbackNode.id);
    } catch {
      boundNode = undefined;
    }
    if (deleteRestoredNodeIsBound(boundNode, original, parentId)) {
      await finishRestoreItem(active, index, 'restored', undefined, callbackNode.id, parentId);
      return 'continue';
    }
    await finishRestoreItem(active, index, 'conflict', 'callback_binding_failed');
    return 'stop';
  }

  try {
    const matches = await deleteIdentityMatches(parentId, original);
    newMatches = matches.filter((node) => !allowedBaseline.includes(node.id));
  } catch {
    await finishRestoreItem(active, index, 'conflict', 'state_read_failed');
    return 'stop';
  }
  if (newMatches.length === 1) {
    const restored = newMatches[0] as BookmarkNode;
    if (!deleteRestoredNodeIsBound(restored, original, parentId)) {
      await finishRestoreItem(active, index, 'conflict', 'restore_conflict');
      return 'stop';
    }
    await finishRestoreItem(active, index, 'restored', undefined, restored.id, parentId);
    return 'continue';
  }
  await finishRestoreItem(
    active,
    index,
    newMatches.length === 0 ? 'restore_failed' : 'conflict',
    newMatches.length === 0 ? 'mutation_failed' : 'duplicate_ambiguous',
  );
  return newMatches.length === 0 ? 'continue' : 'stop';
}

async function runUpdateRestore(
  active: ActiveRun,
  index: number,
  allowMutation: boolean,
): Promise<ExecutionResult> {
  const initial = getItem(active.operation, index, 'update_url');
  const original = initial.original;
  if (!original || !initial.oldUrl) {
    await finishRestoreItem(active, index, 'conflict', 'invalid_bookmark_data');
    return 'stop';
  }
  let current: BookmarkNode | undefined;
  let currentUrl: string | undefined;
  try {
    current = await readNode(initial.bookmarkId);
    currentUrl = current?.url ? normalizeBookmarkOperationUrl(current.url) : undefined;
  } catch {
    await finishRestoreItem(active, index, 'conflict', 'state_read_failed');
    return 'stop';
  }
  const sameBookmark = isSameBookmarkExceptUrl(current, original);
  const stalePendingAttempt =
    initial.restoreAttemptCount > 0 && initial.restoreStatus === 'pending';
  if (stalePendingAttempt) {
    if (sameBookmark && currentUrl === initial.oldUrl) {
      await finishRestoreItem(active, index, 'restored');
      return 'continue';
    }
    if (sameBookmark && currentUrl === initial.newUrl) {
      await finishRestoreItem(active, index, 'restore_failed', 'mutation_failed');
      return 'continue';
    }
    await finishRestoreItem(active, index, 'conflict', 'restore_conflict');
    return 'stop';
  }
  if (sameBookmark && currentUrl === initial.oldUrl && initial.restoreAttemptCount === 0) {
    await finishRestoreItem(active, index, 'conflict', 'restore_conflict');
    return 'stop';
  }
  if (!sameBookmark || currentUrl !== initial.newUrl) {
    await finishRestoreItem(active, index, 'conflict', 'restore_conflict');
    return 'stop';
  }
  if (!allowMutation) {
    await finishRestoreItem(active, index, 'restore_failed', 'operation_interrupted');
    return 'continue';
  }
  const admission = await beginMutation(
    active,
    () => markRestoreAttempt(active, index),
    () => updateBookmarkUrl(initial.bookmarkId, initial.oldUrl as string),
  );
  if (admission.status === 'cancelled') {
    await finishRestoreItem(active, index, 'restore_failed', 'operation_cancelled');
    return 'continue';
  }
  if (admission.status === 'attempt_rejected') {
    return 'stop';
  }
  try {
    await admission.completion;
  } catch {
    // The current Chrome state is authoritative.
  }
  try {
    current = await readNode(initial.bookmarkId);
    currentUrl = current?.url ? normalizeBookmarkOperationUrl(current.url) : undefined;
  } catch {
    await finishRestoreItem(active, index, 'conflict', 'state_read_failed');
    return 'stop';
  }
  if (isSameBookmarkExceptUrl(current, original) && currentUrl === initial.oldUrl) {
    await finishRestoreItem(active, index, 'restored');
    return 'continue';
  }
  if (isSameBookmarkExceptUrl(current, original) && currentUrl === initial.newUrl) {
    await finishRestoreItem(active, index, 'restore_failed', 'mutation_failed');
    return 'continue';
  }
  await finishRestoreItem(active, index, 'conflict', 'restore_conflict');
  return 'stop';
}

async function runMoveRestore(
  active: ActiveRun,
  index: number,
  allowMutation: boolean,
): Promise<ExecutionResult> {
  const initial = getItem(active.operation, index, 'move');
  const original = initial.original;
  if (!original || !initial.targetParentId) {
    await finishRestoreItem(active, index, 'conflict', 'invalid_bookmark_data');
    return 'stop';
  }
  let current: BookmarkNode | undefined;
  try {
    current = await readNode(initial.bookmarkId);
  } catch {
    await finishRestoreItem(active, index, 'conflict', 'state_read_failed');
    return 'stop';
  }
  const stalePendingAttempt =
    initial.restoreAttemptCount > 0 && initial.restoreStatus === 'pending';
  if (stalePendingAttempt) {
    if (
      current &&
      isNodeIdentity(current, original) &&
      current.parentId === original.parentId &&
      current.index === original.index
    ) {
      await finishRestoreItem(active, index, 'restored');
      return 'continue';
    }
    if (current && isNodeIdentity(current, original) && current.parentId === original.parentId) {
      await finishRestoreItem(active, index, 'conflict', 'restore_conflict');
      return 'stop';
    }
    if (
      current &&
      isNodeIdentity(current, original) &&
      current.parentId === initial.targetParentId
    ) {
      await finishRestoreItem(active, index, 'restore_failed', 'mutation_failed');
      return 'continue';
    }
    await finishRestoreItem(active, index, 'conflict', 'restore_conflict');
    return 'stop';
  }
  if (current && isNodeIdentity(current, original) && current.parentId === original.parentId) {
    await finishRestoreItem(active, index, 'conflict', 'restore_conflict');
    return 'stop';
  }
  if (
    !current ||
    !isNodeIdentity(current, original) ||
    current.parentId !== initial.targetParentId
  ) {
    await finishRestoreItem(active, index, 'conflict', 'restore_conflict');
    return 'stop';
  }
  if (!allowMutation) {
    await finishRestoreItem(active, index, 'restore_failed', 'operation_interrupted');
    return 'continue';
  }
  const admission = await beginMutation(
    active,
    () => markRestoreAttempt(active, index),
    () =>
      moveBookmark(initial.bookmarkId, {
        parentId: original.parentId,
        index: original.index,
      }),
  );
  if (admission.status === 'cancelled') {
    await finishRestoreItem(active, index, 'restore_failed', 'operation_cancelled');
    return 'continue';
  }
  if (admission.status === 'attempt_rejected') {
    return 'stop';
  }
  try {
    await admission.completion;
  } catch {
    // The current Chrome state is authoritative.
  }
  try {
    current = await readNode(initial.bookmarkId);
  } catch {
    await finishRestoreItem(active, index, 'conflict', 'state_read_failed');
    return 'stop';
  }
  if (
    current &&
    isNodeIdentity(current, original) &&
    current.parentId === original.parentId &&
    current.index === original.index
  ) {
    await finishRestoreItem(active, index, 'restored');
    return 'continue';
  }
  if (current && isNodeIdentity(current, original) && current.parentId === initial.targetParentId) {
    await finishRestoreItem(active, index, 'restore_failed', 'mutation_failed');
    return 'continue';
  }
  await finishRestoreItem(active, index, 'conflict', 'restore_conflict');
  return 'stop';
}

function restoreOrder(operation: BookmarkOperation): number[] {
  const indexes = operation.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => bookmarkOperationItemNeedsRestore(item));
  if (operation.type !== 'move_bookmarks') {
    return indexes.map(({ index }) => index);
  }
  return indexes
    .sort((left, right) => {
      const leftItem = left.item as MoveBookmarkOperationItem;
      const rightItem = right.item as MoveBookmarkOperationItem;
      const leftParent = leftItem.original?.parentId ?? '';
      const rightParent = rightItem.original?.parentId ?? '';
      const parentCompare = leftParent === rightParent ? 0 : leftParent < rightParent ? -1 : 1;
      return (
        parentCompare ||
        (leftItem.original?.index ?? 0) - (rightItem.original?.index ?? 0) ||
        left.index - right.index
      );
    })
    .map(({ index }) => index);
}

async function verifyRestoredMoveIndexes(active: ActiveRun): Promise<void> {
  for (let index = 0; index < active.operation.items.length; index += 1) {
    const item = active.operation.items[index];
    if (item?.kind !== 'move' || item.restoreStatus !== 'restored' || !item.original) {
      continue;
    }
    let current: BookmarkNode | undefined;
    try {
      current = await readNode(item.bookmarkId);
    } catch {
      current = undefined;
    }
    if (
      !current ||
      !isNodeIdentity(current, item.original) ||
      current.parentId !== item.original.parentId ||
      current.index !== item.original.index
    ) {
      await finishRestoreItem(active, index, 'conflict', 'restore_conflict');
    }
  }
}

async function runRestore(active: ActiveRun, allowMutation = true): Promise<void> {
  if (active.operation.status !== 'restoring') {
    await persistOperationReference(active.operation, active.options, (draft) => {
      draft.status = 'restoring';
    });
  }
  const order = restoreOrder(active.operation);
  for (const index of order) {
    const currentItem = active.operation.items[index];
    if (
      cancellationRequested(active) &&
      (allowMutation || (currentItem?.restoreAttemptCount ?? 0) === 0)
    ) {
      break;
    }
    const item = active.operation.items[index];
    if (!item || item.executionStatus !== 'succeeded') {
      continue;
    }
    let result: ExecutionResult;
    if (item.kind === 'delete') {
      result = await runDeleteRestore(active, index, allowMutation);
    } else if (item.kind === 'update_url') {
      result = await runUpdateRestore(active, index, allowMutation);
    } else {
      result = await runMoveRestore(active, index, allowMutation);
    }
    if (result === 'stop') {
      break;
    }
  }
  if (active.operation.type === 'move_bookmarks') {
    await verifyRestoredMoveIndexes(active);
  }
  await persistOperationReference(
    active.operation,
    active.options,
    (draft) => {
      draft.status = restoreTerminalStatus(draft);
    },
    (draft, timestamp) => {
      finishReceipt(draft, active.requestId, 'succeeded', timestamp);
      finishPendingCancelReceipts(draft, timestamp);
    },
  );
}

async function replayExistingRequest(
  requestId: string,
  action: BookmarkOperationCommandAction,
  payloadIdentity: string,
  options?: BookmarkOperationRunOptions,
): Promise<CommandGateResponse | undefined> {
  const existing = await getBookmarkOperationByRequestId(requestId);
  if (!existing) {
    return undefined;
  }
  const receipt = existing.commands.find((command) => command.requestId === requestId);
  if (!receipt || receipt.action !== action || receipt.payloadIdentity !== payloadIdentity) {
    throw new BookmarkOperationCommandError('request_id_conflict');
  }
  if (receipt.status !== 'pending') {
    return { response: terminalResponse(existing, requestId) };
  }
  const active = activeRuns.get(existing.id);
  if (active) {
    return {
      waitFor: active.promise,
      operationId: existing.id,
      requestId,
    };
  }
  await reconcileInterruptedOperation(existing.id, options);
  return {
    response: await loadTerminalResponse(existing.id, requestId),
  };
}

async function resolveGateResponse(
  gate: CommandGateResponse,
): Promise<BookmarkOperationCommandResponse> {
  if (gate.response) {
    return gate.response;
  }
  if (!gate.waitFor || !gate.operationId || !gate.requestId) {
    throw new BookmarkOperationCommandError('invalid_operation_state');
  }
  await gate.waitFor;
  return loadTerminalResponse(gate.operationId, gate.requestId);
}

async function executePreparedOperation(
  requestId: string,
  payloadIdentity: string,
  type: BookmarkOperation['type'],
  source: BookmarkOperationSource,
  prepare: (timestamp: string) => Promise<BookmarkOperationItem[]>,
  options?: BookmarkOperationRunOptions,
): Promise<BookmarkOperationCommandResponse> {
  const gate = await withCoordinator(async (): Promise<CommandGateResponse> => {
    const replay = await replayExistingRequest(requestId, 'execute', payloadIdentity, options);
    if (replay) {
      return replay;
    }
    const timestamp = nowIso(options);
    const items = await prepare(timestamp);
    const operation = createPreparedOperation(
      requestId,
      payloadIdentity,
      type,
      source,
      items,
      timestamp,
      options,
    );
    const inserted = await insertBookmarkOperation(
      operation,
      getBookmarkOperationReserveBytes(operation),
    );
    syncOperation(operation, inserted.operation);
    options?.onChange?.(clone(operation));
    const active = createActiveRun(operation, requestId, 'execute', options);
    startActiveRun(active, runExecution);
    return {
      waitFor: active.promise,
      operationId: operation.id,
      requestId,
    };
  });
  return resolveGateResponse(gate);
}

export async function executeDeleteBookmarks(
  requestId: string,
  bookmarkIds: readonly string[],
  source: BookmarkOperationSource = 'health',
  options?: BookmarkOperationRunOptions,
): Promise<BookmarkOperationCommandResponse> {
  const request = parseDeleteRequest(requestId, bookmarkIds);
  if (request.type !== 'bookmarkOperations:delete') {
    throw new BookmarkOperationCommandError('invalid_request');
  }
  const parsedSource = parseSource(source);
  const payloadIdentity = await createBookmarkExecutionPayloadIdentity(
    'delete_bookmarks',
    request.bookmarkIds,
    parsedSource,
  );
  return executePreparedOperation(
    request.requestId,
    payloadIdentity,
    'delete_bookmarks',
    parsedSource,
    (timestamp) => prepareDeleteItems(request.bookmarkIds, timestamp),
    options,
  );
}

export async function executeBookmarkUrlUpdates(
  requestId: string,
  updates: readonly BookmarkUrlUpdateRequestItem[],
  source: BookmarkOperationSource = 'health',
  options?: BookmarkOperationRunOptions,
): Promise<BookmarkOperationCommandResponse> {
  const request = parseUpdateRequest(requestId, updates);
  if (request.type !== 'bookmarkOperations:updateUrls') {
    throw new BookmarkOperationCommandError('invalid_request');
  }
  const parsedSource = parseSource(source);
  const payloadIdentity = await createBookmarkExecutionPayloadIdentity(
    'update_bookmark_urls',
    request.updates,
    parsedSource,
  );
  return executePreparedOperation(
    request.requestId,
    payloadIdentity,
    'update_bookmark_urls',
    parsedSource,
    (timestamp) => prepareUpdateItems(request.updates, timestamp),
    options,
  );
}

export async function executeBookmarkMoves(
  requestId: string,
  moves: readonly BookmarkMoveRequestItem[],
  source: BookmarkOperationSource = 'classification',
  options?: BookmarkOperationRunOptions,
): Promise<BookmarkOperationCommandResponse> {
  const request = parseMoveRequest(requestId, moves);
  if (request.type !== 'bookmarkOperations:move') {
    throw new BookmarkOperationCommandError('invalid_request');
  }
  const parsedSource = parseSource(source);
  const payloadIdentity = await createBookmarkExecutionPayloadIdentity(
    'move_bookmarks',
    request.moves,
    parsedSource,
  );
  return executePreparedOperation(
    request.requestId,
    payloadIdentity,
    'move_bookmarks',
    parsedSource,
    (timestamp) => prepareMoveItems(request.moves, timestamp),
    options,
  );
}

function commandAllowedStatus(
  action: 'restore' | 'accept_current',
  operation: BookmarkOperation,
): boolean {
  if (action === 'restore') {
    return (
      operation.status === 'complete' ||
      operation.status === 'partial' ||
      operation.status === 'restore_partial'
    );
  }
  return operation.status === 'restore_partial';
}

async function appendPendingCommand(
  operation: BookmarkOperation,
  requestId: string,
  action: Exclude<BookmarkOperationCommandAction, 'execute'>,
  payloadIdentity: string,
  options?: BookmarkOperationRunOptions,
  activationStatus?: 'restoring',
): Promise<BookmarkOperation> {
  if (operation.commands.length >= BOOKMARK_OPERATION_COMMAND_LIMIT) {
    throw new BookmarkOperationCommandError('command_limit_exceeded');
  }
  const timestamp = nowIso(options);
  const written = await updateBookmarkOperation(operation.id, (draft) => {
    if (draft.commands.length >= BOOKMARK_OPERATION_COMMAND_LIMIT) {
      throw new BookmarkOperationCommandError('command_limit_exceeded');
    }
    draft.commands.push(pendingReceipt(requestId, action, payloadIdentity, timestamp));
    if (activationStatus) {
      draft.status = activationStatus;
    }
    draft.updatedAt = timestamp;
  });
  const owner = activeRuns.get(operation.id);
  if (owner) {
    syncOperation(owner.operation, written.operation);
    owner.options?.onChange?.(clone(owner.operation));
    return owner.operation;
  }
  syncOperation(operation, written.operation);
  options?.onChange?.(clone(operation));
  return operation;
}

async function appendTerminalFailureCommand(
  operation: BookmarkOperation,
  requestId: string,
  action: Exclude<BookmarkOperationCommandAction, 'execute'>,
  payloadIdentity: string,
  errorCode: BookmarkOperationErrorCode,
  options?: BookmarkOperationRunOptions,
): Promise<BookmarkOperationCommandResponse> {
  if (operation.commands.length >= BOOKMARK_OPERATION_COMMAND_LIMIT) {
    throw new BookmarkOperationCommandError('command_limit_exceeded');
  }
  const timestamp = nowIso(options);
  const written = await updateBookmarkOperation(operation.id, (draft) => {
    if (draft.commands.length >= BOOKMARK_OPERATION_COMMAND_LIMIT) {
      throw new BookmarkOperationCommandError('command_limit_exceeded');
    }
    draft.commands.push({
      requestId,
      action,
      payloadIdentity,
      status: 'failed',
      createdAt: timestamp,
      updatedAt: timestamp,
      result: {
        ok: false,
        operationStatus: draft.status,
        summary: clone(draft.summary),
        completedAt: timestamp,
        errorCode,
      },
    });
    draft.updatedAt = timestamp;
  });
  const owner = activeRuns.get(operation.id);
  if (owner) {
    syncOperation(owner.operation, written.operation);
    owner.options?.onChange?.(clone(owner.operation));
    return terminalResponse(owner.operation, requestId);
  }
  syncOperation(operation, written.operation);
  options?.onChange?.(clone(operation));
  return terminalResponse(operation, requestId);
}

async function failPendingCommand(
  operation: BookmarkOperation,
  requestId: string,
  errorCode: BookmarkOperationErrorCode,
  options?: BookmarkOperationRunOptions,
): Promise<BookmarkOperationCommandResponse> {
  await persistOperationReference(
    operation,
    options,
    () => undefined,
    (draft, timestamp) => {
      finishReceipt(draft, requestId, 'failed', timestamp, errorCode);
    },
  );
  return terminalResponse(operation, requestId);
}

async function reconcileTargetBeforeCommand(
  operation: BookmarkOperation,
  options?: BookmarkOperationRunOptions,
): Promise<BookmarkOperation> {
  if (
    operation.commands.some((command) => command.status === 'pending') &&
    !activeRuns.has(operation.id)
  ) {
    await reconcileInterruptedOperation(operation.id, options);
    const reconciled = await getBookmarkOperation(operation.id);
    if (!reconciled) {
      throw new BookmarkOperationCommandError('operation_not_found');
    }
    return reconciled;
  }
  return operation;
}

export async function restoreBookmarkOperation(
  requestId: string,
  operationIdValue: string,
  options?: BookmarkOperationRunOptions,
): Promise<BookmarkOperationCommandResponse> {
  const request = parseOperationCommandRequest(
    'bookmarkOperations:restore',
    requestId,
    operationIdValue,
  );
  const payloadIdentity = await createBookmarkCommandPayloadIdentity(
    'restore',
    request.operationId,
  );
  const gate = await withCoordinator(async (): Promise<CommandGateResponse> => {
    const replay = await replayExistingRequest(
      request.requestId,
      'restore',
      payloadIdentity,
      options,
    );
    if (replay) {
      return replay;
    }
    let operation = await getBookmarkOperation(request.operationId);
    if (!operation) {
      throw new BookmarkOperationCommandError('operation_not_found');
    }
    operation = await reconcileTargetBeforeCommand(operation, options);
    if (activeRuns.has(operation.id)) {
      return {
        response: await appendTerminalFailureCommand(
          operation,
          request.requestId,
          'restore',
          payloadIdentity,
          'operation_busy',
          options,
        ),
      };
    }
    if (!commandAllowedStatus('restore', operation)) {
      return {
        response: await appendTerminalFailureCommand(
          operation,
          request.requestId,
          'restore',
          payloadIdentity,
          'invalid_operation_state',
          options,
        ),
      };
    }
    if (!operation.items.some(bookmarkOperationItemNeedsRestore)) {
      return {
        response: await appendTerminalFailureCommand(
          operation,
          request.requestId,
          'restore',
          payloadIdentity,
          'invalid_operation_state',
          options,
        ),
      };
    }
    operation = await appendPendingCommand(
      operation,
      request.requestId,
      'restore',
      payloadIdentity,
      options,
      'restoring',
    );
    const active = createActiveRun(operation, request.requestId, 'restore', options);
    startActiveRun(active, runRestore);
    return {
      waitFor: active.promise,
      operationId: operation.id,
      requestId: request.requestId,
    };
  });
  return resolveGateResponse(gate);
}

function acceptCurrentItems(operation: BookmarkOperation, timestamp: string): number {
  let accepted = 0;
  for (const item of operation.items) {
    if (
      item.executionStatus === 'succeeded' &&
      (item.restoreStatus === 'conflict' || item.restoreStatus === 'restore_failed')
    ) {
      item.restoreStatus = 'accepted_current';
      item.restoreCompletedAt = timestamp;
      item.restoreErrorCode = undefined;
      accepted += 1;
    }
  }
  operation.status = restoreTerminalStatus(operation);
  return accepted;
}

export async function acceptBookmarkOperationCurrentState(
  requestId: string,
  operationIdValue: string,
  options?: BookmarkOperationRunOptions,
): Promise<BookmarkOperationCommandResponse> {
  const request = parseOperationCommandRequest(
    'bookmarkOperations:acceptCurrent',
    requestId,
    operationIdValue,
  );
  const payloadIdentity = await createBookmarkCommandPayloadIdentity(
    'accept_current',
    request.operationId,
  );
  const gate = await withCoordinator(async (): Promise<CommandGateResponse> => {
    const replay = await replayExistingRequest(
      request.requestId,
      'accept_current',
      payloadIdentity,
      options,
    );
    if (replay) {
      return replay;
    }
    let operation = await getBookmarkOperation(request.operationId);
    if (!operation) {
      throw new BookmarkOperationCommandError('operation_not_found');
    }
    operation = await reconcileTargetBeforeCommand(operation, options);
    if (activeRuns.has(operation.id)) {
      return {
        response: await appendTerminalFailureCommand(
          operation,
          request.requestId,
          'accept_current',
          payloadIdentity,
          'operation_busy',
          options,
        ),
      };
    }
    operation = await appendPendingCommand(
      operation,
      request.requestId,
      'accept_current',
      payloadIdentity,
      options,
    );
    if (!commandAllowedStatus('accept_current', operation)) {
      return {
        response: await failPendingCommand(
          operation,
          request.requestId,
          'invalid_operation_state',
          options,
        ),
      };
    }
    let accepted = 0;
    await persistOperationReference(
      operation,
      options,
      (draft, timestamp) => {
        accepted = acceptCurrentItems(draft, timestamp);
      },
      (draft, timestamp) => {
        finishReceipt(
          draft,
          request.requestId,
          accepted > 0 ? 'succeeded' : 'failed',
          timestamp,
          accepted > 0 ? undefined : 'invalid_operation_state',
        );
      },
    );
    return { response: terminalResponse(operation, request.requestId) };
  });
  return resolveGateResponse(gate);
}

export async function cancelBookmarkOperation(
  requestId: string,
  operationIdValue: string,
  options?: BookmarkOperationRunOptions,
): Promise<BookmarkOperationCommandResponse> {
  const request = parseOperationCommandRequest(
    'bookmarkOperations:cancel',
    requestId,
    operationIdValue,
  );
  const payloadIdentity = await createBookmarkCommandPayloadIdentity('cancel', request.operationId);
  const gate = await withCoordinator(async (): Promise<CommandGateResponse> => {
    const replay = await replayExistingRequest(
      request.requestId,
      'cancel',
      payloadIdentity,
      options,
    );
    if (replay) {
      return replay;
    }
    let operation = await getBookmarkOperation(request.operationId);
    if (!operation) {
      throw new BookmarkOperationCommandError('operation_not_found');
    }
    operation = await reconcileTargetBeforeCommand(operation, options);
    const targetOperation = operation;
    const cancellation = await withMutationAdmission(async () => {
      const persisted = await appendPendingCommand(
        targetOperation,
        request.requestId,
        'cancel',
        payloadIdentity,
        options,
      );
      const active = activeRuns.get(persisted.id);
      active?.abortController.abort();
      return { operation: persisted, active };
    });
    operation = cancellation.operation;
    const { active } = cancellation;
    if (active) {
      return {
        waitFor: active.promise,
        operationId: operation.id,
        requestId: request.requestId,
      };
    }
    if (
      operation.status === 'prepared' ||
      operation.status === 'running' ||
      operation.status === 'restoring'
    ) {
      await reconcileInterruptedOperation(operation.id, options);
      return {
        response: await loadTerminalResponse(operation.id, request.requestId),
      };
    }
    return {
      response: await failPendingCommand(
        operation,
        request.requestId,
        'invalid_operation_state',
        options,
      ),
    };
  });
  return resolveGateResponse(gate);
}

async function reconcilePendingAccept(
  operation: BookmarkOperation,
  receipt: BookmarkOperationCommandRecord,
  options?: BookmarkOperationRunOptions,
): Promise<void> {
  if (operation.status !== 'restore_partial') {
    await failPendingCommand(operation, receipt.requestId, 'invalid_operation_state', options);
    return;
  }
  let accepted = 0;
  await persistOperationReference(
    operation,
    options,
    (draft, timestamp) => {
      accepted = acceptCurrentItems(draft, timestamp);
    },
    (draft, timestamp) => {
      finishReceipt(
        draft,
        receipt.requestId,
        accepted > 0 ? 'succeeded' : 'failed',
        timestamp,
        accepted > 0 ? undefined : 'invalid_operation_state',
      );
    },
  );
}

async function reconcileInterruptedOperation(
  operationIdValue: string,
  options?: BookmarkOperationRunOptions,
): Promise<void> {
  if (activeRuns.has(operationIdValue)) {
    return;
  }
  const operation = await getBookmarkOperation(operationIdValue);
  if (!operation) {
    return;
  }
  const pending = operation.commands.filter((command) => command.status === 'pending');
  if (pending.length === 0) {
    return;
  }
  const executeReceipt = pending.find((command) => command.action === 'execute');
  if (executeReceipt) {
    const active = createActiveRun(operation, executeReceipt.requestId, 'execute', options);
    await runExecution(active, false);
    return;
  }
  const restoreReceipt = pending.find((command) => command.action === 'restore');
  if (restoreReceipt) {
    const active = createActiveRun(operation, restoreReceipt.requestId, 'restore', options);
    await runRestore(active, false);
    return;
  }
  const acceptReceipt = pending.find((command) => command.action === 'accept_current');
  if (acceptReceipt) {
    await reconcilePendingAccept(operation, acceptReceipt, options);
    return;
  }
  const cancelReceipts = pending.filter((command) => command.action === 'cancel');
  for (const receipt of cancelReceipts) {
    await failPendingCommand(operation, receipt.requestId, 'invalid_operation_state', options);
  }
}

export async function reconcileInterruptedBookmarkOperations(
  activeIds: readonly string[] = [],
  options?: BookmarkOperationRunOptions,
): Promise<BookmarkOperation[]> {
  return withCoordinator(async () => {
    const excluded = new Set([...activeIds, ...Array.from(activeRuns.keys())]);
    const operations = await getBookmarkOperations();
    for (const operation of operations) {
      if (
        !excluded.has(operation.id) &&
        operation.commands.some((command) => command.status === 'pending')
      ) {
        await reconcileInterruptedOperation(operation.id, options);
      }
    }
    return getBookmarkOperations();
  });
}
