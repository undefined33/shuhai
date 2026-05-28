import { AI_BATCH_SIZE } from '@shuhai/shared';
import { classifyAllWithAi, testAiProviderConnection } from '../shared/ai-classifier.js';
import type {
  BookmarkItem,
  CapturedContent,
  ClassificationPortMessage,
  ClassificationPortRequest,
  ClassificationProgress,
  ClassificationMode,
  ExtensionRequest,
  ExtensionResponse,
  ExtensionState,
  UrlHealthPortMessage,
  UrlHealthPortRequest,
  UrlHealthProgress,
  UrlHealthRecord,
} from '../shared/bookmark-types.js';
import { generateClassificationPlan } from '../shared/classifier.js';
import { getLastMoveRecords, listBackups } from '../utils/backup.js';
import {
  applyClassificationPlan,
  flattenBookmarkTree,
  getFullTree,
  removeBookmarkWithBackup,
  updateBookmarkUrlWithBackup,
  undoMoveRecords,
} from '../utils/chrome-bookmarks.js';
import {
  clearPendingCapture,
  clearUrlHealthRecords,
  getExportManifests,
  getPendingCaptures,
  getSettings,
  normalizeSettings,
  getOnboarded,
  getUrlHealthRecords,
  removePendingCapture,
  savePendingCapture,
  saveOnboarded,
  saveSettings,
  saveUrlHealthRecords,
} from '../utils/storage.js';
import {
  checkBookmarkUrls,
} from '../utils/url-health.js';

let activeClassification: AbortController | undefined;
let activeHealthCheck: AbortController | undefined;

async function getState(): Promise<ExtensionState> {
  const tree = await getFullTree();
  const summary = flattenBookmarkTree(tree);
  const backups = await listBackups();
  const exportManifests = await getExportManifests();
  const lastMoveRecords = await getLastMoveRecords();
  const settings = await getSettings();
  const pendingCaptures = await getPendingCaptures();
  const urlHealthRecords = await getUrlHealthRecords();
  const onboarded = await getOnboarded();

  return {
    tree,
    bookmarks: summary.bookmarks,
    folders: summary.folders,
    backups,
    exportManifests,
    pendingCaptures,
    urlHealthRecords,
    lastMoveRecordCount: lastMoveRecords.length,
    onboarded,
    settings,
  };
}

async function createPlan(
  mode: ClassificationMode,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: ClassificationProgress) => void;
  } = {},
) {
  const tree = await getFullTree();
  const summary = flattenBookmarkTree(tree);
  const settings = await getSettings();
  const startedAt = Date.now();
  const total = summary.bookmarks.length;
  const initialProgress: ClassificationProgress = {
    done: 0,
    total,
    batch: 0,
    totalBatches: Math.ceil(total / AI_BATCH_SIZE),
    elapsedMs: 0,
  };

  options.onProgress?.(initialProgress);
  const aiSuggestions = await classifyAllWithAi(summary.bookmarks, settings, {
    mode,
    folders: summary.folders,
    signal: options.signal,
    onProgress: (_done, _total, _batch, _totalBatches, progress) => {
      options.onProgress?.(progress);
    },
  });
  const elapsedMs = Date.now() - startedAt;

  const plan = generateClassificationPlan(
    summary.bookmarks,
    summary.folders,
    settings.customRules,
    aiSuggestions,
    mode,
  );

  if (!options.signal?.aborted) {
    options.onProgress?.({
      done: total,
      total,
      batch: Math.ceil(total / AI_BATCH_SIZE),
      totalBatches: Math.ceil(total / AI_BATCH_SIZE),
      elapsedMs,
      remainingMs: 0,
    });
  }

  return plan;
}

function localDateKey(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
}

function getReusableTodayHealthRecords(
  records: UrlHealthRecord[],
  bookmarks: BookmarkItem[],
): UrlHealthRecord[] {
  const today = localDateKey(new Date());
  const bookmarkById = new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const recordById = new Map<string, UrlHealthRecord>();

  for (const record of records) {
    const bookmark = bookmarkById.get(record.bookmarkId);
    if (!bookmark) {
      continue;
    }

    if (localDateKey(record.checkedAt) === today && record.bookmarkUrl === bookmark.url) {
      recordById.set(record.bookmarkId, record);
    }
  }

  return bookmarks.flatMap((bookmark) => {
    const record = recordById.get(bookmark.id);
    return record ? [record] : [];
  });
}

