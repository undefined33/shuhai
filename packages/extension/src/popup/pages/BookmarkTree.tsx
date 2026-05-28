import { useMemo, useState } from 'react';
import { ChevronRight, Folder, HelpCircle, RefreshCw, Sparkles, Undo2 } from 'lucide-react';
import type {
  BookmarkItem,
  ClassificationMode,
  FolderItem,
} from '../../shared/bookmark-types.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible.js';
import { Command, CommandInput } from '../../components/ui/command.js';
import { Label } from '../../components/ui/label.js';
import { ScrollArea } from '../../components/ui/scroll-area.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../components/ui/tooltip.js';

interface BookmarkTreeProps {
  bookmarks: BookmarkItem[];
  folders: FolderItem[];
  busy: boolean;
  canUndo: boolean;
  classifyMode: ClassificationMode;
  onClassifyModeChange(mode: ClassificationMode): void;
  onCreatePlan(mode: ClassificationMode): void;
  onRefresh(): void;
  onUndo(): void;
  surface?: 'popup' | 'sidepanel';
}

function countByFolder(bookmarks: BookmarkItem[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const bookmark of bookmarks) {
    counts.set(bookmark.parentPath, (counts.get(bookmark.parentPath) ?? 0) + 1);
  }

  return counts;
}

export default function BookmarkTree({
  bookmarks,
  folders,
  busy,
  canUndo,
  classifyMode,
  onClassifyModeChange,
  onCreatePlan,
  onRefresh,
  onUndo,
  surface = 'popup',
}: BookmarkTreeProps) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const counts = useMemo(() => countByFolder(bookmarks), [bookmarks]);
  const visibleFolders = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const filtered = folders.filter((folder) => folder.path);

    if (!keyword) {
      return filtered;
    }

    return filtered.filter((folder) => folder.path.toLowerCase().includes(keyword));
  }, [folders, query]);

  const visibleBookmarks = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const limit = surface === 'sidepanel' ? 260 : 120;

    if (!keyword) {
      return bookmarks.slice(0, limit);
    }

    return bookmarks
      .filter(
        (bookmark) =>
          bookmark.title.toLowerCase().includes(keyword) ||
          bookmark.url.toLowerCase().includes(keyword) ||
          bookmark.parentPath.toLowerCase().includes(keyword),
      )
      .slice(0, limit);
  }, [bookmarks, query, surface]);

  const toggleFolder = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <TooltipProvider>
      <section className="flex h-full min-h-0 flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <Card>
            <CardContent className="p-3">
              <div className="text-2xl font-semibold leading-none">{bookmarks.length}</div>
              <div className="mt-1 text-xs text-muted-foreground">书签</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="text-2xl font-semibold leading-none">{folders.length}</div>
              <div className="mt-1 text-xs text-muted-foreground">文件夹</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="space-y-3 p-3">
            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label>整理模式</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      安全模式只整理根目录或未分类书签；全量模式会重新审视所有书签。
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Select
                  onValueChange={(value) => onClassifyModeChange(value as ClassificationMode)}
                  value={classifyMode}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="safe">仅整理未分类</SelectItem>
                    <SelectItem value="full">重新分类全部</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                disabled={busy || bookmarks.length === 0}
                loading={busy}
                onClick={() => onCreatePlan(classifyMode)}
              >
                <Sparkles className="h-4 w-4" />
                生成
              </Button>
            </div>

            <div className="flex gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button disabled={busy} onClick={onRefresh} size="icon" variant="outline">
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>刷新书签</TooltipContent>
              </Tooltip>
              <Button
                className="flex-1"
                disabled={busy || !canUndo}
                onClick={onUndo}
                variant="outline"
              >
                <Undo2 className="h-4 w-4" />
                撤销上次整理
              </Button>
            </div>
          </CardContent>
        </Card>

        <Command>
          <CommandInput
            data-shuhai-search
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、URL 或文件夹"
            value={query}
          />
        </Command>

        <ScrollArea className="min-h-0 flex-1 rounded-lg border border-border bg-card">
          {bookmarks.length === 0 ? (
            <div className="space-y-2 p-6 text-center text-sm text-muted-foreground">
              <Folder className="mx-auto h-7 w-7" />
              <p>未检测到 Chrome 书签。</p>
              <p className="text-xs">请确认当前浏览器中已有书签，然后点击刷新。</p>
            </div>
          ) : (
            <div className="space-y-1 p-2">
              {visibleFolders.map((folder) => {
                const isCollapsed = collapsed.has(folder.path);
                const folderBookmarks = visibleBookmarks.filter(
                  (bookmark) => bookmark.parentPath === folder.path,
                );

                return (
                  <Collapsible
                    key={folder.id}
                    onOpenChange={() => toggleFolder(folder.path)}
                    open={!isCollapsed}
                  >
                    <div className="rounded-md border border-transparent transition hover:border-border hover:bg-muted/60">
                      <CollapsibleTrigger className="flex w-full items-center gap-2 px-2 py-2 text-left">
                        <ChevronRight
                          className={
                            isCollapsed
                              ? 'h-4 w-4 text-muted-foreground transition'
                              : 'h-4 w-4 rotate-90 text-muted-foreground transition'
                          }
                        />
                        <Folder className="h-4 w-4 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1 truncate text-sm">{folder.path}</span>
                        <Badge variant="secondary">{counts.get(folder.path) ?? 0}</Badge>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-none">
                        {folderBookmarks.length > 0 ? (
                          <ul className="space-y-1 pb-2 pl-10 pr-2">
                            {folderBookmarks.map((bookmark) => (
                              <li className="min-w-0 border-l border-border pl-2" key={bookmark.id}>
                                <div className="truncate text-xs font-medium">
                                  {bookmark.title || bookmark.url}
                                </div>
                                <div className="truncate text-[11px] text-muted-foreground">
                                  {bookmark.url}
                                </div>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </section>
    </TooltipProvider>
  );
}
