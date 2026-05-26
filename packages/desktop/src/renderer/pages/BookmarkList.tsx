import { useEffect, useMemo, useState } from 'react';
import type { ProcessedBookmark } from '@shuhai/shared';
import type { AppConfig } from '../../main/app-config.js';
import type { BookmarkClassification } from '../../main/bookmark-service.js';
import type { UrlCheckProgress } from '../../main/health/index.js';
import { BookmarkCard } from '../components/BookmarkCard.js';
import { formatSyncMessage, formatUrlCheckProgress } from './bookmark-list-view-model.js';

interface BookmarkListProps {
  config: AppConfig;
  onConfigChange: (config: AppConfig) => void;
}

type ExportState = 'idle' | 'exporting' | 'done' | 'error';

export function BookmarkList({ config, onConfigChange }: BookmarkListProps) {
  const [bookmarks, setBookmarks] = useState<ProcessedBookmark[]>([]);
  const [classifications, setClassifications] = useState<Map<string, BookmarkClassification>>(
    new Map(),
  );
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [isLoading, setIsLoading] = useState(true);
  const [isClassifying, setIsClassifying] = useState(false);
  const [isCheckingLinks, setIsCheckingLinks] = useState(false);
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [urlCheckProgress, setUrlCheckProgress] = useState<UrlCheckProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    refreshBookmarks();
  }, [config.chromeProfile]);

  useEffect(() => {
    return window.shuhai.onBookmarksChanged((result) => {
      setMessage(formatSyncMessage(result));
      void refreshBookmarks({ keepMessage: true });
    });
  }, [config.chromeProfile]);

  useEffect(() => {
    return window.shuhai.onUrlCheckProgress((progress) => {
      setUrlCheckProgress(progress);
      setMessage(formatUrlCheckProgress(progress));
    });
  }, []);

  const visibleBookmarks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return bookmarks.filter((bookmark) => {
      const classification = classifications.get(bookmark.url);
      const currentCategory = classification?.category ?? bookmark.category;
      const matchesCategory = category === '全部' || currentCategory === category;
      const matchesQuery = normalizedQuery
        ? `${bookmark.title} ${bookmark.url}`.toLowerCase().includes(normalizedQuery)
        : true;
      return matchesCategory && matchesQuery;
    });
  }, [bookmarks, category, classifications, query]);

  const categories = useMemo(() => {
    const values = new Set<string>();
    for (const bookmark of bookmarks) {
      values.add(classifications.get(bookmark.url)?.category ?? bookmark.category);
    }
    return ['全部', ...Array.from(values).sort((a, b) => a.localeCompare(b))];
  }, [bookmarks, classifications]);

  async function refreshBookmarks(options: { keepMessage?: boolean } = {}): Promise<void> {
    setIsLoading(true);
    if (!options.keepMessage) {
      setMessage(null);
    }
    try {
      const nextBookmarks = await window.shuhai.getBookmarks();
      setBookmarks(nextBookmarks);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsLoading(false);
    }
  }

  async function checkLinks(): Promise<void> {
    setIsCheckingLinks(true);
    setUrlCheckProgress(null);
    setMessage(null);
    try {
      const progress = await window.shuhai.startUrlCheck();
      setUrlCheckProgress(progress);
      setMessage(`检测完成：${progress.completed}/${progress.total}，发现 ${progress.dead} 个死链`);
      await refreshBookmarks({ keepMessage: true });
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsCheckingLinks(false);
    }
  }

  async function classifyVisibleBookmarks(): Promise<void> {
    setIsClassifying(true);
    setMessage(null);
    try {
      const result = await window.shuhai.classifyBookmarks(visibleBookmarks.map((item) => item.url));
      setClassifications(new Map(result));
      setMessage(`已分类 ${result.size} 条书签`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsClassifying(false);
    }
  }

  async function exportBookmarks(): Promise<void> {
    setExportState('exporting');
    setMessage(null);
    try {
      const result = await window.shuhai.exportBookmarks(
        visibleBookmarks.map((bookmark) => applyClassification(bookmark, classifications)),
      );
      setExportState(result.errors.length > 0 ? 'error' : 'done');
      setMessage(`导出 ${result.exported} 条，跳过 ${result.skipped} 条`);
    } catch (reason) {
      setExportState('error');
      setMessage(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function openSettingsSetup(): Promise<void> {
    const nextConfig = await window.shuhai.setConfig({ ...config, firstRunComplete: false });
    onConfigChange(nextConfig);
  }

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Chrome Profile: {config.chromeProfile}</p>
          <h1>书签列表</h1>
        </div>
        <button type="button" className="ghost" onClick={openSettingsSetup}>
          重新向导
        </button>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索标题或 URL"
        />
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => refreshBookmarks()} disabled={isLoading}>
          刷新
        </button>
        <button
          type="button"
          onClick={classifyVisibleBookmarks}
          disabled={isClassifying || visibleBookmarks.length === 0}
        >
          {isClassifying ? '分类中...' : 'AI 分类'}
        </button>
        <button
          type="button"
          onClick={checkLinks}
          disabled={isCheckingLinks || bookmarks.length === 0}
        >
          {isCheckingLinks ? '检测中...' : '检测链接'}
        </button>
        <button
          type="button"
          onClick={exportBookmarks}
          disabled={exportState === 'exporting' || visibleBookmarks.length === 0}
        >
          {exportState === 'exporting' ? '导出中...' : '导出到 Obsidian'}
        </button>
      </div>

      {message && <p className={exportState === 'error' ? 'alert' : 'notice'}>{message}</p>}

      <div className="list-meta">
        <span>{isLoading ? '读取中...' : `${visibleBookmarks.length} / ${bookmarks.length} 条`}</span>
        <span>
          {urlCheckProgress
            ? formatUrlCheckProgress(urlCheckProgress)
            : config.vaultPath || '未配置 Vault'}
        </span>
      </div>

      <div className="bookmark-list">
        {visibleBookmarks.map((bookmark) => (
          <BookmarkCard
            key={bookmark.id}
            bookmark={applyClassification(bookmark, classifications)}
          />
        ))}
        {!isLoading && visibleBookmarks.length === 0 && (
          <div className="empty-state">没有匹配的书签</div>
        )}
      </div>
    </section>
  );
}

function applyClassification(
  bookmark: ProcessedBookmark,
  classifications: Map<string, BookmarkClassification>,
): ProcessedBookmark {
  const classification = classifications.get(bookmark.url);
  if (!classification) {
    return bookmark;
  }

  return {
    ...bookmark,
    category: classification.category,
    aiTags: classification.tags,
    confidence: classification.confidence,
  };
}
