import { AI_BATCH_SIZE } from '@shuhai/shared';
import { classifyAllWithAi, testAiProviderConnection } from '../shared/ai-classifier.js';
import type {
  BookmarkItem,
  CapturedContent,
  ClassificationPortMessage,
  ClassificationPortRequest,
  ClassificationProgress,
  ClassificationMode,
  DiagnosticReport,
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
  getOnboardingProgress,
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
import { checkBookmarkUrl, checkBookmarkUrls } from '../utils/url-health.js';
import {
  addActivityEntry,
  summarizeClassifyApply,
  summarizeClassifyUndo,
} from '../utils/activity-log.js';
import { inferErrorCode } from '../utils/error-messages.js';
import { saveExtractorDiagnostic } from '../utils/extractor-diagnostics.js';

type SocialCaptureSource = 'twitter' | 'weibo';

interface SocialExtractResponse {
  ok?: boolean;
  data?: CapturedContent;
  error?: string;
  diagnostic?: DiagnosticReport;
}

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

async function checkBookmarkHealth(
  options: {
    bookmarkIds?: string[];
    signal?: AbortSignal;
    onProgress?: (progress: UrlHealthProgress, records: UrlHealthRecord[]) => void;
  } = {},
): Promise<{ records: UrlHealthRecord[]; progress: UrlHealthProgress }> {
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

function replaceUrlHealthRecord(
  records: UrlHealthRecord[],
  nextRecord: UrlHealthRecord,
): UrlHealthRecord[] {
  const nextRecords: UrlHealthRecord[] = [];
  let inserted = false;

  for (const record of records) {
    if (record.bookmarkId === nextRecord.bookmarkId) {
      if (!inserted) {
        nextRecords.push(nextRecord);
        inserted = true;
      }
      continue;
    }

    nextRecords.push(record);
  }

  if (!inserted) {
    nextRecords.push(nextRecord);
  }

  return nextRecords;
}

async function retryBookmarkHealth(
  bookmarkId: string,
): Promise<{ record: UrlHealthRecord; records: UrlHealthRecord[] }> {
  const tree = await getFullTree();
  const summary = flattenBookmarkTree(tree);
  const bookmark = summary.bookmarks.find((item) => item.id === bookmarkId);

  if (!bookmark) {
    throw new Error('书签不存在，可能已经被删除');
  }

  const record = await checkBookmarkUrl(bookmark);
  const records = replaceUrlHealthRecord(await getUrlHealthRecords(), record);
  await saveUrlHealthRecords(records);

  return { record, records };
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
): Promise<CapturedContent | undefined> {
  if (!capture) {
    return undefined;
  }

  await savePendingCapture(capture);
  await addActivityEntry({
    type: 'capture_save',
    summary: `保存了「${capture.title}」(${capture.source})`,
    details: [{ label: capture.title, meta: capture.url }],
  });
  await openSidePanelForTab(tab);
  await showTabToast(tab, '已提取到 ShuHai · 打开侧边栏写入 Vault →', 'success');

  return capture;
}

async function showTabToast(
  tab: chrome.tabs.Tab | undefined,
  message: string,
  kind: 'success' | 'error' | 'info' = 'success',
): Promise<void> {
  const tabId = tab?.id;
  if (typeof tabId !== 'number') {
    return;
  }

  const payload = { type: 'toast:show', message, kind };

  try {
    await chrome.tabs.sendMessage(tabId, payload);
    return;
  } catch {
    // The toast listener is injected lazily so ordinary pages stay untouched.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/toast.js'],
    });
    await chrome.tabs.sendMessage(tabId, payload);
  } catch {
    // Toast is best-effort feedback; capture success should not fail because of it.
  }
}

function socialDetailMessage(source: SocialCaptureSource): string {
  return source === 'twitter'
    ? '请先打开一条推文的详情页（点击推文进入）'
    : '请先打开一条微博的详情页';
}

function matchesSocialSource(tabUrl: string | undefined, source: SocialCaptureSource): boolean {
  if (!tabUrl) {
    return false;
  }

  try {
    const url = new URL(tabUrl);
    if (source === 'twitter') {
      return (
        (url.hostname === 'x.com' ||
          url.hostname.endsWith('.x.com') ||
          url.hostname === 'twitter.com' ||
          url.hostname.endsWith('.twitter.com')) &&
        /\/[^/]+\/status\/\d+/.test(url.pathname)
      );
    }

    return (
      (url.hostname === 'weibo.com' ||
        url.hostname.endsWith('.weibo.com') ||
        url.hostname === 'm.weibo.cn') &&
      (/\/detail\/[^/?#]+/.test(url.pathname) || /\/status\/[^/?#]+/.test(url.pathname))
    );
  } catch {
    return false;
  }
}

function contentScriptFileForSource(source: SocialCaptureSource): string {
  return source === 'twitter' ? 'content/twitter.js' : 'content/weibo.js';
}

function sendSocialExtractMessage(
  tabId: number,
  source: SocialCaptureSource,
): Promise<SocialExtractResponse> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: 'social:extract', source },
      (response: SocialExtractResponse | undefined) => {
        const error = chrome.runtime.lastError?.message;
        if (error) {
          reject(new Error(error));
          return;
        }

        resolve(response ?? { ok: false, error: '页面结构可能已更新，提取失败。请反馈此问题。' });
      },
    );
  });
}

async function executeSocialExtractor(tabId: number, source: SocialCaptureSource): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [contentScriptFileForSource(source)],
  });
}