async function checkBookmarkHealth(options: {
  bookmarkIds?: string[];
  signal?: AbortSignal;
  onProgress?: (progress: UrlHealthProgress, records: UrlHealthRecord[]) => void;
} = {}): Promise<{ records: UrlHealthRecord[]; progress: UrlHealthProgress }> {
  const tree = await getFullTree();
  const summary = flattenBookmarkTree(tree);
  const selectedIds = options.bookmarkIds ? new Set(options.bookmarkIds) : undefined;
  const bookmarks = selectedIds
    ? summary.bookmarks.filter((bookmark) => selectedIds.has(bookmark.id))
    : summary.bookmarks;
  const reusableRecords = getReusableTodayHealthRecords(await getUrlHealthRecords(), bookmarks);
  const reusableIds = new Set(reusableRecords.map((record) => record.bookmarkId));
  const uncheckedBookmarks = bookmarks.filter((bookmark) => !reusableIds.has(bookmark.id));
  const { records, progress } = await checkBookmarkUrls(uncheckedBookmarks, {
    initialRecords: reusableRecords,
    signal: options.signal,
    onProgress: options.onProgress,
    totalCount: bookmarks.length,
  });

  await saveUrlHealthRecords(records);

  return { records, progress };
}

function openSidePanelForTab(tab: chrome.tabs.Tab | undefined): Promise<void | undefined> {
  const windowId = tab?.windowId;
  if (typeof windowId === 'number' && chrome.sidePanel?.open) {
    return chrome.sidePanel.open({ windowId }).catch(() => undefined);
  }

  return Promise.resolve(undefined);
}

async function storeCapture(
  capture: CapturedContent | undefined,
  tab?: chrome.tabs.Tab,
): Promise<void> {
  if (!capture) {
    return;
  }

  await savePendingCapture(capture);
  await openSidePanelForTab(tab);
}

function requestCapture(tab: chrome.tabs.Tab | undefined, source: CapturedContent['source']): void {
  const tabId = tab?.id;
  if (typeof tabId !== 'number') {
    return;
  }

  chrome.tabs.sendMessage(
    tabId,
    { type: 'social:extract', source },
    (response: { ok?: boolean; data?: CapturedContent } | undefined) => {
      if (chrome.runtime.lastError || !response?.ok) {
        return;
      }

      void storeCapture(response.data, tab);
    },
  );
}

async function executeArticleExtractor(tabId: number): Promise<CapturedContent> {
  const injected = await new Promise<boolean>((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'article:ping' }, (response: { ok?: boolean } | undefined) => {
      resolve(!chrome.runtime.lastError && response?.ok === true);
    });
  });

  if (!injected) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/article.js'],
    });
  }

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: 'article:extract' },
      (response: { ok?: boolean; data?: CapturedContent; error?: string } | undefined) => {
        const runtimeError = chrome.runtime.lastError?.message;
        if (runtimeError) {
          reject(new Error(runtimeError));
          return;
        }

        if (!response?.ok || !response.data) {
          reject(new Error(response?.error ?? '无法提取当前页面正文'));
          return;
        }

        resolve(response.data);
      },
    );
  });
}

function requestArticleCapture(tab: chrome.tabs.Tab | undefined): void {
  const tabId = tab?.id;
  if (typeof tabId !== 'number') {
    return;
  }

  void executeArticleExtractor(tabId)
    .then((capture) => storeCapture(capture, tab))
    .catch(() => undefined);
}

