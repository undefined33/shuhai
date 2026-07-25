import type {
  BookmarkOperation,
  BookmarkOperationItem,
  ClassificationPlan,
  MovePlan,
} from '../../shared/bookmark-types.js';

export type BookmarkTaskView = 'bookmarks' | 'recovery';
export type BookmarkTaskActivity = 'idle' | 'authorizing' | 'classifying' | 'mutating';

export interface ClassificationStartGate {
  current: boolean;
}

export function acquireClassificationStart(gate: ClassificationStartGate): boolean {
  if (gate.current) return false;
  gate.current = true;
  return true;
}

export function releaseClassificationStart(gate: ClassificationStartGate): void {
  gate.current = false;
}

const ACTIVE_OPERATION_STATUSES = new Set<BookmarkOperation['status']>([
  'prepared',
  'running',
  'restoring',
]);

export function replacePlanMove(
  plan: ClassificationPlan,
  nextMove: MovePlan,
  existingFolderPaths: readonly string[],
): ClassificationPlan {
  const moves = plan.moves.map((move) => (move.id === nextMove.id ? nextMove : move));
  const existingFolders = new Set(existingFolderPaths);
  const targetFolders = new Set(
    moves
      .map((move) => move.targetFolder)
      .filter((targetFolder) => targetFolder && !existingFolders.has(targetFolder)),
  );

  return {
    ...plan,
    moves,
    newFolders: Array.from(targetFolders).sort((a, b) => a.localeCompare(b, 'zh-CN')),
  };
}

export function selectedPlanMoves(plan: ClassificationPlan | undefined): MovePlan[] {
  return plan?.moves.filter((move) => move.selected) ?? [];
}

export function upsertBookmarkOperation(
  operations: readonly BookmarkOperation[],
  operation: BookmarkOperation,
): BookmarkOperation[] {
  return [operation, ...operations.filter((candidate) => candidate.id !== operation.id)].sort(
    (left, right) => right.updatedAt.localeCompare(left.updatedAt),
  );
}

export function operationNeedsRecovery(operation: BookmarkOperation): boolean {
  return operation.items.some(
    (item) =>
      item.restoreStatus === 'pending' ||
      item.restoreStatus === 'restore_failed' ||
      item.restoreStatus === 'conflict',
  );
}

export function operationCanRestore(operation: BookmarkOperation): boolean {
  if (operationCanCancel(operation)) return false;
  return operation.items.some(
    (item) =>
      item.executionStatus === 'succeeded' &&
      item.restoreStatus !== 'restored' &&
      item.restoreStatus !== 'accepted_current',
  );
}

export function operationCanAcceptCurrent(operation: BookmarkOperation): boolean {
  if (operationCanCancel(operation)) return false;
  return operation.items.some(
    (item) => item.restoreStatus === 'conflict' || item.restoreStatus === 'restore_failed',
  );
}

export function operationCanCancel(operation: BookmarkOperation): boolean {
  return ACTIVE_OPERATION_STATUSES.has(operation.status);
}

export function operationRestorableCount(operation: BookmarkOperation): number {
  return operation.items.filter(
    (item) =>
      item.executionStatus === 'succeeded' &&
      item.restoreStatus !== 'restored' &&
      item.restoreStatus !== 'accepted_current',
  ).length;
}

export function operationUnresolvedCount(operation: BookmarkOperation): number {
  return operation.items.filter(
    (item) => item.restoreStatus === 'conflict' || item.restoreStatus === 'restore_failed',
  ).length;
}

export function bookmarkOperationTitle(operation: BookmarkOperation): string {
  if (operation.type === 'move_bookmarks') return '整理书签';
  if (operation.type === 'delete_bookmarks') return '删除失效书签';
  return '更新书签链接';
}

export function bookmarkOperationStatusLabel(operation: BookmarkOperation): string {
  switch (operation.status) {
    case 'prepared':
      return '等待执行';
    case 'running':
      return '执行中';
    case 'complete':
      return '已完成';
    case 'partial':
      return '部分完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已停止';
    case 'restoring':
      return '恢复中';
    case 'restored':
      return '已恢复';
    case 'restore_partial':
      return '部分恢复';
    case 'resolved':
      return '已处理';
  }
}

export function bookmarkOperationItemStatus(item: BookmarkOperationItem): string {
  if (item.restoreStatus === 'restored') return '已恢复';
  if (item.restoreStatus === 'accepted_current') return '保留当前状态';
  if (item.restoreStatus === 'conflict') return '恢复冲突';
  if (item.restoreStatus === 'restore_failed') return '恢复失败';

  switch (item.executionStatus) {
    case 'pending':
      return '等待处理';
    case 'succeeded':
      return '已成功';
    case 'failed':
      return '失败';
    case 'skipped':
      return '已跳过';
    case 'conflict':
      return '冲突';
  }
}

export function canExitBookmarkTask(activity: BookmarkTaskActivity, confirmOpen: boolean): boolean {
  return !confirmOpen && activity === 'idle';
}
