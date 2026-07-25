import { CheckCheck, CircleStop, History, RotateCcw, ShieldCheck } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import type { BookmarkOperation } from '../../shared/bookmark-types.js';
import {
  bookmarkOperationItemStatus,
  bookmarkOperationStatusLabel,
  bookmarkOperationTitle,
  operationCanAcceptCurrent,
  operationCanCancel,
  operationCanRestore,
  operationNeedsRecovery,
} from './bookmark-task-model.js';

interface BookmarkRecoveryPageProps {
  readonly busy: boolean;
  readonly operations: readonly BookmarkOperation[];
  readonly selectedOperationId?: string;
  readonly onAcceptCurrent: (operation: BookmarkOperation) => void;
  readonly onCancel: (operation: BookmarkOperation) => void;
  readonly onRestore: (operation: BookmarkOperation) => void;
  readonly onSelect: (operationId: string) => void;
}

function operationTone(
  operation: BookmarkOperation,
): 'default' | 'secondary' | 'success' | 'warning' | 'danger' {
  if (operation.status === 'restored' || operation.status === 'resolved') return 'success';
  if (operation.status === 'failed') return 'danger';
  if (
    operation.status === 'partial' ||
    operation.status === 'restore_partial' ||
    operation.status === 'cancelled'
  ) {
    return 'warning';
  }
  if (operationCanCancel(operation)) return 'default';
  return 'secondary';
}

export default function BookmarkRecoveryPage({
  busy,
  operations,
  selectedOperationId,
  onAcceptCurrent,
  onCancel,
  onRestore,
  onSelect,
}: BookmarkRecoveryPageProps) {
  const selected =
    operations.find((operation) => operation.id === selectedOperationId) ?? operations[0];

  if (operations.length === 0) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center border-y border-border px-5 py-10 text-center">
        <ShieldCheck aria-hidden="true" className="h-8 w-8 text-primary" />
        <h2 className="mt-4 text-base font-semibold">还没有书签操作记录</h2>
        <p className="mt-2 max-w-sm text-[13px] leading-5 text-muted-foreground">
          整理、链接更新或删除产生结果后，会在这里保留逐项状态和可用的恢复动作。
        </p>
      </div>
    );
  }

  return (
    <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(14rem,0.8fr)_minmax(0,1.4fr)]">
      <section aria-labelledby="operation-list-title" className="min-h-0">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold" id="operation-list-title">
            操作记录
          </h2>
          <span className="text-[12.5px] text-muted-foreground">{operations.length} 次</span>
        </div>
        <div className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
          {operations.map((operation) => {
            const active = operation.id === selected?.id;
            return (
              <button
                aria-current={active ? 'true' : undefined}
                className={
                  active
                    ? 'w-full rounded-md border border-primary bg-accent px-3 py-3 text-left'
                    : 'w-full rounded-md border border-border px-3 py-3 text-left transition hover:bg-muted/60'
                }
                key={operation.id}
                onClick={() => onSelect(operation.id)}
                type="button"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold">
                      {bookmarkOperationTitle(operation)}
                    </span>
                    <span className="mt-1 block text-[12.5px] leading-5 text-muted-foreground">
                      {operation.summary.succeeded} 成功 · {operation.summary.failed} 失败 ·{' '}
                      {operation.summary.executionConflicts} 冲突
                    </span>
                  </span>
                  <Badge className="text-[12px]" variant={operationTone(operation)}>
                    {bookmarkOperationStatusLabel(operation)}
                  </Badge>
                </span>
                <span className="mt-2 block text-[12px] text-muted-foreground">
                  {new Date(operation.updatedAt).toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {selected ? (
        <section aria-labelledby="operation-detail-title" className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
            <div>
              <p className="text-[12.5px] font-medium text-primary">
                {operationNeedsRecovery(selected) ? '需要复核' : '逐项结果'}
              </p>
              <h2 className="mt-1 text-base font-semibold" id="operation-detail-title">
                {bookmarkOperationTitle(selected)}
              </h2>
              <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
                请求 {selected.summary.requested} · 成功 {selected.summary.succeeded} · 跳过{' '}
                {selected.summary.skipped}
              </p>
            </div>
            <Badge className="text-[12px]" variant={operationTone(selected)}>
              {bookmarkOperationStatusLabel(selected)}
            </Badge>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {operationCanCancel(selected) ? (
              <Button
                disabled={busy}
                onClick={() => onCancel(selected)}
                size="sm"
                variant="outline"
              >
                <CircleStop aria-hidden="true" className="h-4 w-4" />
                安全停止
              </Button>
            ) : null}
            {operationCanRestore(selected) ? (
              <Button
                disabled={busy}
                onClick={() => onRestore(selected)}
                size="sm"
                variant="outline"
              >
                <RotateCcw aria-hidden="true" className="h-4 w-4" />
                恢复成功项
              </Button>
            ) : null}
            {operationCanAcceptCurrent(selected) ? (
              <Button
                disabled={busy}
                onClick={() => onAcceptCurrent(selected)}
                size="sm"
                variant="outline"
              >
                <CheckCheck aria-hidden="true" className="h-4 w-4" />
                接受当前状态
              </Button>
            ) : null}
          </div>

          <div className="mt-4 max-h-[27rem] overflow-y-auto rounded-md border border-border">
            {selected.items.map((item) => (
              <div
                className="flex items-start gap-3 border-b border-border px-3 py-3 last:border-b-0"
                key={`${item.kind}:${item.bookmarkId}`}
              >
                <History
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">
                    {item.title || item.bookmarkId}
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                    {bookmarkOperationItemStatus(item)}
                    {item.errorCode ? ` · ${item.errorCode}` : ''}
                    {item.restoreErrorCode ? ` · ${item.restoreErrorCode}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
