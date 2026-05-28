import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
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
import { Alert } from '../../components/ui/alert.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Progress } from '../../components/ui/progress.js';
import { ScrollArea } from '../../components/ui/scroll-area.js';
import { summarizeHealthRecords } from '../../utils/url-health.js';

interface HealthPageProps {
  bookmarks: BookmarkItem[];
  checking: boolean;
  progress?: UrlHealthProgress;
  records: UrlHealthRecord[];
  onCancel(): void;
  onClear(): void;
  onDelete(record: UrlHealthRecord): void;
  onStart(): void;
  onUpdateUrl(record: UrlHealthRecord, url: string): void;
}

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

function statusVariant(status: UrlHealthStatus): 'danger' | 'outline' | 'secondary' | 'success' | 'warning' {
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

export default function HealthPage({
  bookmarks,
  checking,
  progress,
  records,
  onCancel,
  onClear,
  onDelete,
  onStart,
  onUpdateUrl,
}: HealthPageProps) {
  const [filter, setFilter] = useState<'actionable' | 'all' | UrlHealthStatus>('actionable');
  const summary = useMemo(() => summarizeHealthRecords(records), [records]);
  const visibleRecords = useMemo(() => {
    if (filter === 'all') {
      return records;
    }

    if (filter === 'actionable') {
      return records.filter((record) => ACTIONABLE_STATUSES.has(record.status));
    }

    return records.filter((record) => record.status === filter);
  }, [filter, records]);
  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  const askForReplacement = (record: UrlHealthRecord) => {
    const nextUrl = window.prompt('输入新的书签 URL', record.finalUrl ?? record.bookmarkUrl);
    if (nextUrl?.trim()) {
      onUpdateUrl(record, nextUrl.trim());
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            链接体检
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-3">
          <Alert variant="warning">
            ShuHai 只给出筛选建议，不会自动删除书签。删除或替换链接前会先创建备份。
          </Alert>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md border border-border p-2">
              <div className="text-lg font-semibold">{bookmarks.length}</div>
              <div className="text-[11px] text-muted-foreground">待检查</div>
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
                <div className="truncate text-[11px] text-muted-foreground">{progress.currentUrl}</div>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button disabled={checking || bookmarks.length === 0} loading={checking} onClick={onStart}>
              <RotateCw className="h-4 w-4" />
              开始体检
            </Button>
            {checking ? (
              <Button onClick={onCancel} variant="outline">
                取消
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
            onClick={() => setFilter(value as typeof filter)}
            size="sm"
            variant={filter === value ? 'default' : 'outline'}
          >
            {label}
          </Button>
        ))}
      </div>

      <ScrollArea className="min-h-0 flex-1 rounded-lg border border-border bg-card">
        {records.length === 0 ? (
          <div className="space-y-2 p-6 text-center text-sm text-muted-foreground">
            <ShieldAlert className="mx-auto h-7 w-7" />
            <p>还没有体检结果。</p>
            <p className="text-xs">点击“开始体检”后，死链、错误和重定向会集中显示在这里。</p>
          </div>
        ) : visibleRecords.length === 0 ? (
          <div className="space-y-2 p-6 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="mx-auto h-7 w-7" />
            <p>当前筛选下没有需要处理的链接。</p>
          </div>
        ) : (
          <div className="space-y-2 p-2">
            {visibleRecords.map((record) => (
              <div className="space-y-2 rounded-md border border-border p-2" key={record.bookmarkId}>
                <div className="flex items-center gap-2">
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
                    <span>{record.error}</span>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {record.status === 'redirected' && record.finalUrl ? (
                    <Button onClick={() => onUpdateUrl(record, record.finalUrl ?? record.bookmarkUrl)} size="sm">
                      更新为跳转后地址
                    </Button>
                  ) : null}
                  <Button onClick={() => askForReplacement(record)} size="sm" variant="outline">
                    替换链接
                  </Button>
                  {ACTIONABLE_STATUSES.has(record.status) ? (
                    <Button onClick={() => onDelete(record)} size="sm" variant="outline">
                      <Trash2 className="h-4 w-4" />
                      删除
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </section>
  );
}