async function extractSocialCapture(
  tab: chrome.tabs.Tab | undefined,
  source: SocialCaptureSource,
): Promise<CapturedContent> {
  const tabId = tab?.id;
  if (typeof tabId !== 'number') {
    throw new Error('无法识别当前标签页');
  }

  if (!matchesSocialSource(tab?.url, source)) {
    throw new Error(socialDetailMessage(source));
  }

  let response: SocialExtractResponse;
  try {
    response = await sendSocialExtractMessage(tabId, source);
  } catch {
    await executeSocialExtractor(tabId, source);
    response = await sendSocialExtractMessage(tabId, source);
  }

  if (!response.ok || !response.data) {
    if (response.diagnostic) {
      await saveExtractorDiagnostic(response.diagnostic);
    }
    throw new Error(response.error ?? '页面结构可能已更新，提取失败。请反馈此问题。');
  }

  if (!response.data.text.trim()) {
    if (response.diagnostic) {
      await saveExtractorDiagnostic({
        ...response.diagnostic,
        error: '页面可能未完全加载，请等待内容显示后重试。',
      });
    }
    throw new Error('页面结构可能已更新，提取失败。请反馈此问题。');
  }

  if (response.diagnostic) {
    await saveExtractorDiagnostic(response.diagnostic);
  }

  return response.data;
}

async function captureSocialFromTab(
  tab: chrome.tabs.Tab | undefined,
  source: SocialCaptureSource,
): Promise<CapturedContent> {
  const capture = await extractSocialCapture(tab, source);
  await storeCapture(capture, tab);

  return capture;
}

function requestCapture(tab: chrome.tabs.Tab | undefined, source: SocialCaptureSource): void {
  void captureSocialFromTab(tab, source).catch(() => undefined);
}

function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const error = chrome.runtime.lastError?.message;
      if (error) {
        reject(new Error(error));
        return;
      }

      resolve(tabs[0]);
    });
  });
}

async function captureCurrentSocial(
  source: SocialCaptureSource,
): Promise<{ capture: CapturedContent }> {
  const capture = await captureSocialFromTab(await getActiveTab(), source);
  return { capture };
}

async function executeArticleExtractor(tabId: number): Promise<CapturedContent> {
  const injected = await new Promise<boolean>((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: 'article:ping' },
      (response: { ok?: boolean } | undefined) => {
        resolve(!chrome.runtime.lastError && response?.ok === true);
      },
    );
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
      case 'plan:apply': {
        const result = await applyClassificationPlan(request.plan, request.selectedMoveIds);
        const selectedIds = new Set(request.selectedMoveIds);
        const selectedMoves = request.plan.moves.filter((move) => selectedIds.has(move.id));
        const targetFolders = new Set(selectedMoves.map((move) => move.targetFolder));

        if (result.moved > 0) {
          await addActivityEntry({
            type: 'classify_apply',
            summary: summarizeClassifyApply(result.moved, targetFolders.size),
            details: selectedMoves.slice(0, result.moved).map((move) => ({
              label: move.bookmarkTitle,
              meta: `${move.currentFolder || '根目录'} → ${move.targetFolder}`,
            })),
          });
        }

        return {
          ok: true,
          data: result,
        };
      }
      case 'plan:undoLast': {
        const records = await getLastMoveRecords();
        const undone = await undoMoveRecords(records);
        if (undone > 0) {
          await addActivityEntry({
            type: 'classify_undo',
            summary: summarizeClassifyUndo(undone),
            details: records.slice(0, undone).map((record) => ({
              label: record.bookmarkTitle,
              meta: '回到原位置',
            })),
          });
        }
        return { ok: true, data: { undone } };
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
      case 'onboarding:getProgress':
        return {
          ok: true,
          data: (await getOnboardingProgress()) ?? {
            vaultConfigured: false,
            providerConfigured: false,
            firstClassifyDone: false,
            firstExportDone: false,
          },
        };
      case 'onboarding:set':
        await saveOnboarded(request.onboarded);
        return { ok: true, data: { onboarded: request.onboarded } };
      case 'capture:getPending':
        return { ok: true, data: await getPendingCaptures() };
      case 'capture:currentSocial':
        return { ok: true, data: await captureCurrentSocial(request.source) };
      case 'capture:currentArticle': {
        const tab = await getActiveTab();
        if (typeof tab?.id !== 'number') {
          throw new Error('无法识别当前页面');
        }

        const capture = await executeArticleExtractor(tab.id);
        const stored = await storeCapture(capture, tab);
        if (!stored) {
          throw new Error('无法保存提取结果');
        }

        return { ok: true, data: { capture: stored } };
      }
      case 'capture:removePending':
        return { ok: true, data: { removed: await removePendingCapture(request.id) } };
      case 'capture:clearPending':
        await clearPendingCapture();
        return { ok: true, data: { cleared: true } };
      case 'health:clearRecords':
        await clearUrlHealthRecords();
        return { ok: true, data: { cleared: true } };
      case 'health:retryOne':
        return { ok: true, data: await retryBookmarkHealth(request.bookmarkId) };
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
      errorCode: inferErrorCode(error),
    };
  }
}

function postClassificationMessage(
  port: chrome.runtime.Port,
  message: ClassificationPortMessage,
): void {
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
          errorCode: inferErrorCode(error),
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
          errorCode: inferErrorCode(error),
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
    void chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: false })
      .catch(() => undefined);
  }

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'shuhai-open',
      title: '打开 ShuHai 侧边栏',
      contexts: ['action'],
    });
    chrome.contextMenus.create({
      id: 'shuhai-save-article',
      title: '提取文章正文到 ShuHai',
      contexts: ['page', 'selection'],
    });
    chrome.contextMenus.create({
      id: 'shuhai-save-tweet',
      title: '提取推文正文到 ShuHai',
      contexts: ['page'],
      documentUrlPatterns: ['https://x.com/*', 'https://twitter.com/*'],
    });
    chrome.contextMenus.create({
      id: 'shuhai-save-weibo',
      title: '提取微博正文到 ShuHai',
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