async function handleRequest(request: ExtensionRequest): Promise<ExtensionResponse> {
  try {
    switch (request.type) {
      case 'state:get':
        return { ok: true, data: await getState() };
      case 'plan:create':
        return { ok: true, data: await createPlan(request.mode) };
      case 'plan:apply':
        return {
          ok: true,
          data: await applyClassificationPlan(request.plan, request.selectedMoveIds),
        };
      case 'plan:undoLast': {
        const records = await getLastMoveRecords();
        return { ok: true, data: { undone: await undoMoveRecords(records) } };
      }
      case 'settings:get':
        return { ok: true, data: await getSettings() };
      case 'settings:set': {
        const settings = normalizeSettings(request.settings);
        await saveSettings(settings);
        return { ok: true, data: settings };
      }
      case 'ai:testConnection':
        return { ok: true, data: await testAiProviderConnection(request.provider) };
      case 'onboarding:set':
        await saveOnboarded(request.onboarded);
        return { ok: true, data: { onboarded: request.onboarded } };
      case 'capture:getPending':
        return { ok: true, data: await getPendingCaptures() };
      case 'capture:removePending':
        return { ok: true, data: { removed: await removePendingCapture(request.id) } };
      case 'capture:clearPending':
        await clearPendingCapture();
        return { ok: true, data: { cleared: true } };
      case 'health:clearRecords':
        await clearUrlHealthRecords();
        return { ok: true, data: { cleared: true } };
      case 'bookmark:delete':
        return { ok: true, data: await removeBookmarkWithBackup(request.id) };
      case 'bookmark:updateUrl':
        return { ok: true, data: await updateBookmarkUrlWithBackup(request.id, request.url) };
      case 'backups:list':
        return { ok: true, data: await listBackups() };
      default:
        return { ok: false, error: 'Unsupported request' };
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function postClassificationMessage(port: chrome.runtime.Port, message: ClassificationPortMessage): void {
  try {
    port.postMessage(message);
  } catch {
    activeClassification?.abort();
  }
}

function handleClassificationPort(port: chrome.runtime.Port): void {
  let controller: AbortController | undefined;
  let lastProgress: ClassificationProgress = {
    done: 0,
    total: 0,
    batch: 0,
    totalBatches: 0,
    elapsedMs: 0,
  };

  port.onDisconnect.addListener(() => {
    controller?.abort();
    if (activeClassification === controller) {
      activeClassification = undefined;
    }
  });

  port.onMessage.addListener((message: ClassificationPortRequest) => {
    if (message.type === 'cancel') {
      controller?.abort();
      return;
    }

    if (message.type !== 'plan:create') {
      return;
    }

    controller?.abort();
    controller = new AbortController();
    activeClassification = controller;

    void createPlan(message.mode, {
      signal: controller.signal,
      onProgress: (progress) => {
        lastProgress = progress;
        postClassificationMessage(port, { type: 'progress', progress });
      },
    })
      .then((plan) => {
        postClassificationMessage(port, {
          type: 'complete',
          plan,
          progress: {
            ...lastProgress,
            cancelled: controller?.signal.aborted,
          },
          cancelled: Boolean(controller?.signal.aborted),
        });
      })
      .catch((error) => {
        postClassificationMessage(port, {
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (activeClassification === controller) {
          activeClassification = undefined;
        }
      });
  });
}

function postHealthMessage(port: chrome.runtime.Port, message: UrlHealthPortMessage): void {
  try {
    port.postMessage(message);
  } catch {
    activeHealthCheck?.abort();
  }
}

function handleHealthPort(port: chrome.runtime.Port): void {
  let controller: AbortController | undefined;

  port.onDisconnect.addListener(() => {
    controller?.abort();
    if (activeHealthCheck === controller) {
      activeHealthCheck = undefined;
    }
  });

  port.onMessage.addListener((message: UrlHealthPortRequest) => {
    if (message.type === 'cancel' || message.type === 'pause') {
      controller?.abort();
      return;
    }

    if (message.type !== 'health:check') {
      return;
    }

    controller?.abort();
    controller = new AbortController();
    activeHealthCheck = controller;

    void checkBookmarkHealth({
      bookmarkIds: message.bookmarkIds,
      signal: controller.signal,
      onProgress: (progress, records) => {
        postHealthMessage(port, { type: 'progress', progress, records });
      },
    })
      .then(({ records, progress }) => {
        postHealthMessage(port, {
          type: 'complete',
          progress,
          records,
          cancelled: Boolean(controller?.signal.aborted),
        });
      })
      .catch((error) => {
        postHealthMessage(port, {
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (activeHealthCheck === controller) {
          activeHealthCheck = undefined;
        }
      });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);
  }

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'shuhai-open',
      title: '打开 ShuHai 侧边栏',
      contexts: ['action'],
    });
    chrome.contextMenus.create({
      id: 'shuhai-save-article',
      title: '保存此文章到知识库',
      contexts: ['page', 'selection'],
    });
    chrome.contextMenus.create({
      id: 'shuhai-save-tweet',
      title: '保存此推文',
      contexts: ['page'],
      documentUrlPatterns: ['https://x.com/*', 'https://twitter.com/*'],
    });
    chrome.contextMenus.create({
      id: 'shuhai-save-weibo',
      title: '保存此微博',
      contexts: ['page'],
      documentUrlPatterns: ['https://weibo.com/*', 'https://m.weibo.cn/*'],
    });
  });
});

chrome.runtime.onMessage.addListener((message: ExtensionRequest, _sender, sendResponse) => {
  void handleRequest(message).then(sendResponse);
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'classify') {
    handleClassificationPort(port);
    return;
  }

  if (port.name === 'health') {
    handleHealthPort(port);
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'shuhai-open') {
    const windowId = tab?.windowId;
    if (typeof windowId === 'number' && chrome.sidePanel?.open) {
      void chrome.sidePanel.open({ windowId }).catch(() => undefined);
    }
    return;
  }

  if (info.menuItemId === 'shuhai-save-tweet') {
    requestCapture(tab, 'twitter');
    return;
  }

  if (info.menuItemId === 'shuhai-save-weibo') {
    requestCapture(tab, 'weibo');
    return;
  }

  if (info.menuItemId === 'shuhai-save-article') {
    requestArticleCapture(tab);
  }
});
