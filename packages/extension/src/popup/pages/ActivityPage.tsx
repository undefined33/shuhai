import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  FileDown,
  Trash2,
} from 'lucide-react';
import type { AppSettings } from '../../shared/bookmark-types.js';
import { Alert } from '../../components/ui/alert.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { SearchInput } from '../../components/SearchInput.js';
import {
  calculateActivityStats,
  clearActivityLog,
  filterActivityLog,
  getActivityLog,
  groupActivityEntries,
  type ActivityEntry,
  type ActivityType,
} from '../../utils/activity-log.js';
import {
  checkVaultPermission,
  exportActivityLogToVault,
  getVaultHandle,
} from '../../utils/vault-writer.js';

interface ActivityPageProps {
  settings: AppSettings;
  onBack(): void;
}

const TYPE_FILTERS: Array<{ type: ActivityType; label: string; group: string }> = [
  { type: 'classify_apply', label: '整理', group: '整理' },
  { type: 'classify_undo', label: '撤销', group: '整理' },
  { type: 'vault_export', label: '写入', group: '写入' },
  { type: 'health_delete', label: '链接删除', group: '链接' },
  { type: 'health_update', label: '链接更新', group: '链接' },
  { type: 'capture_save', label: '收藏', group: '收藏' },
  { type: 'backup_create', label: '备份', group: '备份' },
];

const FILTER_GROUPS = [
  { label: '整理', types: ['classify_apply', 'classify_undo'] as ActivityType[] },
  { label: '写入', types: ['vault_export'] as ActivityType[] },
  { label: '链接', types: ['health_delete', 'health_update'] as ActivityType[] },
  { label: '收藏', types: ['capture_save'] as ActivityType[] },
  { label: '备份', types: ['backup_create'] as ActivityType[] },
];

