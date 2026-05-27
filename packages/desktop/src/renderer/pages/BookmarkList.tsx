import { useEffect, useMemo, useState } from 'react';
import type { ProcessedBookmark } from '@shuhai/shared';
import type { AppConfig } from '../../main/app-config.js';
import type { BookmarkClassification } from '../../main/bookmark-service.js';
import type { UrlCheckProgress } from '../../main/health/index.js';
import type { DeadLinkReviewItem, SyncStatus } from '../../preload.js';
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
  formatDeadLinkCheckedAt,
  formatDeadLinkFailure,
  formatSyncMessage,
  formatUrlCheckProgress,
  getDeadLinkReviewSummary,
  getEmptyBookmarkState,
  getSlowClassificationMessage,
  getSyncStatusView,
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
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [deadLinkReviewItems, setDeadLinkReviewItems] = useState<DeadLinkReviewItem[]>([]);
  const [selectedReviewIds, setSelectedReviewIds] = useState<Set<string>>(new Set());
  const [showDeadLinkReview, setShowDeadLinkReview] = useState(true);
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
    void window.shuhai.getSyncStatus().then(setSyncStatus);
    return window.shuhai.onSyncStatus(setSyncStatus);
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
  const syncStatusView = getSyncStatusView(syncStatus);
  const deadLinkSummary = getDeadLinkReviewSummary(deadLinkReviewItems);

  async function refreshBookmarks(options: { keepMessage?: boolean } = {}): Promise<void> {
    setIsLoading(true);
    if (!options.keepMessage) {
      setMessage(null);
    }
    try {
      const nextBookmarks = await window.shuhai.getBookmarks();
      setBookmarks(nextBookmarks);
      await refreshDeadLinkReviewItems();
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
      if (progress.dead > 0 || progress.errors > 0) {
        setShowDeadLinkReview(true);
      }
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

  async function refreshDeadLinkReviewItems(): Promise<void> {
    const items = await window.shuhai.getDeadLinkReviewItems();
    setDeadLinkReviewItems(items);
    setSelectedReviewIds((current) => {
      const nextIds = new Set(items.map((item) => item.bookmark.id));
      return new Set([...current].filter((id) => nextIds.has(id)));
    });
  }

  function toggleReviewSelection(id: string): void {
    setSelectedReviewIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAllDeadLinks(): void {
    setSelectedReviewIds(new Set(deadLinkReviewItems.map((item) => item.bookmark.id)));
  }

  async function copyReviewTitle(item: DeadLinkReviewItem): Promise<void> {
    try {
      await navigator.clipboard.writeText(item.bookmark.title || item.bookmark.url);
      setMessage(userMessage('success', '标题已复制，可以去搜索新链接。'));
    } catch (reason) {
      setMessage(errorMessage(reason, '复制失败，请手动选择标题后复制'));
    }
  }

  async function openReviewUrl(item: DeadLinkReviewItem): Promise<void> {
    try {
      await window.shuhai.openExternal(item.bookmark.url);
    } catch (reason) {
      setMessage(errorMessage(reason, '无法打开原链接，请检查 URL'));
    }
  }

  async function markReviewItemsReviewed(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    try {
      await window.shuhai.markBookmarksReviewed(ids);
      setMessage(userMessage('success', `已保留 ${ids.length} 条死链，后续检测会重新验证。`));
      await refreshDeadLinkReviewItems();
    } catch (reason) {
      setMessage(errorMessage(reason, '标记保留失败，请稍后重试'));
    }
  }

  async function removeReviewItems(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `确认从 ShuHai 移除 ${ids.length} 条书签？这不会删除 Chrome 原始书签。`,
    );
    if (!confirmed) {
      return;
    }

    try {
      await window.shuhai.removeBookmarks(ids);
      setMessage(userMessage('success', `已从 ShuHai 移除 ${ids.length} 条书签，Chrome 原始书签未改变。`));
      await refreshBookmarks({ keepMessage: true });
    } catch (reason) {
      setMessage(errorMessage(reason, '移除失败，请稍后重试'));
    }
  }

  async function replaceReviewUrl(item: DeadLinkReviewItem): Promise<void> {
    const nextUrl = window.prompt('粘贴新的 http/https 链接', item.bookmark.url);
    if (!nextUrl?.trim()) {
      return;
    }

    try {
      setMessage(userMessage('info', '正在替换链接并重新检测...'));
      await window.shuhai.updateBookmarkUrl(item.bookmark.id, nextUrl.trim());
      setMessage(userMessage('success', '链接已替换并重新检测，Chrome 原始书签未改变。'));
      await refreshBookmarks({ keepMessage: true });
    } catch (reason) {
      setMessage(errorMessage(reason, '替换链接失败，请确认新链接为 http/https 后重试'));
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

      <div className={syncStatusView.className}>
        <strong>{syncStatusView.label}</strong>
        <span>{syncStatusView.detail}</span>
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

      {deadLinkReviewItems.length > 0 && !showDeadLinkReview && (
        <div className="inline-feedback">
          <span>有 {deadLinkReviewItems.length} 条死链待审查</span>
          <button type="button" className="ghost" onClick={() => setShowDeadLinkReview(true)}>
            打开死链审查
          </button>
        </div>
      )}

      {deadLinkReviewItems.length > 0 && showDeadLinkReview && (
        <section className="dead-link-panel" aria-label="死链审查">
          <div className="dead-link-header">
            <div>
              <h2>死链审查</h2>
              <p>共 {deadLinkSummary.total} 个死链，已处理 {deadLinkSummary.handled} 个</p>
            </div>
            <div className="dead-link-actions">
              <button type="button" className="ghost" onClick={selectAllDeadLinks}>
                全选
              </button>
              <button
                type="button"
                className="ghost"
                disabled={selectedReviewIds.size === 0}
                onClick={() => markReviewItemsReviewed([...selectedReviewIds])}
              >
                批量保留
              </button>
              <button
                type="button"
                className="ghost danger"
                disabled={selectedReviewIds.size === 0}
                onClick={() => removeReviewItems([...selectedReviewIds])}
              >
                批量移除
              </button>
              <button type="button" className="ghost" onClick={() => setShowDeadLinkReview(false)}>
                稍后处理
              </button>
            </div>
          </div>
          <div className="dead-link-list">
            {deadLinkReviewItems.map((item) => (
              <article key={item.bookmark.id} className="dead-link-item">
                <label className="dead-link-select">
                  <input
                    type="checkbox"
                    checked={selectedReviewIds.has(item.bookmark.id)}
                    onChange={() => toggleReviewSelection(item.bookmark.id)}
                  />
                  <span>选择</span>
                </label>
                <div className="dead-link-main">
                  <button
                    type="button"
                    className="text-button"
                    title="复制标题"
                    onClick={() => copyReviewTitle(item)}
                  >
                    {item.bookmark.title || item.bookmark.url}
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    title={item.bookmark.url}
                    onClick={() => openReviewUrl(item)}
                  >
                    {item.bookmark.url}
                  </button>
                  <div className="dead-link-meta">
                    <span>{formatDeadLinkFailure(item)}</span>
                    <span>{formatDeadLinkCheckedAt(item)}</span>
                    {item.bookmark.reviewedAt && <span>已审查</span>}
                  </div>
                </div>
                <div className="dead-link-row-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => markReviewItemsReviewed([item.bookmark.id])}
                  >
                    保留
                  </button>
                  <button type="button" className="ghost" onClick={() => replaceReviewUrl(item)}>
                    替换链接
                  </button>
                  <button
                    type="button"
                    className="ghost danger"
                    onClick={() => removeReviewItems([item.bookmark.id])}
                  >
                    从 ShuHai 移除
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

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
