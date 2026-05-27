import { useEffect, useMemo, useState } from 'react';
import type { ProcessedBookmark } from '@shuhai/shared';
import type { AppConfig } from '../../main/app-config.js';
import type { BookmarkClassification } from '../../main/bookmark-service.js';
import type { UrlCheckProgress } from '../../main/health/index.js';
import { BookmarkCard } from '../components/BookmarkCard.js';
import {
  MESSAGE_AUTO_DISMISS_MS,
  errorMessage,
  messageClassName,
  userMessage,
  type UserMessage,
} from '../message.js';
import {
  classificationRecordToMap,
  formatSyncMessage,
  formatUrlCheckProgress,
  getEmptyBookmarkState,
  getSlowClassificationMessage,
  getWorkflowGuide,
} from './bookmark-list-view-model.js';

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
  const [classificationElapsedMs, setClassificationElapsedMs] = useState(0);
  const [lastExportPath, setLastExportPath] = useState<string | null>(null);
  const [message, setMessage] = useState<UserMessage | null>(null);

  useEffect(() => {
    refreshBookmarks();
  }, [config.chromeProfile]);

  useEffect(() => {
    return window.shuhai.onBookmarksChanged((result) => {
      setMessage(userMessage('info', formatSyncMessage(result)));
      void refreshBookmarks({ keepMessage: true });
    });
  }, [config.chromeProfile]);

  useEffect(() => {
    return window.shuhai.onUrlCheckProgress((progress) => {
      setUrlCheckProgress(progress);
      setMessage(userMessage('info', formatUrlCheckProgress(progress)));
    });
  }, []);

  useEffect(() => {
    if (!message) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setMessage(null);
    }, MESSAGE_AUTO_DISMISS_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [message]);

  useEffect(() => {
    if (!isClassifying) {
      setClassificationElapsedMs(0);
      return undefined;
    }

    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      setClassificationElapsedMs(Date.now() - startedAt);
    }, 1_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isClassifying]);

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

  const classifiedCount = useMemo(() => {
    const urls = new Set(classifications.keys());
    for (const bookmark of bookmarks) {
      if (bookmark.category !== '未分类' || (bookmark.aiTags?.length ?? 0) > 0) {
        urls.add(bookmark.url);
      }
    }
    return urls.size;
  }, [bookmarks, classifications]);

  const checkedCount = useMemo(() => {
    return bookmarks.filter((bookmark) => bookmark.status !== 'unchecked').length;
  }, [bookmarks]);

  const hasAiProvider = config.ai.provider !== 'none' && Boolean(config.ai.apiKey?.trim());
  const hasVaultPath = config.vaultPath.trim().length > 0;
  const workflowGuide = getWorkflowGuide({
    bookmarkCount: bookmarks.length,
    visibleCount: visibleBookmarks.length,
    classifiedCount,
    checkedCount,
    exportState,
    isClassifying,
    isCheckingLinks,
    hasVaultPath,
    hasAiProvider,
    isLoading,
  });
  const slowClassificationMessage = getSlowClassificationMessage(
    classificationElapsedMs,
    hasAiProvider,
  );
  const emptyState = getEmptyBookmarkState(bookmarks.length, visibleBookmarks.length);

  async function refreshBookmarks(options: { keepMessage?: boolean } = {}): Promise<void> {
    setIsLoading(true);
    if (!options.keepMessage) {
      setMessage(null);
    }
    try {
      const nextBookmarks = await window.shuhai.getBookmarks();
      setBookmarks(nextBookmarks);
    } catch (reason) {
      setMessage(errorMessage(reason, '读取书签失败，请确认 Chrome Profile 正确或稍后重试'));
    } finally {
      setIsLoading(false);
    }
  }

  async function checkLinks(): Promise<void> {
    setIsCheckingLinks(true);
    setExportState('idle');
    setUrlCheckProgress(null);
    setMessage(null);
    try {
      const progress = await window.shuhai.startUrlCheck();
      setUrlCheckProgress(progress);
      setMessage(userMessage(
        'success',
        `检测完成：${progress.completed}/${progress.total}，发现 ${progress.dead} 个死链`,
      ));
      await refreshBookmarks({ keepMessage: true });
    } catch (reason) {
      setMessage(errorMessage(reason, '检测链接失败，请检查网络后重试'));
    } finally {
      setIsCheckingLinks(false);
    }
  }

  async function classifyVisibleBookmarks(): Promise<void> {
    setIsClassifying(true);
    setExportState('idle');
    setMessage(userMessage(
      'info',
      `正在分类 ${visibleBookmarks.length} 条书签，结果会保存到 ShuHai 本地库。`,
    ));
    try {
      const result = await window.shuhai.classifyBookmarks(visibleBookmarks.map((item) => item.url));
      const nextClassifications = classificationRecordToMap(result);
      setClassifications(nextClassifications);
      setMessage(userMessage(
        'success',
        `已分类 ${nextClassifications.size} 条书签，下一步可检测链接或导出到 Obsidian`,
      ));
    } catch (reason) {
      setMessage(errorMessage(reason, '分类失败，请检查 AI 设置或稍后重试'));
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
      setLastExportPath(config.vaultPath);
      setMessage(userMessage(
        result.errors.length > 0 ? 'error' : 'success',
        result.errors.length > 0
          ? `导出 ${result.exported} 条，跳过 ${result.skipped} 条。请检查错误后重试。`
          : `导出 ${result.exported} 条，跳过 ${result.skipped} 条。文件已写入 ${config.vaultPath}`,
      ));
    } catch (reason) {
      setExportState('error');
      setLastExportPath(null);
      setMessage(errorMessage(reason, '导出失败，请确认 Vault 路径和文件权限后重试'));
    }
  }

  async function openExportLocation(): Promise<void> {
    if (!lastExportPath) {
      return;
    }

    try {
      await window.shuhai.showItemInFolder(lastExportPath);
    } catch (reason) {
      setMessage(errorMessage(reason, '无法打开导出目录，请手动检查 Vault 路径'));
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

      <div className={`workflow-panel ${workflowGuide.tone}`}>
        <div className="workflow-next">
          <span>{workflowGuide.title}</span>
          <strong>{workflowGuide.nextAction}</strong>
        </div>
        <ol className="workflow-steps" aria-label="导出流程">
          {workflowGuide.steps.map((step) => (
            <li key={step.id} className={`workflow-step ${step.status}`}>
              <span>{step.label}</span>
              <small>{step.detail}</small>
            </li>
          ))}
        </ol>
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
          disabled={
            isClassifying
            || isCheckingLinks
            || exportState === 'exporting'
            || visibleBookmarks.length === 0
          }
        >
          {isClassifying ? '分类中...' : 'AI 分类'}
        </button>
        <button
          type="button"
          onClick={checkLinks}
          disabled={
            isClassifying
            || isCheckingLinks
            || exportState === 'exporting'
            || bookmarks.length === 0
          }
        >
          {isCheckingLinks ? '检测中...' : '检测链接'}
        </button>
        <button
          type="button"
          onClick={exportBookmarks}
          disabled={
            isClassifying
            || isCheckingLinks
            || exportState === 'exporting'
            || visibleBookmarks.length === 0
            || !hasVaultPath
          }
        >
          {exportState === 'exporting' ? '导出中...' : '导出到 Obsidian'}
        </button>
      </div>

      {message && (
        <p className={messageClassName(message)} aria-live="polite">
          {message.text}
        </p>
      )}
      {lastExportPath && exportState === 'done' && (
        <div className="inline-feedback">
          <span>导出位置：{lastExportPath}</span>
          <button type="button" className="ghost" onClick={openExportLocation}>
            在文件管理器中打开
          </button>
        </div>
      )}
      {slowClassificationMessage && (
        <p className="notice warning" aria-live="polite">{slowClassificationMessage}</p>
      )}

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
            onOpenError={(text) => setMessage(userMessage('error', text))}
          />
        ))}
        {!isLoading && emptyState && (
          <div className="empty-state">
            <strong>{emptyState.title}</strong>
            <span>{emptyState.detail}</span>
            {bookmarks.length === 0 && (
              <button type="button" onClick={() => refreshBookmarks()}>
                刷新
              </button>
            )}
          </div>
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
