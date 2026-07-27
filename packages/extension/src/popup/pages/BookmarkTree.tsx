import type { KeyboardEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Folder, Link2, RefreshCw } from 'lucide-react';
import type { BookmarkItem, FolderItem } from '../../shared/bookmark-types.js';
import { VirtualList } from '../../components/VirtualList.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Command, CommandInput } from '../../components/ui/command.js';
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
  onRefresh(): void;
  surface?: 'popup' | 'sidepanel';
}

type FlatRow =
  | {
      type: 'folder';
      folder: FolderItem;
      count: number;
      expanded: boolean;
    }
  | {
      type: 'bookmark';
      bookmark: BookmarkItem;
      depth: number;
    };

function countByFolder(bookmarks: BookmarkItem[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const bookmark of bookmarks) {
    counts.set(bookmark.parentPath, (counts.get(bookmark.parentPath) ?? 0) + 1);
  }

  return counts;
}

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
}

function includesKeyword(value: string, keyword: string): boolean {
  return value.toLowerCase().includes(keyword);
}

function highlightedText(value: string, keyword: string) {
  if (!keyword) {
    return value;
  }

  const lowerValue = value.toLowerCase();
  const index = lowerValue.indexOf(keyword);
  if (index < 0) {
    return value;
  }

  return (
    <>
      {value.slice(0, index)}
      <mark className="rounded bg-accent-soft px-0.5 text-accent">
        {value.slice(index, index + keyword.length)}
      </mark>
      {value.slice(index + keyword.length)}
    </>
  );
}

function flattenVisibleRows(
  folders: FolderItem[],
  bookmarks: BookmarkItem[],
  collapsed: Set<string>,
  keyword: string,
): FlatRow[] {
  const rows: FlatRow[] = [];
  const bookmarksByFolder = new Map<string, BookmarkItem[]>();

  for (const bookmark of bookmarks) {
    const list = bookmarksByFolder.get(bookmark.parentPath) ?? [];
    list.push(bookmark);
    bookmarksByFolder.set(bookmark.parentPath, list);
  }

  for (const folder of folders.filter((item) => item.path)) {
    const folderBookmarks = bookmarksByFolder.get(folder.path) ?? [];
    const matchingBookmarks = keyword
      ? folderBookmarks.filter(
          (bookmark) =>
            includesKeyword(bookmark.title, keyword) ||
            includesKeyword(bookmark.url, keyword) ||
            includesKeyword(bookmark.parentPath, keyword),
        )
      : folderBookmarks;
    const folderMatches = keyword ? includesKeyword(folder.path, keyword) : true;

    if (!folderMatches && matchingBookmarks.length === 0) {
      continue;
    }

    const expanded = keyword ? true : !collapsed.has(folder.path);
    rows.push({
      count: folderBookmarks.length,
      expanded,
      folder,
      type: 'folder',
    });

    if (expanded) {
      for (const bookmark of matchingBookmarks) {
        rows.push({
          bookmark,
          depth: 1,
          type: 'bookmark',
        });
      }
    }
  }

  return rows;
}

export default function BookmarkTree({
  bookmarks,
  folders,
  busy,
  onRefresh,
  surface = 'popup',
}: BookmarkTreeProps) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [focusedIndex, setFocusedIndex] = useState(0);
  const debouncedQuery = useDebouncedValue(query, 300);
  const keyword = debouncedQuery.trim().toLowerCase();
  const counts = useMemo(() => countByFolder(bookmarks), [bookmarks]);
  const rows = useMemo(
    () => flattenVisibleRows(folders, bookmarks, collapsed, keyword),
    [bookmarks, collapsed, folders, keyword],
  );

  useEffect(() => {
    setFocusedIndex((current) => Math.min(current, Math.max(0, rows.length - 1)));
  }, [rows.length]);

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

  const handleKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setFocusedIndex((current) => Math.min(rows.length - 1, current + 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setFocusedIndex((current) => Math.max(0, current - 1));
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      const row = rows[focusedIndex];
      if (row?.type === 'folder') {
        event.preventDefault();
        toggleFolder(row.folder.path);
      }
    }
  };

  return (
    <TooltipProvider>
      <section className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex items-center gap-2">
          <Command className="min-w-0 flex-1">
            <CommandInput
              data-shuhai-search
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题、URL 或文件夹"
              value={query}
            />
          </Command>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="刷新 Chrome 书签"
                disabled={busy}
                onClick={onRefresh}
                size="icon"
                variant="outline"
              >
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>刷新 Chrome 书签</TooltipContent>
          </Tooltip>
        </div>
        <p className="text-[12.5px] leading-5 text-muted-foreground">
          {bookmarks.length.toLocaleString()} 个书签 · {folders.length.toLocaleString()} 个文件夹
          {keyword ? ` · ${rows.length.toLocaleString()} 个匹配项` : ''}
        </p>

        <VirtualList
          ariaLabel="Chrome 书签树"
          className="min-h-0 flex-1 rounded-lg border border-border bg-card p-2"
          emptyState={
            <div className="space-y-2 p-6 text-center text-sm text-muted-foreground">
              <Folder className="mx-auto h-7 w-7" />
              <p>{bookmarks.length === 0 ? '未检测到 Chrome 书签。' : '没有匹配的书签。'}</p>
              <p className="text-[12px]">
                {bookmarks.length === 0
                  ? '请确认当前浏览器中已有书签，然后点击刷新。'
                  : '可以换一个标题、URL 或文件夹关键词。'}
              </p>
            </div>
          }
          estimatedHeight={surface === 'sidepanel' ? 520 : 300}
          itemHeight={52}
          items={rows}
          onKeyDown={handleKeyboard}
          renderItem={(row, index) => {
            const focused = index === focusedIndex;
            if (row.type === 'folder') {
              return (
                <button
                  className={
                    focused
                      ? 'flex h-12 w-full items-center gap-2 rounded-md border border-primary bg-accent px-2 text-left'
                      : 'flex h-12 w-full items-center gap-2 rounded-md border border-transparent px-2 text-left transition hover:border-border hover:bg-muted/60'
                  }
                  onClick={() => toggleFolder(row.folder.path)}
                  type="button"
                >
                  <ChevronRight
                    className={
                      row.expanded
                        ? 'h-4 w-4 rotate-90 text-muted-foreground transition'
                        : 'h-4 w-4 text-muted-foreground transition'
                    }
                  />
                  <Folder className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {highlightedText(row.folder.path, keyword)}
                  </span>
                  <Badge className="text-[12px]" variant="secondary">
                    {counts.get(row.folder.path) ?? row.count}
                  </Badge>
                </button>
              );
            }

            return (
              <div
                className={
                  focused
                    ? 'ml-8 flex h-12 min-w-0 flex-col justify-center rounded-md border border-primary bg-accent px-2'
                    : 'ml-8 flex h-12 min-w-0 flex-col justify-center rounded-md border border-transparent px-2'
                }
              >
                <div className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                  <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">
                    {highlightedText(row.bookmark.title || row.bookmark.url, keyword)}
                  </span>
                </div>
                <div className="truncate text-[12px] text-muted-foreground">
                  {highlightedText(row.bookmark.url, keyword)}
                </div>
              </div>
            );
          }}
        />
      </section>
    </TooltipProvider>
  );
}