function localTimeLabel(value: string): string {
  try {
    return new Date(value).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function typeLabel(type: ActivityType): string {
  return TYPE_FILTERS.find((item) => item.type === type)?.label ?? type;
}

function downloadJson(entries: ActivityEntry[]): void {
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(entries, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `shuhai-activity-${date}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function ActivityPage({ settings, onBack }: ActivityPageProps) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [selectedTypes, setSelectedTypes] = useState<Set<ActivityType>>(() => new Set());
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  const loadEntries = () => {
    void getActivityLog().then(setEntries);
  };

  useEffect(loadEntries, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedKeyword(keyword), 200);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  const filteredEntries = useMemo(
    () =>
      filterActivityLog(entries, {
        keyword: debouncedKeyword,
        types: Array.from(selectedTypes),
      }),
    [debouncedKeyword, entries, selectedTypes],
  );

  const groups = useMemo(() => groupActivityEntries(filteredEntries), [filteredEntries]);
  const stats = useMemo(() => calculateActivityStats(entries), [entries]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleTypeGroup = (types: ActivityType[]) => {
    setSelectedTypes((current) => {
      const next = new Set(current);
      const selected = types.every((type) => next.has(type));
      if (selected) {
        types.forEach((type) => next.delete(type));
      } else {
        types.forEach((type) => next.add(type));
      }
      return next;
    });
  };

  const clearHistory = async () => {
    await clearActivityLog();
    setEntries([]);
    setConfirmClearOpen(false);
    setStatus('历史记录已清空。');
  };

  const exportJson = () => {
    downloadJson(entries);
    setStatus('历史记录 JSON 已下载。');
  };

  const exportMarkdown = async () => {
    setError('');
    try {
      const handle = await getVaultHandle();
      if (!handle) {
        throw new Error('请先在设置页选择 Obsidian Vault');
      }

      const allowed = await checkVaultPermission(handle);
      if (!allowed) {
        throw new Error('没有 Vault 写入权限，请重新选择目录');
      }

      const path = await exportActivityLogToVault(handle, entries, settings.exportDirectory);
      setStatus(`历史记录已写入 ${path}`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            历史记录
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-3">
          {status ? <Alert variant="success">{status}</Alert> : null}
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <p className="text-xs text-muted-foreground">
            这里记录最近 200 次关键操作，支持搜索、筛选和下载。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onBack} size="sm" variant="outline">
              <ArrowLeft className="h-4 w-4" />
              返回首页
            </Button>
            <Button
              disabled={entries.length === 0}
              onClick={exportJson}
              size="sm"
              variant="outline"
            >
              <Download className="h-4 w-4" />
              导出 JSON
            </Button>
            <Button
              disabled={entries.length === 0}
              onClick={() => void exportMarkdown()}
              size="sm"
              variant="outline"
            >
              <FileDown className="h-4 w-4" />
              写入 Vault
            </Button>
            <Button
              disabled={entries.length === 0}
              onClick={() => setConfirmClearOpen(true)}
              size="sm"
              variant="ghost"
            >
              <Trash2 className="h-4 w-4" />
              清空历史
            </Button>
          </div>

          <SearchInput onChange={setKeyword} placeholder="搜索书签标题或操作摘要" value={keyword} />

          <div className="flex flex-wrap gap-1">
            <Button
              onClick={() => setSelectedTypes(new Set())}
              size="sm"
              variant={selectedTypes.size === 0 ? 'default' : 'outline'}
            >
              全部
            </Button>
            {FILTER_GROUPS.map((item) => (
              <Button
                key={item.label}
                onClick={() => toggleTypeGroup(item.types)}
                size="sm"
                variant={
                  item.types.every((type) => selectedTypes.has(type)) ? 'default' : 'outline'
                }
              >
                {item.label}
              </Button>
            ))}
          </div>

          <div className="rounded-md border border-border bg-muted/40 px-2 py-2 text-xs">
            本周 {stats.thisWeek} 次操作 · 本月 {stats.thisMonth} 次 ·{' '}
            {Object.entries(stats.byType)
              .map(([type, count]) => `${typeLabel(type as ActivityType)} ${count}`)
              .join(' · ') || '暂无本周记录'}
          </div>
        </CardContent>
      </Card>

      <Card className="min-h-0 flex-1">
        <CardContent className="h-full overflow-y-auto p-3">
          {filteredEntries.length === 0 ? (
            <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <Activity className="h-7 w-7" />
              <p>{entries.length === 0 ? '还没有历史记录。' : '没有匹配的历史记录。'}</p>
              <p className="text-xs">整理、删除、保存或写入 Vault 后会出现在这里。</p>
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map((group) => (
                <div className="space-y-2" key={group.label}>
                  <div className="text-xs font-medium text-muted-foreground">
                    {group.label} ({group.entries.length})
                  </div>
                  {group.entries.map((entry) => {
                    const expanded = expandedIds.has(entry.id);
                    return (
                      <div className="rounded-md border border-border bg-card p-2" key={entry.id}>
                        <button
                          className="flex w-full items-start gap-2 text-left"
                          onClick={() => toggleExpanded(entry.id)}
                          type="button"
                        >
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{entry.summary}</span>
                              <Badge variant="secondary">{typeLabel(entry.type)}</Badge>
                            </div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {localTimeLabel(entry.timestamp)}
                            </div>
                          </div>
                          {entry.details?.length ? (
                            expanded ? (
                              <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )
                          ) : null}
                        </button>
                        {expanded && entry.details?.length ? (
                          <div className="mt-2 space-y-1 border-t border-border pt-2">
                            {entry.details.map((detail, index) => (
                              <div className="text-xs" key={`${detail.label}-${index}`}>
                                <span>{detail.label}</span>
                                {detail.meta ? (
                                  <span className="text-muted-foreground"> · {detail.meta}</span>
                                ) : null}
                              </div>
                            ))}
                            {entry.details.length >= 20 ? (
                              <div className="text-[11px] text-muted-foreground">
                                仅显示前 20 条详情。
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog onOpenChange={setConfirmClearOpen} open={confirmClearOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>清空历史记录</DialogTitle>
            <DialogDescription>确定清空所有历史记录？此操作不可撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button
              onClick={() => {
                exportJson();
                void clearHistory();
              }}
              variant="secondary"
            >
              导出后清空
            </Button>
            <Button onClick={() => void clearHistory()} variant="destructive">
              清空
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
