import { AI_BATCH_SIZE } from '@shuhai/shared';
import { classifyAllWithDeepSeek } from '../shared/ai-classifier.js';
import type {
  CapturedContent,
  ClassificationPortMessage,
  ClassificationPortRequest,
  ClassificationProgress,
  ClassificationMode,
  ExtensionRequest,
  ExtensionResponse,
  ExtensionState,
} from '../shared/bookmark-types.js';
import { generateClassificationPlan } from '../shared/classifier.js';
import { getLastMoveRecords, listBackups } from '../utils/backup.js';
import {
  applyClassificationPlan,
  flattenBookmarkTree,
  getFullTree,
  undoMoveRecords,
} from '../utils/chrome-bookmarks.js';
import {
  clearPendingCapture,
  getExportManifests,
  getPendingCaptures,
  getSettings,
  getOnboarded,
  removePendingCapture,
  savePendingCapture,
  saveOnboarded,
  saveSettings,
} from '../utils/storage.js';

let activeClassification: AbortController | undefined;

async function getState(): Promise<ExtensionState> {
  const tree = await getFullTree();
  const summary = flattenBookmarkTree(tree);
  const backups = await listBackups();
  const exportManifests = await getExportManifests();
  const lastMoveRecords = await getLastMoveRecords();
  const settings = await getSettings();
  const pendingCaptures = await getPendingCaptures();
  const onboarded = await getOnboarded();

  return {
    tree,
    bookmarks: summary.bookmarks,
    folders: summary.folders,
    backups,
    exportManifests,
    pendingCaptures,
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
  const aiSuggestions = await classifyAllWithDeepSeek(summary.bookmarks, settings, {
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

function storeCapture(capture: CapturedContent | undefined): void {
  if (!capture) {
    return;
  }

  void savePendingCapture(capture);
}

function requestCapture(tabId: number | undefined, source: CapturedContent['source']): void {
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

      storeCapture(response.data);
    },
  );
}

async function executeArticleExtractor(tabId: number): Promise<CapturedContent> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/article.js'],
  });

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
    .then((capture) => savePendingCapture(capture))
    .then(() => {
      const windowId = tab?.windowId;
      if (typeof windowId === 'number' && chrome.sidePanel?.open) {
        return chrome.sidePanel.open({ windowId }).catch(() => undefined);
      }

      return undefined;
    })
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
      case 'settings:set':
        await saveSettings(request.settings);
        return { ok: true, data: request.settings };
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
    requestCapture(tab?.id, 'twitter');
    return;
  }

  if (info.menuItemId === 'shuhai-save-weibo') {
    requestCapture(tab?.id, 'weibo');
    return;
  }

  if (info.menuItemId === 'shuhai-save-article') {
    requestArticleCapture(tab);
  }
});
