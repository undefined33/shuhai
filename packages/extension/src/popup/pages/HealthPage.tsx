import { useDeferredValue, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';
import type {
  BookmarkOperation,
  UrlHealthRecord,
  UrlHealthStatus,
} from '../../shared/bookmark-types.js';
import { isSafeHistoricalHealthUrl } from '../../shared/extension-messages.js';
import { VirtualList } from '../../components/VirtualList.js';
import { SearchInput } from '../../components/SearchInput.js';
import { Alert } from '../../components/ui/alert.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { friendlyHealthError } from '../../utils/error-messages.js';
import { summarizeHealthRecords } from '../../utils/url-health.js';

interface HealthPageProps {
  historyAvailable?: boolean;
  operations: BookmarkOperation[];
  records: UrlHealthRecord[];
  onAcceptCurrent(operation: BookmarkOperation): void;
  onCancelOperation(operation: BookmarkOperation): void;
  onClear(): void;
  onRestoreOperation(operation: BookmarkOperation): void;
}

type HealthFilter = 'all' | UrlHealthStatus;

type HealthRow =
  | {
      type: 'group';
      label: string;
      count: number;
    }
  | {
      type: 'record';
      record: UrlHealthRecord;
    };

function MetricNumber({ children }: { children: number | string }) {
  return <span className="font-serif tabular-nums text-foreground">{children}</span>;
}

function statusLabel(status: UrlHealthStatus): string {
  switch (status) {
    case 'alive':
      return '曾正常';
    case 'redirected':
      return '曾重定向';
    case 'dead':
      return '曾失败';
    case 'error':
      return '检查异常';
    case 'skipped':
      return '曾跳过';
  }
}

function statusVariant(
  status: UrlHealthStatus,
): 'danger' | 'outline' | 'secondary' | 'success' | 'warning' {
  switch (status) {
    case 'alive':
      return 'success';
    case 'redirected':
      return 'warning';
    case 'dead':
    case 'error':
      return 'danger';
    case 'skipped':
      return 'secondary';
  }
}

function operationStatusLabel(status: BookmarkOperation['status']): string {
  switch (status) {
    case 'prepared':
      return '准备中';
    case 'running':
      return '执行中';
    case 'complete':
      return '全部成功';
    case 'partial':
      return '部分完成';
    case 'failed':
      return '未执行';
    case 'cancelled':
      return '已取消';
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

function operationTypeLabel(type: BookmarkOperation['type']): string {
  switch (type) {
    case 'delete_bookmarks':
      return '删除书签';
    case 'update_bookmark_urls':
      return '更新链接';
    case 'move_bookmarks':
      return '移动书签';
  }
}

function restorableCount(operation: BookmarkOperation): number {
  return operation.items.filter(
    (item) =>
      item.executionStatus === 'succeeded' &&
      item.restoreStatus !== 'restored' &&
      item.restoreStatus !== 'accepted_current',
  ).length;
}

function unresolvedCount(operation: BookmarkOperation): number {
  return operation.items.filter(
    (item) => item.restoreStatus === 'conflict' || item.restoreStatus === 'restore_failed',
  ).length;
}

function operationRunning(operation: BookmarkOperation): boolean {
  return (
    operation.status === 'prepared' ||
    operation.status === 'running' ||
    operation.status === 'restoring'
  );
}

function failureGroup(record: UrlHealthRecord): string {
  if (record.status === 'redirected') {
    return '历史重定向';
  }

  if (record.httpStatus === 404) {
    return '历史 HTTP 404';
  }

  if (record.httpStatus) {
    return `历史 HTTP ${record.httpStatus}`;
  }

  const error = (record.error ?? '').toLowerCase();
  if (error.includes('timeout') || error.includes('timed out') || error.includes('abort')) {
    return '历史超时';
  }

  if (error.includes('dns') || error.includes('name_not_resolved')) {
    return '历史 DNS 失败';
  }

  return statusLabel(record.status);
}

function buildRows(records: UrlHealthRecord[]): HealthRow[] {
  const groups = new Map<string, UrlHealthRecord[]>();

  for (const record of records) {
    const group = failureGroup(record);
    const list = groups.get(group) ?? [];
    list.push(record);
    groups.set(group, list);
  }

  return Array.from(groups.entries()).flatMap(([label, groupRecords]) => [
    { count: groupRecords.length, label, type: 'group' as const },
    ...groupRecords.map((record) => ({ record, type: 'record' as const })),
  ]);
}

export function openHistoricalHealthUrl(url: string): boolean {
  if (!isSafeHistoricalHealthUrl(url) || !chrome.tabs?.create) {
    return false;
  }

  try {
    const result = chrome.tabs.create({ active: false, url });
    void Promise.resolve(result).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

function OperationRecoveryList({
  operations,
  onAcceptCurrent,
  onCancelOperation,
  onRestoreOperation,
}: Pick<
  HealthPageProps,
  'operations' | 'onAcceptCurrent' | 'onCancelOperation' | 'onRestoreOperation'
>) {
  if (operations.length === 0) {
    return null;
  }

  return (
    <Card variant="soft">
      <CardHeader className="pb-2">
        <CardTitle>可恢复的书签操作</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-3 pt-0">
        <p className="text-xs leading-5 text-muted-foreground">
          这些操作来自独立恢复日志。恢复前会再次核对书签当前状态，不会覆盖之后的修改。
        </p>
        <div className="max-h-56 space-y-2 overflow-y-auto">
          {operations.map((operation) => {
            const restorable = restorableCount(operation);
            const unresolved = unresolvedCount(operation);
            const running = operationRunning(operation);

            return (
              <div className="space-y-2 rounded-md border border-border p-2" key={operation.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">{operationTypeLabel(operation.type)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      成功 <MetricNumber>{operation.summary.succeeded}</MetricNumber> · 失败{' '}
                      <MetricNumber>{operation.summary.failed}</MetricNumber> · 冲突{' '}
                      <MetricNumber>
                        {operation.summary.executionConflicts + operation.summary.restoreConflicts}
                      </MetricNumber>
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {operation.items[0]?.title ?? operation.id}
                      {operation.items.length > 1 ? ` 等 ${operation.items.length} 项` : ''}
                    </p>
                  </div>
                  <Badge
                    variant={
                      operation.status === 'complete' ||
                      operation.status === 'restored' ||
                      operation.status === 'resolved'
                        ? 'success'
                        : operation.status === 'failed'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {operationStatusLabel(operation.status)}
                  </Badge>
                </div>

                {operation.status === 'restore_partial' ? (
                  <p className="text-xs text-muted-foreground">
                    已恢复 <MetricNumber>{operation.summary.restored}</MetricNumber> · 恢复失败{' '}
                    <MetricNumber>{operation.summary.restoreFailed}</MetricNumber> · 恢复冲突{' '}
                    <MetricNumber>{operation.summary.restoreConflicts}</MetricNumber>
                  </p>
                ) : null}

                <div className="flex flex-wrap justify-end gap-2">
                  {running ? (
                    <Button
                      onClick={() => onCancelOperation(operation)}
                      size="sm"
                      variant="outline"
                    >
                      安全停止
                    </Button>
                  ) : null}
                  {unresolved > 0 && operation.status === 'restore_partial' ? (
                    <Button onClick={() => onAcceptCurrent(operation)} size="sm" variant="outline">
                      接受当前状态 {unresolved}
                    </Button>
                  ) : null}
                  {restorable > 0 &&
                  (operation.status === 'complete' ||
                    operation.status === 'partial' ||
                    operation.status === 'restore_partial') ? (
                    <Button onClick={() => onRestoreOperation(operation)} size="sm">
                      恢复成功项 {restorable}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default function HealthPage({
  historyAvailable = true,
  operations,
  records,
  onAcceptCurrent,
  onCancelOperation,
  onClear,
  onRestoreOperation,
}: HealthPageProps) {
  const [filter, setFilter] = useState<HealthFilter>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const summary = useMemo(() => summarizeHealthRecords(records), [records]);
  const visibleRecords = useMemo(() => {
    const filtered =
      filter === 'all' ? records : records.filter((record) => record.status === filter);
    const keyword = deferredSearch.trim().toLowerCase();
    const searched = keyword
      ? filtered.filter((record) =>
          [
            record.bookmarkTitle,
            record.bookmarkUrl,
            record.finalUrl ?? '',
            record.error ?? '',
            friendlyHealthError(record.error),
          ]
            .join('\n')
            .toLowerCase()
            .includes(keyword),
        )
      : filtered;

    return [...searched].sort((a, b) => failureGroup(a).localeCompare(failureGroup(b), 'zh-CN'));
  }, [deferredSearch, filter, records]);
  const rows = useMemo(() => buildRows(visibleRecords), [visibleRecords]);

  const copyUrl = (record: UrlHealthRecord) => {
    if (!navigator.clipboard?.writeText) {
      return;
    }

    void navigator.clipboard
      .writeText(record.bookmarkUrl)
      .then(() => {
        setCopiedId(record.bookmarkId);
        window.setTimeout(() => {
          setCopiedId((current) => (current === record.bookmarkId ? null : current));
        }, 1500);
      })
      .catch(() => undefined);
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            链接检查历史
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-3">
          <Alert variant="warning">
            当前纯扩展架构无法安全验证任意地址和重定向，因此暂不主动扫描。下面是旧检查结果，仅供人工核实。
          </Alert>
          {!historyAvailable ? (
            <Alert variant="destructive">
              书签数据未能安全读取。当前只显示独立恢复日志，整理、收藏和历史清理均已停用。
            </Alert>
          ) : null}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md bg-muted/50 p-2">
              <div className="text-lg font-semibold">
                <MetricNumber>{records.length}</MetricNumber>
              </div>
              <div className="text-xs text-muted-foreground">历史记录</div>
            </div>
            <div className="rounded-md bg-muted/50 p-2">
              <div className="text-lg font-semibold">
                <MetricNumber>{summary.dead + summary.error}</MetricNumber>
              </div>
              <div className="text-xs text-muted-foreground">曾失败</div>
            </div>
            <div className="rounded-md bg-muted/50 p-2">
              <div className="text-lg font-semibold">
                <MetricNumber>{summary.redirected}</MetricNumber>
              </div>
              <div className="text-xs text-muted-foreground">曾重定向</div>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              disabled={!historyAvailable || records.length === 0}
              onClick={onClear}
              size="sm"
              variant="outline"
            >
              清空本地历史
            </Button>
          </div>
        </CardContent>
      </Card>

      <OperationRecoveryList
        onAcceptCurrent={onAcceptCurrent}
        onCancelOperation={onCancelOperation}
        onRestoreOperation={onRestoreOperation}
        operations={operations}
      />

      {historyAvailable ? (
        <>
          <div className="flex flex-wrap gap-2">
            {[
              ['all', '全部'],
              ['alive', '曾正常'],
              ['dead', '曾失败'],
              ['error', '检查异常'],
              ['redirected', '曾重定向'],
              ['skipped', '曾跳过'],
            ].map(([value, label]) => (
              <Button
                key={value}
                onClick={() => setFilter(value as HealthFilter)}
                size="sm"
                variant={filter === value ? 'default' : 'outline'}
              >
                {label}
              </Button>
            ))}
          </div>

          {records.length > 0 ? (
            <div className="space-y-1.5">
              <SearchInput
                onChange={setSearch}
                placeholder="搜索旧标题、URL 或错误"
                value={search}
              />
              <div className="text-xs text-muted-foreground">
                显示 <MetricNumber>{visibleRecords.length}</MetricNumber> /{' '}
                <MetricNumber>{records.length}</MetricNumber> 条
              </div>
            </div>
          ) : null}

          <VirtualList
            ariaLabel="旧链接检查结果"
            className="min-h-0 flex-1 rounded-lg border border-border bg-card p-2"
            emptyState={
              records.length === 0 ? (
                <div className="space-y-2 p-6 text-center text-sm text-muted-foreground">
                  <ShieldAlert className="mx-auto h-7 w-7" />
                  <p>没有保留旧检查记录。</p>
                  <p className="text-xs">ShuHai 不会在后台或从本页重新扫描书签链接。</p>
                </div>
              ) : (
                <div className="space-y-2 p-6 text-center text-sm text-muted-foreground">
                  <CheckCircle2 className="mx-auto h-7 w-7" />
                  <p>{search ? `未找到匹配「${search}」的旧记录。` : '当前筛选下没有旧记录。'}</p>
                  {search ? (
                    <Button onClick={() => setSearch('')} size="sm" variant="outline">
                      清除搜索
                    </Button>
                  ) : null}
                </div>
              )
            }
            estimatedHeight={520}
            itemHeight={108}
            items={rows}
            renderItem={(row) => {
              if (row.type === 'group') {
                return (
                  <div className="flex h-[100px] items-start gap-2 pt-2">
                    <Badge variant="secondary">{row.count}</Badge>
                    <div className="text-sm font-medium">{row.label}</div>
                  </div>
                );
              }

              const record = row.record;
              const canOpen = isSafeHistoricalHealthUrl(record.bookmarkUrl);

              return (
                <div className="h-[100px] space-y-1.5 rounded-md border border-border p-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {record.bookmarkTitle}
                    </span>
                    <Badge variant={statusVariant(record.status)}>
                      {statusLabel(record.status)}
                    </Badge>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{record.bookmarkUrl}</div>
                  {record.error ? (
                    <div className="flex items-start gap-1.5 text-xs text-destructive">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className="truncate">{friendlyHealthError(record.error)}</span>
                    </div>
                  ) : null}
                  <div className="flex items-center gap-1.5">
                    <Button
                      aria-label="在后台标签页打开原链接"
                      disabled={!canOpen}
                      onClick={() => openHistoricalHealthUrl(record.bookmarkUrl)}
                      size="icon"
                      title={canOpen ? '在后台标签页打开原链接' : '此 URL 不符合安全打开规则'}
                      variant="ghost"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button
                      aria-label="复制原 URL"
                      onClick={() => copyUrl(record)}
                      size="icon"
                      title="复制原 URL"
                      variant="ghost"
                    >
                      {copiedId === record.bookmarkId ? (
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              );
            }}
          />
        </>
      ) : null}
    </section>
  );
}
