import type {
  AiProviderType,
  BookmarkItem,
  BookmarkOperation,
  BookmarkOperationCommand,
  BookmarkOperationCommandResponse,
  BookmarkTaskSettings,
  ClassificationMode,
  ClassificationPlan,
  ClassificationProgress,
  FolderItem,
} from '../../shared/bookmark-types.js';
import { isBookmarkOperation } from '../../shared/bookmark-types.js';
import {
  parseBookmarkOperationMessageResponse,
  parseClassificationPortMessage,
  parseLegacyResponse,
  type ClassificationPortRequest,
  type ExtensionRequest,
  type LegacySuccessData,
} from '../../shared/extension-messages.js';

export interface BookmarkTaskSnapshot {
  readonly bookmarks: BookmarkItem[];
  readonly folders: FolderItem[];
  readonly settings: BookmarkTaskSettings;
}

export interface ClassificationSession {
  readonly result: Promise<ClassificationPlan>;
  cancel(): boolean;
  dispose(): void;
}

export interface StartClassificationOptions {
  readonly mode: ClassificationMode;
  readonly ai?: { readonly provider: AiProviderType; readonly confirmed: true };
  readonly onProgress: (progress: ClassificationProgress) => void;
}

function responseError(message: string, errorCode?: string): Error {
  const error = new Error(message) as Error & { errorCode?: string };
  error.errorCode = errorCode;
  return error;
}

function requestId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) {
    throw responseError('无法创建安全的请求标识', 'request_id_unavailable');
  }
  return `${prefix}:${uuid}`;
}

function sendRawRuntimeMessage(request: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(request, (response: unknown) => {
      const runtimeError = chrome.runtime.lastError?.message;
      if (runtimeError) {
        reject(responseError('扩展后台暂时不可用', 'runtime_unavailable'));
        return;
      }
      if (response === undefined) {
        reject(responseError('扩展后台没有响应', 'response_invalid'));
        return;
      }
      resolve(response);
    });
  });
}

export async function sendBookmarkTaskRequest<R extends ExtensionRequest>(
  request: R,
): Promise<LegacySuccessData<R>> {
  const response = parseLegacyResponse(request, await sendRawRuntimeMessage(request));
  if (!response.ok) {
    throw responseError(response.error, response.errorCode);
  }
  return response.data;
}

export function getBookmarkTaskSnapshot(): Promise<BookmarkTaskSnapshot> {
  return sendBookmarkTaskRequest({ type: 'bookmarkTask:getSnapshot' });
}

export async function getRecentBookmarkOperations(): Promise<BookmarkOperation[]> {
  const result = await sendBookmarkTaskRequest({ type: 'operations:getRecent' });
  return result.operations;
}

export async function runBookmarkOperation(
  command: BookmarkOperationCommand,
): Promise<BookmarkOperationCommandResponse> {
  const response = parseBookmarkOperationMessageResponse(
    await sendRawRuntimeMessage(command),
    command.requestId,
  );
  if (!response.ok) {
    throw responseError(response.error, response.errorCode);
  }
  if (!response.data.receipt.result.ok) {
    throw responseError('书签操作未执行', response.data.receipt.result.errorCode);
  }
  return response.data;
}

export function createBookmarkOperationRequestId(): string {
  return requestId('bookmark-operation');
}

export function requestOptionalOrigin(origin: string): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.permissions.contains({ origins: [origin] }, (alreadyGranted) => {
      if (chrome.runtime.lastError) {
        resolve(false);
        return;
      }
      if (alreadyGranted) {
        resolve(true);
        return;
      }
      chrome.permissions.request({ origins: [origin] }, (granted) => {
        resolve(!chrome.runtime.lastError && granted === true);
      });
    });
  });
}

export function startClassificationSession({
  ai,
  mode,
  onProgress,
}: StartClassificationOptions): ClassificationSession {
  if (!chrome.runtime.connect) {
    throw responseError('当前浏览器无法建立分类任务连接', 'runtime_unavailable');
  }

  const port = chrome.runtime.connect({ name: 'classify' });
  const planRequestId = requestId('classify');
  let cancelRequestId: string | undefined;
  let settled = false;
  let rejectResult: ((reason: Error) => void) | undefined;

  const finish = (callback: () => void) => {
    if (settled) return;
    settled = true;
    callback();
    port.disconnect();
  };

  const result = new Promise<ClassificationPlan>((resolve, reject) => {
    rejectResult = reject;

    port.onMessage.addListener((rawMessage: unknown) => {
      let message;
      try {
        message = parseClassificationPortMessage(rawMessage);
      } catch {
        finish(() => reject(responseError('分类任务返回了无法验证的响应', 'response_invalid')));
        return;
      }

      if (message.type === 'cancelled') {
        if (
          cancelRequestId === undefined ||
          message.requestId !== cancelRequestId ||
          message.targetRequestId !== planRequestId
        ) {
          finish(() => reject(responseError('分类取消响应无法验证', 'response_invalid')));
          return;
        }
        finish(() => reject(responseError('本次书签分析已取消', 'classification_cancelled')));
        return;
      }

      if (message.requestId !== planRequestId) {
        finish(() => reject(responseError('分类任务响应不匹配', 'response_invalid')));
        return;
      }

      if (cancelRequestId !== undefined) {
        return;
      }

      if (message.type === 'progress') {
        onProgress(message.progress);
        return;
      }
      if (message.type === 'complete') {
        finish(() => {
          if (message.cancelled) {
            reject(responseError('本次书签分析已取消', 'classification_cancelled'));
          } else {
            resolve(message.plan);
          }
        });
        return;
      }
      finish(() => reject(responseError(message.error, message.errorCode)));
    });

    port.onDisconnect.addListener(() => {
      if (!settled) {
        settled = true;
        reject(
          responseError(
            chrome.runtime.lastError?.message ?? '分类任务连接意外中断',
            'runtime_unavailable',
          ),
        );
      }
    });

    port.postMessage({
      type: 'plan:create',
      requestId: planRequestId,
      mode,
      ...(ai ? { ai } : {}),
    } satisfies ClassificationPortRequest);
  });

  return {
    result,
    cancel() {
      if (settled || cancelRequestId !== undefined) return false;
      cancelRequestId = requestId('cancel');
      port.postMessage({
        type: 'cancel',
        requestId: cancelRequestId,
        targetRequestId: planRequestId,
      } satisfies ClassificationPortRequest);
      return true;
    },
    dispose() {
      if (settled) return;
      settled = true;
      port.disconnect();
      rejectResult?.(responseError('分类任务已随工作区关闭而安全中止', 'classification_cancelled'));
    },
  };
}

export function readBookmarkOperationEvent(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): BookmarkOperation | undefined {
  if (sender.id !== chrome.runtime.id || sender.tab) return undefined;
  if (!message || typeof message !== 'object') return undefined;
  const record = message as Record<string, unknown>;
  return record.type === 'bookmarkOperations:progress' && isBookmarkOperation(record.operation)
    ? record.operation
    : undefined;
}
