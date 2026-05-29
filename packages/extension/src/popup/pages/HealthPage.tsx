import { useDeferredValue, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  Pause,
  Pencil,
  RotateCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import type {
  BookmarkItem,
  UrlHealthProgress,
  UrlHealthRecord,
  UrlHealthStatus,
} from '../../shared/bookmark-types.js';
import { VirtualList } from '../../components/VirtualList.js';
import { SearchInput } from '../../components/SearchInput.js';
import { Alert } from '../../components/ui/alert.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Checkbox } from '../../components/ui/checkbox.js';
import { Input } from '../../components/ui/input.js';
import { Progress } from '../../components/ui/progress.js';
import { summarizeHealthRecords } from '../../utils/url-health.js';
import { friendlyHealthError } from '../../utils/error-messages.js';

interface HealthPageProps {
  bookmarks: BookmarkItem[];
  checking: boolean;
  progress?: UrlHealthProgress;
  records: UrlHealthRecord[];
  onCancel(): void;
  onClear(): void;
  onDeleteMany(records: UrlHealthRecord[]): void;
  onRetry(record: UrlHealthRecord): void;
  onStart(): void;
  onUpdateManyUrls(records: UrlHealthRecord[]): void;
  onUpdateUrl(record: UrlHealthRecord, url: string): void;
}

type HealthFilter = 'actionable' | 'all' | UrlHealthStatus;

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

const ACTIONABLE_STATUSES = new Set<UrlHealthStatus>(['dead', 'error', 'redirected']);

function statusLabel(status: UrlHealthStatus): string {
  switch (status) {
    case 'alive':
      return '正常';
    case 'redirected':
      return '重定向';
    case 'dead':
      return '死链';
    case 'error':
      return '检查失败';
    case 'skipped':
      return '已跳过';
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

function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) {
    return '估算中';
  }

  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) {
    return `${seconds} 秒`;
  }

  return `${Math.ceil(seconds / 60)} 分钟`;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function localDateKey(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function failureGroup(record: UrlHealthRecord): string {
  if (record.status === 'redirected') {
    return '重定向';
  }

  if (record.httpStatus === 404) {
    return '404 Not Found';
  }

  if (record.httpStatus) {
    return `HTTP ${record.httpStatus}`;
  }

  const error = (record.error ?? '').toLowerCase();
  if (error.includes('timeout') || error.includes('timed out') || error.includes('abort')) {
    return '超时';
  }

  if (error.includes('dns') || error.includes('name_not_resolved')) {
    return 'DNS 失败';
  }

  if (error.includes('refused') || error.includes('拒绝')) {
    return '拒绝连接';
  }

  return record.status === 'dead' ? '死链' : '其他错误';
}

function buildRows(records: UrlHealthRecord[]): HealthRow[] {
  const groups = new Map<string, UrlHealthRecord[]>();

  for (const record of records) {
    const group = ACTIONABLE_STATUSES.has(record.status)
      ? failureGroup(record)
      : statusLabel(record.status);
    const list = groups.get(group) ?? [];
    list.push(record);
    groups.set(group, list);
  }

  return Array.from(groups.entries()).flatMap(([label, groupRecords]) => [
    { count: groupRecords.length, label, type: 'group' as const },
    ...groupRecords.map((record) => ({ record, type: 'record' as const })),
  ]);
}

export default function HealthPage({
  bookmarks,
  checking,
  progress,
  records,
  onCancel,
  onClear,
  onDeleteMany,
  onRetry,
  onStart,
  onUpdateManyUrls,
  onUpdateUrl,
}: HealthPageProps) {
  const [filter, setFilter] = useState<HealthFilter>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replacementById, setReplacementById] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const deferredSearch = useDeferredValue(search);
  const bookmarkById = useMemo(
    () => new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark])),
    [bookmarks],
  );
  const activeRecords = useMemo(() => {
    const today = localDateKey(new Date());
    return records.filter((record) => {
      const bookmark = bookmarkById.get(record.bookmarkId);
      return (
        Boolean(bookmark) &&
        bookmark?.url === record.bookmarkUrl &&
        localDateKey(record.checkedAt) === today
      );
    });
  }, [bookmarkById, records]);
  const summary = useMemo(() => summarizeHealthRecords(activeRecords), [activeRecords]);
  const remainingTodayCount = Math.max(0, bookmarks.length - activeRecords.length);
  const startLabel = activeRecords.length > 0 ? '继续检查' : '开始检查';
  const visibleRecords = useMemo(() => {
    const filtered =
      filter === 'all'
        ? activeRecords
        : filter === 'actionable'
          ? activeRecords.filter((record) => ACTIONABLE_STATUSES.has(record.status))
          : activeRecords.filter((record) => record.status === filter);
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
  }, [activeRecords, deferredSearch, filter]);
  const rows = useMemo(() => buildRows(visibleRecords), [visibleRecords]);
  const selectedRecords = useMemo(
    () => visibleRecords.filter((record) => selectedIds.has(record.bookmarkId)),
    [selectedIds, visibleRecords],
  );
  const selectedRedirectedRecords = useMemo(
    () =>
      selectedRecords.filter(
        (record) => record.status === 'redirected' && Boolean(record.finalUrl),
      ),
    [selectedRecords],
  );
  const showRedirectBatchAction = filter === 'redirected' || selectedRedirectedRecords.length > 0;
  const deleteManyLabel = useMemo(() => {
    if (selectedRecords.length === 0) {
      return '删除选中';
    }

    const allDead = selectedRecords.every((record) => record.status === 'dead');
    const allError = selectedRecords.every((record) => record.status === 'error');

    if (allDead) {
      return `删除选中 ${selectedRecords.length} 条死链`;
    }

    if (allError) {
      return `删除选中 ${selectedRecords.length} 条检查失败书签`;
    }

    return `删除选中 ${selectedRecords.length} 条书签`;
  }, [selectedRecords]);
  const percent =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  const setReplacement = (id: string, value: string) => {
    setReplacementById((current) => ({ ...current, [id]: value }));
  };

  const selectFilter = (nextFilter: HealthFilter) => {
    setFilter(nextFilter);
    setEditingId(null);
    setSelectedIds(new Set());
  };

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

  const openUrl = (url: string) => {
    if (chrome.tabs?.create) {
      void chrome.tabs.create({ active: false, url });
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const toggleSelected = (id: string, selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            检查失效链接
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-3">
          <Alert variant="warning">
            ShuHai 只给出筛选建议，不会自动删除书签。删除或替换链接前会先创建备份。
          </Alert>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md border border-border p-2">
              <div className="text-lg font-semibold">{remainingTodayCount}</div>
              <div className="text-[11px] text-muted-foreground">今日未检</div>
            </div>
            <div className="rounded-md border border-border p-2">
              <div className="text-lg font-semibold">{summary.dead + summary.error}</div>
              <div className="text-[11px] text-muted-foreground">死链/错误</div>
            </div>
            <div className="rounded-md border border-border p-2">
              <div className="text-lg font-semibold">{summary.redirected}</div>
              <div className="text-[11px] text-muted-foreground">重定向</div>
            </div>
          </div>

          {checking && progress ? (
            <div className="space-y-2 rounded-md border border-border bg-muted/40 p-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span>
                  正在检查 {progress.done}/{progress.total}，预计剩余{' '}
                  {formatDuration(progress.remainingMs)}
                </span>
                <Badge variant="secondary">{percent}%</Badge>
              </div>
              <Progress value={percent} />
              {progress.currentUrl ? (
                <div className="truncate text-[11px] text-muted-foreground">
                  当前：{hostFromUrl(progress.currentUrl)}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button
              disabled={checking || bookmarks.length === 0 || remainingTodayCount === 0}
              loading={checking}
              onClick={onStart}
            >
              <RotateCw className="h-4 w-4" />
              {startLabel}
            </Button>
            {checking ? (
              <Button onClick={onCancel} variant="outline">
                <Pause className="h-4 w-4" />
                暂停
              </Button>
            ) : (
              <Button disabled={records.length === 0} onClick={onClear} variant="outline">
                清空结果
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {[
          ['actionable', '待处理'],
          ['all', '全部'],
          ['dead', '死链'],
          ['error', '错误'],
          ['redirected', '重定向'],
          ['skipped', '跳过'],
        ].map(([value, label]) => (
          <Button
            key={value}
            onClick={() => selectFilter(value as HealthFilter)}
            size="sm"
            variant={filter === value ? 'default' : 'outline'}
          >
            {label}
          </Button>
        ))}
      </div>

      {activeRecords.length > 0 ? (
        <div className="space-y-1.5">
          <SearchInput
            onChange={setSearch}
            placeholder="搜索标题、URL、跳转或错误"
            value={search}
          />
          <div className="text-[11px] text-muted-foreground">
            显示 {visibleRecords.length} / {activeRecords.length} 条
          </div>
        </div>
      ) : null}

      {visibleRecords.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() =>
              setSelectedIds(new Set(visibleRecords.map((record) => record.bookmarkId)))
            }
            size="sm"
            variant="outline"
          >
            全选当前 {visibleRecords.length}
          </Button>
          <Button
            disabled={selectedIds.size === 0}
            onClick={() => setSelectedIds(new Set())}
            size="sm"
            variant="outline"
          >
            清空选择
          </Button>
          <Button
            disabled={selectedRecords.length === 0}
            onClick={() => onDeleteMany(selectedRecords)}
            size="sm"
            variant="outline"
          >
            <Trash2 className="h-4 w-4" />
            {deleteManyLabel}
          </Button>
          {showRedirectBatchAction ? (
            <Button
              disabled={selectedRedirectedRecords.length === 0}
              onClick={() => onUpdateManyUrls(selectedRedirectedRecords)}
              size="sm"
            >
              更新重定向 {selectedRedirectedRecords.length}
            </Button>
          ) : null}
        </div>
      ) : null}

      <VirtualList
        ariaLabel="失效链接检查结果"
        className="min-h-0 flex-1 rounded-lg border border-border bg-card p-2"
        emptyState={
          activeRecords.length === 0 ? (
            <div className="space-y-2 p-6 text-center text-sm text-muted-foreground">
              <ShieldAlert className="mx-auto h-7 w-7" />
              <p>今天还没有检查结果。</p>
              <p className="text-xs">点击“开始检查”后，已完成的链接会陆续显示在这里。</p>
            </div>
          ) : (
            <div className="space-y-2 p-6 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="mx-auto h-7 w-7" />
              <p>{search ? `未找到匹配「${search}」的链接。` : '当前筛选下没有需要处理的链接。'}</p>
              {search ? (
                <Button onClick={() => setSearch('')} size="sm" variant="outline">
                  清除搜索
                </Button>
              ) : null}
            </div>
          )
        }
        estimatedHeight={520}
        itemHeight={120}
        items={rows}
        renderItem={(row) => {
          if (row.type === 'group') {
            return (
              <div className="flex h-[112px] items-start gap-2 pt-2">
                <Badge variant="secondary">{row.count}</Badge>
                <div className="text-sm font-medium">{row.label}</div>
              </div>
            );
          }

          const record = row.record;
          const replacement = replacementById[record.bookmarkId] ?? '';
          const replacementValid = replacement === '' || isValidHttpUrl(replacement);
          const editing = editingId === record.bookmarkId;
          const canRetry = record.status !== 'alive' && record.status !== 'skipped';
          const canUpdateToFinalUrl = record.status === 'redirected' && Boolean(record.finalUrl);

          return (
            <div className="h-[112px] space-y-1.5 rounded-md border border-border p-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={selectedIds.has(record.bookmarkId)}
                  onCheckedChange={(checked) => toggleSelected(record.bookmarkId, checked === true)}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {record.bookmarkTitle}
                </span>
                <Badge variant={statusVariant(record.status)}>{statusLabel(record.status)}</Badge>
              </div>
              <div className="truncate text-[11px] text-muted-foreground">{record.bookmarkUrl}</div>
              {record.finalUrl ? (
                <div className="truncate text-[11px] text-muted-foreground">
                  跳转到：{record.finalUrl}
                </div>
              ) : null}
              {record.error ? (
                <div className="flex items-start gap-1.5 text-[11px] text-destructive">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span className="truncate">{friendlyHealthError(record.error)}</span>
                </div>
              ) : null}
              {editing ? (
                <div className="grid grid-cols-[1fr_auto_auto] gap-2">
                  <Input
                    autoFocus
                    className={replacementValid ? 'h-8 text-xs' : 'h-8 border-destructive text-xs'}
                    onChange={(event) => setReplacement(record.bookmarkId, event.target.value)}
                    placeholder="粘贴新 URL"
                    value={replacement}
                  />
                  <Button
                    disabled={!replacement || !replacementValid}
                    onClick={() => {
                      setEditingId(null);
                      onUpdateUrl(record, replacement);
                    }}
                    size="sm"
                    variant="outline"
                  >
                    替换
                  </Button>
                  <Button onClick={() => setEditingId(null)} size="sm" variant="ghost">
                    取消
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Button
                    aria-label="打开链接"
                    onClick={() => openUrl(record.bookmarkUrl)}
                    size="icon"
                    title="打开链接"
                    variant="ghost"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                  <Button
                    aria-label="复制 URL"
                    onClick={() => copyUrl(record)}
                    size="icon"
                    title="复制 URL"
                    variant="ghost"
                  >
                    {copiedId === record.bookmarkId ? (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    aria-label="修正链接"
                    onClick={() => setEditingId(record.bookmarkId)}
                    size="icon"
                    title="修正链接"
                    variant="ghost"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {canRetry ? (
                    <Button
                      aria-label="重试检查"
                      onClick={() => onRetry(record)}
                      size="icon"
                      title="重试检查"
                      variant="ghost"
                    >
                      <RotateCw className="h-4 w-4" />
                    </Button>
                  ) : null}
                  {canUpdateToFinalUrl ? (
                    <Button
                      aria-label="更新到跳转"
                      onClick={() => onUpdateUrl(record, record.finalUrl ?? record.bookmarkUrl)}
                      size="icon"
                      title="更新到跳转"
                      variant="ghost"
                    >
                      <ArrowRightLeft className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          );
        }}
      />
    </section>
  );
}
