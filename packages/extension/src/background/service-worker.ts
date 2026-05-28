import { classifyAllWithDeepSeek } from '../shared/ai-classifier.js';
import type {
  CapturedContent,
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
  getPendingCapture,
  getSettings,
  savePendingCapture,
  saveSettings,
} from '../utils/storage.js';

async function getState(): Promise<ExtensionState> {
  const tree = await getFullTree();
  const summary = flattenBookmarkTree(tree);
  const backups = await listBackups();
  const exportManifests = await getExportManifests();
  const lastMoveRecords = await getLastMoveRecords();
  const settings = await getSettings();
  const pendingCapture = await getPendingCapture();

  return {
    tree,
    bookmarks: summary.bookmarks,
    folders: summary.folders,
    backups,
    exportManifests,
    pendingCapture,
    lastMoveRecordCount: lastMoveRecords.length,
    settings,
  };
}

async function createPlan(mode: ClassificationMode) {
  const tree = await getFullTree();
  const summary = flattenBookmarkTree(tree);
  const settings = await getSettings();
  const aiSuggestions = await classifyAllWithDeepSeek(summary.bookmarks, settings, {
    mode,
    folders: summary.folders,
  });

  return generateClassificationPlan(
    summary.bookmarks,
    summary.folders,
    settings.customRules,
    aiSuggestions,
    mode,
  );
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
      case 'capture:getPending':
        return { ok: true, data: await getPendingCapture() };
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

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'shuhai-open',
    title: '打开 ShuHai 书签整理',
    contexts: ['action'],
  });
  chrome.contextMenus.create({
    id: 'shuhai-save-page',
    title: '保存到 ShuHai 知识库',
    contexts: ['page'],
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

chrome.runtime.onMessage.addListener((message: ExtensionRequest, _sender, sendResponse) => {
  void handleRequest(message).then(sendResponse);
  return true;
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'shuhai-save-tweet') {
    requestCapture(tab?.id, 'twitter');
    return;
  }

  if (info.menuItemId === 'shuhai-save-weibo') {
    requestCapture(tab?.id, 'weibo');
    return;
  }

  if (info.menuItemId === 'shuhai-save-page' && info.pageUrl) {
    storeCapture({
      id: crypto.randomUUID(),
      source: 'page',
      title: info.pageUrl,
      url: info.pageUrl,
      text: '',
      media: [],
      tags: [],
      capturedAt: new Date().toISOString(),
    });
  }
});
