import { useMemo, useState } from 'react';
import type { BookmarkItem, FolderItem } from '../../shared/bookmark-types.js';

interface BookmarkTreeProps {
  bookmarks: BookmarkItem[];
  folders: FolderItem[];
  busy: boolean;
  canUndo: boolean;
  onCreatePlan(): void;
  onRefresh(): void;
  onUndo(): void;
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
  onCreatePlan,
  onRefresh,
  onUndo,
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

    if (!keyword) {
      return bookmarks.slice(0, 80);
    }

    return bookmarks
      .filter(
        (bookmark) =>
          bookmark.title.toLowerCase().includes(keyword) ||
          bookmark.url.toLowerCase().includes(keyword) ||
          bookmark.parentPath.toLowerCase().includes(keyword),
      )
      .slice(0, 80);
  }, [bookmarks, query]);

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
    <section className="panel">
      <div className="actions">
        <button onClick={onRefresh} disabled={busy}>
          刷新
        </button>
        <button className="primary" onClick={onCreatePlan} disabled={busy || bookmarks.length === 0}>
          整理书签
        </button>
        <button onClick={onUndo} disabled={busy || !canUndo}>
          撤销上次整理
        </button>
      </div>

      <label className="search">
        <span>搜索</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="标题、URL 或文件夹"
        />
      </label>

      <div className="summary-grid">
        <div>
          <strong>{bookmarks.length}</strong>
          <span>书签</span>
        </div>
        <div>
          <strong>{folders.length}</strong>
          <span>文件夹</span>
        </div>
      </div>

      <div className="tree-list">
        {visibleFolders.map((folder) => {
          const isCollapsed = collapsed.has(folder.path);
          const folderBookmarks = visibleBookmarks.filter(
            (bookmark) => bookmark.parentPath === folder.path,
          );

          return (
            <div className="folder-row" key={folder.id}>
              <button className="folder-toggle" onClick={() => toggleFolder(folder.path)}>
                {isCollapsed ? '+' : '-'}
              </button>
              <div className="folder-body">
                <div className="folder-title">
                  <span>{folder.path}</span>
                  <em>{counts.get(folder.path) ?? 0}</em>
                </div>
                {!isCollapsed && folderBookmarks.length > 0 ? (
                  <ul>
                    {folderBookmarks.map((bookmark) => (
                      <li key={bookmark.id}>
                        <span>{bookmark.title || bookmark.url}</span>
                        <small>{bookmark.url}</small>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
