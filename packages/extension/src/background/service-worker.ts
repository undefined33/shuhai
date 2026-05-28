import { classifyWithDeepSeek } from '../shared/ai-classifier.js';
import type {
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
import { getSettings, saveSettings } from '../utils/storage.js';

async function getState(): Promise<ExtensionState> {
  const tree = await getFullTree();
  const summary = flattenBookmarkTree(tree);
  const backups = await listBackups();
  const lastMoveRecords = await getLastMoveRecords();
  const settings = await getSettings();

  return {
    tree,
    bookmarks: summary.bookmarks,
    folders: summary.folders,
    backups,
    lastMoveRecordCount: lastMoveRecords.length,
    settings,
  };
}

async function createPlan() {
  const tree = await getFullTree();
  const summary = flattenBookmarkTree(tree);
  const settings = await getSettings();
  const aiSuggestions = await classifyWithDeepSeek(summary.bookmarks, settings);

  return generateClassificationPlan(
    summary.bookmarks,
    summary.folders,
    settings.customRules,
    aiSuggestions,
  );
}

async function handleRequest(request: ExtensionRequest): Promise<ExtensionResponse> {
  try {
    switch (request.type) {
      case 'state:get':
        return { ok: true, data: await getState() };
      case 'plan:create':
        return { ok: true, data: await createPlan() };
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
});

chrome.runtime.onMessage.addListener((message: ExtensionRequest, _sender, sendResponse) => {
  void handleRequest(message).then(sendResponse);
  return true;
});
