import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Trash2,
} from 'lucide-react';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  clearActivityLog,
  getActivityLog,
  type ActivityEntry,
  type ActivityType,
} from '../../utils/activity-log.js';

interface ActivityPageProps {
  onBack(): void;
}

function localDateLabel(value: string): string {
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value.slice(0, 10);
  }
}

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
  switch (type) {
    case 'classify_apply':
      return '整理';
    case 'classify_undo':
      return '撤销';
    case 'health_delete':
      return '删除';
    case 'health_update':
      return '更新';
    case 'capture_save':
      return '捕获';
    case 'vault_export':
      return '写入';
    case 'backup_create':
      return '备份';
  }
}

export default function ActivityPage({ onBack }: ActivityPageProps) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const loadEntries = () => {
    void getActivityLog().then(setEntries);
  };

  useEffect(loadEntries, []);

  const groups = useMemo(() => {
    const grouped = new Map<string, ActivityEntry[]>();
    for (const entry of entries) {
      const key = localDateLabel(entry.timestamp);
      grouped.set(key, [...(grouped.get(key) ?? []), entry]);
    }

    return Array.from(grouped.entries());
  }, [entries]);

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

  const clearHistory = async () => {
    if (!window.confirm('确定清空 ShuHai 操作历史吗？这不会影响书签、备份或 Vault 文件。')) {
      return;
    }

    await clearActivityLog();
    setEntries([]);
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            操作历史
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-3">
          <p className="text-xs text-muted-foreground">
            这里记录最近 50 次关键操作，帮助你回看整理、删除和写入了什么。
          </p>
          <div className="flex gap-2">
            <Button onClick={onBack} size="sm" variant="outline">
              <ArrowLeft className="h-4 w-4" />
              返回整理
            </Button>
            <Button
              disabled={entries.length === 0}
              onClick={clearHistory}
              size="sm"
              variant="ghost"
            >
              <Trash2 className="h-4 w-4" />
              清空历史
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="min-h-0 flex-1">
        <CardContent className="h-full overflow-y-auto p-3">
          {entries.length === 0 ? (
            <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <Activity className="h-7 w-7" />
              <p>还没有操作历史。</p>
              <p className="text-xs">整理、删除、保存或写入 Vault 后会出现在这里。</p>
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map(([date, groupEntries]) => (
                <div className="space-y-2" key={date}>
                  <div className="text-xs font-medium text-muted-foreground">{date}</div>
                  {groupEntries.map((entry) => {
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
    </section>
  );
}
