import { AI_BATCH_SIZE } from '@shuhai/shared';
import { classifyAllWithAi, testAiProviderConnection } from '../shared/ai-classifier.js';
import type {
  BookmarkOperation,
  BookmarkOperationCommand,
  BookmarkOperationCommandResponse,
  CapturedContent,
  ClassificationProgress,
  ClassificationMode,
  DiagnosticReport,
  ExtensionState,
  StateSummary,
} from '../shared/bookmark-types.js';
import {
  parseBookmarkOperationCommand,
  parseBookmarkOperationCommandResponse,
} from '../shared/bookmark-types.js';
import { generateClassificationPlan } from '../shared/classifier.js';
import { getLastMoveRecords, listBackups } from '../utils/backup.js';
import { flattenBookmarkTree, getFullTree } from '../utils/chrome-bookmarks.js';
import {
  BookmarkOperationCommandError,
  acceptBookmarkOperationCurrentState,
  cancelBookmarkOperation,
  executeBookmarkMoves,
  executeBookmarkUrlUpdates,
  executeDeleteBookmarks,
  reconcileInterruptedBookmarkOperations,
  restoreBookmarkOperation,
} from '../utils/bookmark-operations.js';
import {
  BookmarkOperationStorageError,
  clearPendingCapture,
  clearUrlHealthRecords,
  getExportManifests,
  getOnboardingProgress,
  getPendingCaptures,
  getSettings,
  normalizeSettings,
  getOnboarded,
  getBookmarkOperations,
  getUrlHealthRecords,
  ensureTrustedLocalStorageAccess,
  removePendingCapture,
  savePendingCapture,
  saveOnboarded,
  saveSettings,
} from '../utils/storage.js';
import type {
  ClassificationPortMessage,
  ClassificationPortRequest,
  ExtensionRequest,
  LegacyResponse,
  SafeAiProviderTestResult,
} from '../shared/extension-messages.js';
import {
  AI_PROVIDER_CONNECTION_RESULTS,
  makeLegacyError,
  parseClassificationPortMessage,
  parseClassificationPortRequest,
  parseExtensionRequest,
  parseLegacyResponse,
  validateExtensionUiSender,
} from '../shared/extension-messages.js';
import { addActivityEntry } from '../utils/activity-log.js';
import { saveExtractorDiagnostic } from '../utils/extractor-diagnostics.js';
import { getVaultHandle } from '../utils/vault-writer.js';
import {
  X_BOOKMARKS_ADAPTER_VERSION,
  X_BOOKMARKS_CEILINGS,
  type XBookmarksLimits,
} from '../social/adapters/x-bookmarks.js';
import { SYNC_LIMITS, type SyncJob, type SyncScanMode } from '../social/sync-schema.js';
import {
  ActiveSyncJobExistsError,
  SyncStoreConflictError,
  openSyncStore,
  type SyncStore,
} from '../social/sync-store.js';
import {
  XSyncAdapterStopError,
  XSyncCoordinator,
  type AdapterBatchPort,
  type AdapterBatchRequest,
  type XSyncInvocationResult,
} from '../social/x-sync-coordinator.js';
import {
  XSyncLaunchIntentError,
  XSyncLaunchIntentStore,
  type XSyncSessionStoragePort,
} from '../social/x-sync-launch-intent.js';
import {
  X_SYNC_BOOKMARKS_URL,
  X_SYNC_PROTOCOL,
  makeMinimalXSyncRuntimeError,
  matchesXSyncContentResponseBinding,
  parseXSyncContentResponse,
  parseXSyncPortMessage,
  parseXSyncUiRequest,
  parseXSyncUiResponse,
  resolveXSyncExtensionOrigin,
  validateXSyncUiSender,
  type XSyncContentRequest,
  type XSyncDocumentBinding,
  type XSyncPortMessage,
  type XSyncUiRequest,
  type XSyncUiResponse,
} from '../social/x-sync-messages.js';
import {
  XSyncRuntime,
  type XSyncInvocationLease,
  type XSyncRuntimeProfile,
  type XSyncRuntimePauseReason,
} from '../social/x-sync-runtime.js';

type SocialCaptureSource = 'twitter' | 'weibo';

interface SocialExtractResponse {
  ok?: boolean;
  data?: CapturedContent;
  error?: string;
  diagnostic?: DiagnosticReport;
}

const X_SYNC_CONTENT_FILE = 'content/x-bookmarks.js';
const X_SYNC_ORIGIN = 'https://x.com/*';
const X_SYNC_LEGACY_BROAD_ORIGINS = ['http://*/*', 'https://*/*'] as const;
const X_SYNC_INITIAL_CANDIDATE_LIMIT = 10;
const X_SYNC_INITIAL_SCROLL_LIMIT = 5;
export const SECURITY_BOOTSTRAP_TIMEOUT_MS = 5_000;

interface SecurityBootstrapSuccess {
  readonly ok: true;
  readonly xPermission: 'granted' | 'not_granted';
}

interface SecurityBootstrapFailure {
  readonly ok: false;
}

type SecurityBootstrapResult = SecurityBootstrapSuccess | SecurityBootstrapFailure;

let securityBootstrapExpired = false;

function assertSecurityBootstrapActive(): void {
  if (securityBootstrapExpired) {
    throw new Error('security_bootstrap_expired');
  }
}

function permissionGetAll(): Promise<chrome.permissions.Permissions> {
  assertSecurityBootstrapActive();
  const getAll = chrome.permissions?.getAll;
  if (typeof getAll !== 'function') {
    return Promise.reject(new Error('security_bootstrap_failed'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value?: chrome.permissions.Permissions, error?: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      if (securityBootstrapExpired || error || !value) {
        reject(new Error('security_bootstrap_failed'));
        return;
      }
      resolve(value);
    };

    try {
      const result = getAll.call(chrome.permissions, (permissions) => {
        finish(permissions, chrome.runtime.lastError);
      }) as unknown;
      if (
        result &&
        (typeof result === 'object' || typeof result === 'function') &&
        'then' in result &&
        typeof (result as PromiseLike<chrome.permissions.Permissions>).then === 'function'
      ) {
        void Promise.resolve(result).then(
          (permissions) => finish(permissions as chrome.permissions.Permissions),
          (error: unknown) => finish(undefined, error),
        );
      }
    } catch (error) {
      finish(undefined, error);
    }
  });
}

function permissionRemove(permissions: chrome.permissions.Permissions): Promise<boolean> {
  assertSecurityBootstrapActive();
  const remove = chrome.permissions?.remove;
  if (typeof remove !== 'function') {
    return Promise.reject(new Error('security_bootstrap_failed'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (removed?: boolean, error?: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      if (securityBootstrapExpired || error || typeof removed !== 'boolean') {
        reject(new Error('security_bootstrap_failed'));
        return;
      }
      resolve(removed);
    };

    try {
      const result = remove.call(chrome.permissions, permissions, (removed) => {
        finish(removed, chrome.runtime.lastError);
      }) as unknown;
      if (
        result &&
        (typeof result === 'object' || typeof result === 'function') &&
        'then' in result &&
        typeof (result as PromiseLike<boolean>).then === 'function'
      ) {
        void Promise.resolve(result).then(
          (removed) => finish(removed as unknown as boolean),
          (error: unknown) => finish(undefined, error),
        );
      }
    } catch (error) {
      finish(undefined, error);
    }
  });
}

async function runSecurityBootstrap(): Promise<SecurityBootstrapSuccess> {
  await ensureTrustedLocalStorageAccess();
  assertSecurityBootstrapActive();

  const before = await permissionGetAll();
  assertSecurityBootstrapActive();
  const beforeOrigins = before.origins ?? [];
  const exactWasGranted = beforeOrigins.includes(X_SYNC_ORIGIN);
  const broadOrigins = X_SYNC_LEGACY_BROAD_ORIGINS.filter((origin) =>
    beforeOrigins.includes(origin),
  );

  if (broadOrigins.length > 0) {
    await permissionRemove({ origins: [...broadOrigins] });
    assertSecurityBootstrapActive();
  }

  const after = await permissionGetAll();
  assertSecurityBootstrapActive();
  const afterOrigins = after.origins ?? [];
  if (X_SYNC_LEGACY_BROAD_ORIGINS.some((origin) => afterOrigins.includes(origin))) {
    throw new Error('security_bootstrap_failed');
  }
  if (exactWasGranted && !afterOrigins.includes(X_SYNC_ORIGIN)) {
    throw new Error('security_bootstrap_failed');
  }

  return {
    ok: true,
    xPermission: afterOrigins.includes(X_SYNC_ORIGIN) ? 'granted' : 'not_granted',
  };
}

function startSecurityBootstrap(): Promise<SecurityBootstrapResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: SecurityBootstrapResult) => {
      if (settled) {
        return;
      }
      settled = true;
      globalThis.clearTimeout(timer);
      resolve(result);
    };
    const timer = globalThis.setTimeout(() => {
      securityBootstrapExpired = true;
      finish({ ok: false });
    }, SECURITY_BOOTSTRAP_TIMEOUT_MS);

    void runSecurityBootstrap().then(
      (result) => {
        if (!securityBootstrapExpired) {
          finish(result);
        }
      },
      () => {
        if (!securityBootstrapExpired) {
          finish({ ok: false });
        }
      },
    );
  });
}

const securityBootstrap = startSecurityBootstrap();
const xSyncRuntime = new XSyncRuntime();
const xSyncPorts = new Set<chrome.runtime.Port>();

type XSyncRuntimeErrorCode = Parameters<typeof makeMinimalXSyncRuntimeError>[0]['code'];
type XSyncRuntimeErrorPhase = Parameters<typeof makeMinimalXSyncRuntimeError>[0]['phase'];
type XSyncSuccessResult = Extract<XSyncUiResponse, { readonly ok: true }>['result'];

interface XSyncValidatedTab {
  readonly tabId: number;
  readonly windowId: number;
}

interface XSyncInjectedDocument extends XSyncValidatedTab {
  readonly documentId: string;
}

interface ActiveXSyncRun {
  readonly jobId: string;
  readonly scanRevision: number;
  readonly tabId: number;
  readonly windowId: number;
  readonly adapter: XSyncChromeAdapter;
  readonly promise: Promise<void>;
}

class XSyncServiceError extends Error {
  readonly code: XSyncRuntimeErrorCode;
  readonly phase: XSyncRuntimeErrorPhase;
  readonly jobId?: string;
  readonly scanRevision?: number;

  constructor(
    code: XSyncRuntimeErrorCode,
    phase: XSyncRuntimeErrorPhase,
    options: { readonly jobId?: string; readonly scanRevision?: number } = {},
  ) {
    super('The X sync command failed');
    this.name = 'XSyncServiceError';
    this.code = code;
    this.phase = phase;
    this.jobId = options.jobId;
    this.scanRevision = options.scanRevision;
  }
}

function xSyncSessionStoragePort(): XSyncSessionStoragePort {
  return {
    get: (key) =>
      new Promise((resolve, reject) => {
        if (!chrome.storage?.session) {
          reject(new Error('session storage unavailable'));
          return;
        }
        chrome.storage.session.get(key, (items) => {
          if (chrome.runtime.lastError) {
            reject(new Error('session storage get failed'));
            return;
          }
          const descriptor = Object.getOwnPropertyDescriptor(items, key);
          resolve(descriptor && 'value' in descriptor ? descriptor.value : undefined);
        });
      }),
    set: (key, value) =>
      new Promise((resolve, reject) => {
        if (!chrome.storage?.session) {
          reject(new Error('session storage unavailable'));
          return;
        }
        chrome.storage.session.set({ [key]: value }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error('session storage set failed'));
            return;
          }
          resolve();
        });
      }),
    remove: (key) =>
      new Promise((resolve, reject) => {
        if (!chrome.storage?.session) {
          reject(new Error('session storage unavailable'));
          return;
        }
        chrome.storage.session.remove(key, () => {
          if (chrome.runtime.lastError) {
            reject(new Error('session storage remove failed'));
            return;
          }
          resolve();
        });
      }),
  };
}

const xSyncLaunchIntents = new XSyncLaunchIntentStore(xSyncSessionStoragePort());
let activeXSyncRun: ActiveXSyncRun | undefined;
let xSyncCommandQueue: Promise<void> = Promise.resolve();

function runXSyncCommandExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const result = xSyncCommandQueue.then(operation, operation);
  xSyncCommandQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function hasXSyncProtocolEnvelope(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  try {
    return Object.prototype.hasOwnProperty.call(value, 'protocol');
  } catch {
    return true;
  }
}

function xSyncPhaseForRequest(request: XSyncUiRequest): XSyncRuntimeErrorPhase {
  switch (request.type) {
    case 'launch':
    case 'start':
      return 'launch';
    case 'resume':
    case 'pause':
    case 'finalize':
    case 'cancel':
      return 'scanning';
    case 'save-selection':
    case 'complete-without-writes':
    case 'authorize':
      return request.type === 'authorize' ? 'writing' : 'review';
  }
}

function xSyncSuccess(requestId: string, result: XSyncSuccessResult): XSyncUiResponse {
  return parseXSyncUiResponse({
    protocol: X_SYNC_PROTOCOL,
    type: 'command-result',
    requestId,
    ok: true,
    result,
  });
}

function xSyncFailure(
  requestId: string,
  code: XSyncRuntimeErrorCode,
  phase: XSyncRuntimeErrorPhase,
  options: { readonly jobId?: string; readonly scanRevision?: number } = {},
): XSyncUiResponse {
  return parseXSyncUiResponse({
    protocol: X_SYNC_PROTOCOL,
    type: 'command-result',
    requestId,
    ok: false,
    error: makeMinimalXSyncRuntimeError({
      code,
      phase,
      ...(options.jobId === undefined ? {} : { jobId: options.jobId }),
      ...(options.scanRevision === undefined ? {} : { scanRevision: options.scanRevision }),
    }),
  });
}

function xSyncErrorResponse(request: XSyncUiRequest, error: unknown): XSyncUiResponse {
  const phase = xSyncPhaseForRequest(request);
  if (error instanceof XSyncServiceError) {
    return xSyncFailure(request.requestId, error.code, error.phase, {
      ...(error.jobId === undefined ? {} : { jobId: error.jobId }),
      ...(error.scanRevision === undefined ? {} : { scanRevision: error.scanRevision }),
    });
  }
  if (error instanceof XSyncLaunchIntentError) {
    const code: XSyncRuntimeErrorCode =
      error.code === 'expired'
        ? 'launch_expired'
        : error.code === 'missing' || error.code === 'nonce_mismatch'
          ? 'launch_missing'
          : error.code === 'storage_corrupt'
            ? 'storage_corrupt'
            : error.code === 'window_missing' || error.code === 'tab_changed'
              ? 'tab_changed'
              : 'internal_error';
    return xSyncFailure(request.requestId, code, phase);
  }
  if (error instanceof ActiveSyncJobExistsError) {
    return xSyncFailure(request.requestId, 'source_conflict', phase);
  }
  if (error instanceof SyncStoreConflictError) {
    return xSyncFailure(request.requestId, 'stale_revision', phase);
  }
  return xSyncFailure(request.requestId, 'internal_error', phase);
}

function postXSyncPortValue(
  port: chrome.runtime.Port,
  value: XSyncUiResponse | XSyncPortMessage,
): void {
  try {
    port.postMessage(value);
  } catch {
    xSyncPorts.delete(port);
  }
}

function broadcastXSyncEvent(message: XSyncPortMessage): void {
  const parsed = parseXSyncPortMessage(message);
  for (const port of xSyncPorts) {
    postXSyncPortValue(port, parsed);
  }
}

function broadcastXSyncState(job: SyncJob): void {
  broadcastXSyncEvent({
    protocol: X_SYNC_PROTOCOL,
    type: 'runtime-event',
    event: {
      kind: 'state',
      jobId: job.id,
      status: job.status,
      scanRevision: job.scanRevision,
      reviewRevision: job.reviewRevision,
    },
  });
}

function queryActiveXTab(windowId?: number): Promise<XSyncValidatedTab> {
  return new Promise((resolve, reject) => {
    const query: chrome.tabs.QueryInfo =
      windowId === undefined
        ? { active: true, lastFocusedWindow: true }
        : { active: true, windowId };
    chrome.tabs.query(query, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new XSyncServiceError('tab_changed', 'launch'));
        return;
      }
      const tab = tabs[0];
      if (
        tabs.length !== 1 ||
        typeof tab?.id !== 'number' ||
        typeof tab.windowId !== 'number' ||
        tab.active !== true ||
        tab.url !== X_SYNC_BOOKMARKS_URL ||
        (windowId !== undefined && tab.windowId !== windowId)
      ) {
        reject(new XSyncServiceError('tab_changed', 'launch'));
        return;
      }
      resolve({ tabId: tab.id, windowId: tab.windowId });
    });
  });
}

function getBoundXTab(tabId: number, windowId: number): Promise<XSyncValidatedTab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      if (
        chrome.runtime.lastError ||
        typeof tab?.id !== 'number' ||
        tab.id !== tabId ||
        tab.windowId !== windowId ||
        tab.active !== true ||
        tab.url !== X_SYNC_BOOKMARKS_URL
      ) {
        reject(new XSyncAdapterStopError('tab_changed'));
        return;
      }
      resolve({ tabId, windowId });
    });
  });
}

function containsXPermission(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!chrome.permissions?.contains || !chrome.permissions.getAll) {
      resolve(false);
      return;
    }
    chrome.permissions.contains({ origins: [X_SYNC_ORIGIN] }, (granted) => {
      if (chrome.runtime.lastError || granted !== true) {
        resolve(false);
        return;
      }
      chrome.permissions.getAll((permissions) => {
        if (chrome.runtime.lastError) {
          resolve(false);
          return;
        }
        const origins = permissions.origins ?? [];
        resolve(
          origins.includes(X_SYNC_ORIGIN) &&
            !X_SYNC_LEGACY_BROAD_ORIGINS.some((origin) => origins.includes(origin)),
        );
      });
    });
  });
}

async function assertXAccess(tabId: number, windowId: number): Promise<void> {
  if (!(await containsXPermission())) {
    throw new XSyncAdapterStopError('permission_revoked');
  }
  await getBoundXTab(tabId, windowId);
}

function injectXBookmarksReader(tab: XSyncValidatedTab): Promise<XSyncInjectedDocument> {
  return chrome.scripting
    .executeScript({
      target: { tabId: tab.tabId, frameIds: [0] },
      files: [X_SYNC_CONTENT_FILE],
    })
    .then((results) => {
      const mainFrame = results.find(
        (result) =>
          result.frameId === 0 &&
          typeof result.documentId === 'string' &&
          result.documentId.length > 0,
      );
      if (!mainFrame?.documentId) {
        throw new XSyncServiceError('invalid_state', 'scanning');
      }
      return { ...tab, documentId: mainFrame.documentId };
    })
    .catch((error: unknown) => {
      if (error instanceof XSyncServiceError) {
        throw error;
      }
      throw new XSyncServiceError('invalid_state', 'scanning');
    });
}

function sendTargetedXMessage(
  binding: XSyncDocumentBinding,
  message: XSyncContentRequest,
  signal: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener('abort', abort);
      operation();
    };
    const abort = () => finish(() => reject(new XSyncAdapterStopError('budget_exceeded')));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    chrome.tabs.sendMessage(
      binding.tabId,
      message,
      { documentId: binding.documentId, frameId: binding.frameId },
      (response: unknown) => {
        if (chrome.runtime.lastError) {
          finish(() => reject(new XSyncAdapterStopError('tab_changed')));
          return;
        }
        finish(() => resolve(response));
      },
    );
  });
}

class XSyncChromeAdapter implements AdapterBatchPort {
  private lease?: XSyncInvocationLease;
  private pauseReason?: XSyncRuntimePauseReason;

  constructor(
    private readonly document: XSyncInjectedDocument,
    private readonly profile: XSyncRuntimeProfile,
    private readonly maximumScrollActions: number,
  ) {}

  requestPause(reason: XSyncRuntimePauseReason = 'user_paused'): void {
    this.pauseReason ??= reason;
    if (this.lease) {
      xSyncRuntime.requestPause(this.lease, this.pauseReason);
    }
  }

  finish(): void {
    if (!this.lease) {
      return;
    }
    const snapshot = xSyncRuntime.snapshot();
    if (
      snapshot.status !== 'idle' &&
      snapshot.jobId === this.lease.binding.jobId &&
      snapshot.scanRevision === this.lease.binding.scanRevision
    ) {
      xSyncRuntime.finishInvocation(this.lease);
    }
  }

  async readBatch(request: AdapterBatchRequest, signal?: AbortSignal): Promise<unknown> {
    return this.withCoordinatorSignal(signal, async () => {
      if (this.pauseReason) {
        throw new XSyncAdapterStopError(this.pauseReason);
      }
      await assertXAccess(this.document.tabId, this.document.windowId);
      const lease = this.ensureLease(request);
      await this.ping(lease, request);

      const remainingBytes = Math.max(1, request.limits.maxTotalBytes - request.jobAcceptedBytes);
      const response = await this.sendBoundRequest(
        lease,
        {
          protocol: X_SYNC_PROTOCOL,
          type: 'read-batch',
          jobId: lease.binding.jobId,
          scanRevision: lease.binding.scanRevision,
          adapterVersion: request.adapterVersion,
          step: request.step,
          nonce: lease.binding.nonce,
          mode: request.mode,
          candidateSourceItemIds: [...request.candidateSourceItemIds],
          knownFrontierSourceItemIds: [...request.knownFrontierSourceItemIds],
          limits: {
            remainingCandidateSlots: request.remainingCandidateSlots,
            maxObservedNodes: request.limits.maxObservedNodes,
            maxElapsedMs: request.limits.maxElapsedMs,
            maxTextBytes: request.limits.maxTextBytes,
            maxMedia: request.limits.maxMedia,
            maxTotalBytes: remainingBytes,
            maxScrollActionsRemaining: request.maxScrollActionsRemaining,
            allowScroll: true,
          },
        },
        !(request.mode === 'backfill' && request.step === 0),
      );
      if (response.type !== 'batch-result') {
        throw new XSyncAdapterStopError('structure_changed');
      }

      await assertXAccess(this.document.tabId, this.document.windowId);
      await this.ping(lease, request);
      return response.result;
    });
  }

  async verifyBinding(request: AdapterBatchRequest, signal?: AbortSignal): Promise<void> {
    await this.withCoordinatorSignal(signal, async () => {
      await assertXAccess(this.document.tabId, this.document.windowId);
      await this.ping(this.ensureLease(request), request);
    });
  }

  private ensureLease(request: AdapterBatchRequest): XSyncInvocationLease {
    if (this.lease) {
      if (
        this.lease.binding.jobId !== activeXSyncRun?.jobId ||
        this.lease.binding.scanRevision !== request.scanRevision
      ) {
        throw new XSyncAdapterStopError('structure_changed');
      }
      return this.lease;
    }
    const started = xSyncRuntime.beginInvocation({
      jobId: activeXSyncRun?.jobId ?? '',
      scanRevision: request.scanRevision,
      tabId: this.document.tabId,
      windowId: this.document.windowId,
      documentId: this.document.documentId,
      mode: request.mode,
      profile: this.profile,
      maxScrollActions: this.maximumScrollActions,
    });
    if (started.kind !== 'started') {
      throw new XSyncAdapterStopError('structure_changed');
    }
    this.lease = started.lease;
    return started.lease;
  }

  private async sendBoundRequest(
    lease: XSyncInvocationLease,
    request: XSyncContentRequest,
    performsScroll = false,
  ) {
    const outcome = await xSyncRuntime.executeContentRequest(
      lease,
      { kind: request.type === 'ping' ? 'ping' : 'batch', performsScroll },
      async (signal) => {
        if (signal.aborted || this.pauseReason) {
          return { kind: 'pause', reason: this.pauseReason ?? 'user_paused' } as const;
        }
        let rawResponse: unknown;
        try {
          rawResponse = await sendTargetedXMessage(lease.binding, request, signal);
        } catch {
          return {
            kind: 'pause',
            reason: this.pauseReason ?? (signal.aborted ? 'budget_exceeded' : 'tab_changed'),
          } as const;
        }
        if (
          signal.aborted ||
          this.pauseReason ||
          !matchesXSyncContentResponseBinding(
            rawResponse,
            lease.binding,
            request.step,
            request.adapterVersion,
          )
        ) {
          return {
            kind: 'pause',
            reason: this.pauseReason ?? (signal.aborted ? 'user_paused' : 'tab_changed'),
          } as const;
        }
        try {
          return { kind: 'response', value: parseXSyncContentResponse(rawResponse) } as const;
        } catch {
          return { kind: 'pause', reason: 'structure_changed' } as const;
        }
      },
    );
    if (outcome.kind === 'completed') {
      return outcome.value;
    }
    if (outcome.kind === 'paused') {
      throw new XSyncAdapterStopError(outcome.pause.reason);
    }
    throw new XSyncAdapterStopError('structure_changed');
  }

  private async ping(lease: XSyncInvocationLease, request: AdapterBatchRequest): Promise<void> {
    const response = await this.sendBoundRequest(lease, {
      protocol: X_SYNC_PROTOCOL,
      type: 'ping',
      jobId: lease.binding.jobId,
      scanRevision: lease.binding.scanRevision,
      adapterVersion: request.adapterVersion,
      step: request.step,
      nonce: lease.binding.nonce,
    });
    if (response.type !== 'pong') {
      throw new XSyncAdapterStopError('structure_changed');
    }
  }

  private async withCoordinatorSignal<T>(
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    const abort = () => this.requestPause('budget_exceeded');
    if (signal?.aborted) {
      abort();
      throw new XSyncAdapterStopError(this.pauseReason ?? 'budget_exceeded');
    }
    signal?.addEventListener('abort', abort, { once: true });
    try {
      return await operation();
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }
}

function limitsForNewXJob(): Readonly<XBookmarksLimits> {
  return Object.freeze({
    ...X_BOOKMARKS_CEILINGS,
    maxItems: X_SYNC_INITIAL_CANDIDATE_LIMIT,
    maxBatches: X_SYNC_INITIAL_SCROLL_LIMIT,
    maxScrollActions: X_SYNC_INITIAL_SCROLL_LIMIT,
  });
}

function limitsForPersistedJob(job: SyncJob): Readonly<XBookmarksLimits> {
  return Object.freeze({
    ...X_BOOKMARKS_CEILINGS,
    maxItems: Math.min(job.budgets.maxItems, X_BOOKMARKS_CEILINGS.maxItems),
    maxBatches: Math.min(job.budgets.maxPages, X_BOOKMARKS_CEILINGS.maxBatches),
    maxScrollActions: Math.min(job.budgets.maxPages, X_BOOKMARKS_CEILINGS.maxScrollActions),
    maxElapsedMs: Math.min(job.budgets.maxDurationMs, X_BOOKMARKS_CEILINGS.maxElapsedMs),
    maxMedia: Math.min(job.budgets.maxMediaPerItem, X_BOOKMARKS_CEILINGS.maxMedia),
  });
}

function createXJobId(): string {
  const value = globalThis.crypto?.randomUUID?.();
  if (!value) {
    throw new XSyncServiceError('internal_error', 'launch');
  }
  return `x-${value}`;
}

function startXSyncRun(input: {
  readonly store: SyncStore;
  readonly job: SyncJob;
  readonly document: XSyncInjectedDocument;
  readonly limits: Readonly<XBookmarksLimits>;
  readonly kind: 'start' | 'resume';
}): void {
  const profile: XSyncRuntimeProfile =
    input.limits.maxItems <= X_SYNC_INITIAL_CANDIDATE_LIMIT &&
    input.limits.maxScrollActions <= X_SYNC_INITIAL_SCROLL_LIMIT
      ? 'bounded_probe'
      : 'standard';
  const adapter = new XSyncChromeAdapter(input.document, profile, input.limits.maxScrollActions);
  const coordinator = new XSyncCoordinator(input.store, adapter, {
    onProgress: ({ job, metrics }) => {
      broadcastXSyncEvent({
        protocol: X_SYNC_PROTOCOL,
        type: 'runtime-event',
        event: {
          kind: 'progress',
          jobId: job.id,
          scanRevision: job.scanRevision,
          step: metrics.steps,
          candidateCount: job.checkpoint?.candidateCount ?? 0,
          existingObservationCount: job.checkpoint?.catalogExistingObservationCount ?? 0,
        },
      });
    },
  });

  const runPromise: Promise<XSyncInvocationResult> =
    input.kind === 'start'
      ? coordinator.start({
          jobId: input.job.id,
          expectedScanRevision: input.job.scanRevision,
          limits: input.limits,
        })
      : coordinator.resume({
          jobId: input.job.id,
          expectedScanRevision: input.job.scanRevision,
          limits: input.limits,
        });
  const completion = runPromise
    .then((result) => {
      if (result.outcome === 'paused') {
        broadcastXSyncEvent({
          protocol: X_SYNC_PROTOCOL,
          type: 'runtime-event',
          event: {
            kind: 'paused',
            jobId: result.job.id,
            scanRevision: result.job.scanRevision,
            reason: result.stopReason,
          },
        });
      }
      broadcastXSyncState(result.job);
    })
    .catch(async () => {
      const current = await input.store.getJob(input.job.id).catch(() => undefined);
      if (current?.status === 'scanning') {
        const paused = await input.store
          .pauseJobWithStopRecord(current.id, current.scanRevision, 'structure_changed', 'scanning')
          .catch(() => undefined);
        if (paused) {
          broadcastXSyncState(paused);
        }
      }
    })
    .finally(() => {
      adapter.finish();
      if (activeXSyncRun?.jobId === input.job.id) {
        activeXSyncRun = undefined;
      }
      input.store.close();
    });
  activeXSyncRun = {
    jobId: input.job.id,
    scanRevision: input.job.scanRevision + 1,
    tabId: input.document.tabId,
    windowId: input.document.windowId,
    adapter,
    promise: completion,
  };
}

async function prepareXSyncStart(mode: SyncScanMode, launchNonce: string): Promise<SyncJob> {
  const intent = await xSyncLaunchIntents.consume(launchNonce, async (windowId) => {
    try {
      await queryActiveXTab(windowId);
      return { ok: true } as const;
    } catch {
      return { ok: false, code: 'tab_changed' } as const;
    }
  });
  if (!(await containsXPermission())) {
    throw new XSyncServiceError('permission_revoked', 'launch');
  }
  if (activeXSyncRun) {
    throw new XSyncServiceError('source_conflict', 'launch');
  }

  const store = await openSyncStore();
  try {
    if (await store.getActiveJob('x')) {
      throw new ActiveSyncJobExistsError('x');
    }
    const limits = limitsForNewXJob();
    const tab = await queryActiveXTab(intent.windowId);
    const document = await injectXBookmarksReader(tab);
    const job = await store.createJob({
      id: createXJobId(),
      source: 'x',
      adapterVersion: X_BOOKMARKS_ADAPTER_VERSION,
      scanMode: mode,
      budgets: {
        maxItems: limits.maxItems,
        maxPages: limits.maxBatches,
        maxDurationMs: limits.maxElapsedMs,
        maxItemBytes: SYNC_LIMITS.socialItemBytes,
        maxMediaPerItem: limits.maxMedia,
      },
    });
    startXSyncRun({ store, job, document, limits, kind: 'start' });
    return job;
  } catch (error) {
    store.close();
    throw error;
  }
}

async function prepareXSyncResume(jobId: string, expectedScanRevision: number): Promise<SyncJob> {
  if (!(await containsXPermission())) {
    throw new XSyncServiceError('permission_revoked', 'scanning', {
      jobId,
      scanRevision: expectedScanRevision,
    });
  }
  if (activeXSyncRun) {
    throw new XSyncServiceError('source_conflict', 'scanning', {
      jobId,
      scanRevision: expectedScanRevision,
    });
  }
  const store = await openSyncStore();
  try {
    const job = await store.getJob(jobId);
    const resumable =
      job?.status === 'prepared' ||
      (job?.status === 'paused' && job.stopRecord?.phase === 'scanning');
    if (!job || job.source !== 'x' || job.scanRevision !== expectedScanRevision || !resumable) {
      throw new XSyncServiceError('stale_revision', 'scanning', {
        jobId,
        scanRevision: expectedScanRevision,
      });
    }
    const tab = await queryActiveXTab();
    const document = await injectXBookmarksReader(tab);
    const limits = limitsForPersistedJob(job);
    startXSyncRun({
      store,
      job,
      document,
      limits,
      kind: job.status === 'prepared' ? 'start' : 'resume',
    });
    return job;
  } catch (error) {
    store.close();
    throw error;
  }
}

async function handleXSyncCommand(request: XSyncUiRequest): Promise<XSyncUiResponse> {
  try {
    switch (request.type) {
      case 'launch': {
        const tab = await queryActiveXTab();
        const intent = await xSyncLaunchIntents.create({
          serverValidatedWindowId: tab.windowId,
        });
        return xSyncSuccess(request.requestId, {
          kind: 'launch-intent',
          nonce: intent.nonce,
          expiresAtMs: intent.expiresAtMs,
        });
      }
      case 'start': {
        const job = await prepareXSyncStart(request.mode, request.launchNonce);
        return xSyncSuccess(request.requestId, {
          kind: 'accepted',
          jobId: job.id,
          scanRevision: job.scanRevision,
          reviewRevision: job.reviewRevision,
        });
      }
      case 'resume': {
        const job = await prepareXSyncResume(request.jobId, request.expectedScanRevision);
        return xSyncSuccess(request.requestId, {
          kind: 'accepted',
          jobId: job.id,
          scanRevision: job.scanRevision,
          reviewRevision: job.reviewRevision,
        });
      }
      case 'pause': {
        if (
          !activeXSyncRun ||
          activeXSyncRun.jobId !== request.jobId ||
          activeXSyncRun.scanRevision !== request.expectedScanRevision
        ) {
          throw new XSyncServiceError('stale_revision', 'scanning', {
            jobId: request.jobId,
            scanRevision: request.expectedScanRevision,
          });
        }
        activeXSyncRun.adapter.requestPause('user_paused');
        return xSyncSuccess(request.requestId, {
          kind: 'accepted',
          jobId: request.jobId,
          scanRevision: request.expectedScanRevision,
        });
      }
      case 'finalize': {
        const store = await openSyncStore();
        try {
          const job = await store.finalizePausedScan(request.jobId, request.expectedScanRevision);
          broadcastXSyncState(job);
          return xSyncSuccess(request.requestId, {
            kind: 'accepted',
            jobId: job.id,
            scanRevision: job.scanRevision,
            reviewRevision: job.reviewRevision,
          });
        } finally {
          store.close();
        }
      }
      case 'cancel': {
        if (activeXSyncRun?.jobId === request.jobId) {
          if (activeXSyncRun.scanRevision !== request.expectedScanRevision) {
            throw new XSyncServiceError('stale_revision', 'scanning');
          }
          activeXSyncRun.adapter.requestPause('user_paused');
          await activeXSyncRun.promise;
        }
        const store = await openSyncStore();
        try {
          const current = await store.getJob(request.jobId);
          if (
            !current ||
            current.scanRevision !== request.expectedScanRevision ||
            current.reviewRevision !== request.expectedReviewRevision
          ) {
            throw new XSyncServiceError('stale_revision', 'scanning');
          }
          const job =
            current.status === 'writing' ||
            current.status === 'partial' ||
            (current.status === 'paused' && current.stopRecord?.phase === 'writing')
              ? await store.abandonWriteJob(
                  current.id,
                  current.scanRevision,
                  current.reviewRevision,
                )
              : await store.cancelJob(current.id, current.scanRevision, current.reviewRevision);
          broadcastXSyncState(job);
          return xSyncSuccess(request.requestId, {
            kind: 'accepted',
            jobId: job.id,
            scanRevision: job.scanRevision,
            reviewRevision: job.reviewRevision,
          });
        } finally {
          store.close();
        }
      }
      case 'save-selection': {
        const store = await openSyncStore();
        try {
          const result = await store.saveReviewSelection(
            request.jobId,
            request.expectedReviewRevision,
            request.selectedSourceItemIds,
          );
          broadcastXSyncState(result.job);
          return xSyncSuccess(request.requestId, {
            kind: 'accepted',
            jobId: result.job.id,
            scanRevision: result.job.scanRevision,
            reviewRevision: result.job.reviewRevision,
          });
        } finally {
          store.close();
        }
      }
      case 'complete-without-writes': {
        const store = await openSyncStore();
        try {
          const job = await store.completeReviewWithoutWrites(
            request.jobId,
            request.expectedReviewRevision,
          );
          broadcastXSyncState(job);
          return xSyncSuccess(request.requestId, {
            kind: 'accepted',
            jobId: job.id,
            scanRevision: job.scanRevision,
            reviewRevision: job.reviewRevision,
          });
        } finally {
          store.close();
        }
      }
      case 'authorize': {
        const store = await openSyncStore();
        try {
          const job = await store.authorizeReviewSelection(
            request.jobId,
            request.expectedReviewRevision,
            request.selectedSourceItemIds,
          );
          broadcastXSyncState(job);
          return xSyncSuccess(request.requestId, {
            kind: 'accepted',
            jobId: job.id,
            scanRevision: job.scanRevision,
            reviewRevision: job.reviewRevision,
          });
        } finally {
          store.close();
        }
      }
    }
  } catch (error) {
    return xSyncErrorResponse(request, error);
  }
}

function handleXSyncUiMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<XSyncUiResponse> {
  let request: XSyncUiRequest;
  try {
    request = parseXSyncUiRequest(message);
  } catch {
    return Promise.resolve(xSyncFailure('invalid-request', 'invalid_message', 'launch'));
  }
  const extensionOrigin = resolveXSyncExtensionOrigin(
    chrome.runtime.id,
    chrome.runtime.getURL('/'),
  );
  const senderValidation = extensionOrigin
    ? validateXSyncUiSender(sender, chrome.runtime.id, extensionOrigin)
    : undefined;
  if (
    !senderValidation?.ok ||
    (request.type === 'launch'
      ? senderValidation.value.surface !== 'popup'
      : senderValidation.value.surface !== 'sidepanel')
  ) {
    return Promise.resolve(
      xSyncFailure(request.requestId, 'forbidden_sender', xSyncPhaseForRequest(request)),
    );
  }
  return runXSyncCommandExclusive(async () => {
    const bootstrap = await securityBootstrap;
    if (!bootstrap.ok) {
      return xSyncFailure(
        request.requestId,
        'security_bootstrap_failed',
        xSyncPhaseForRequest(request),
      );
    }
    const recovery = await ensureXSyncRecovery();
    if (!recovery.ok) {
      return xSyncFailure(request.requestId, 'storage_corrupt', xSyncPhaseForRequest(request));
    }
    return handleXSyncCommand(request);
  });
}

function handleXSyncPort(port: chrome.runtime.Port): void {
  const extensionOrigin = resolveXSyncExtensionOrigin(
    chrome.runtime.id,
    chrome.runtime.getURL('/'),
  );
  const senderValidation =
    extensionOrigin && port.sender
      ? validateXSyncUiSender(port.sender, chrome.runtime.id, extensionOrigin)
      : undefined;
  if (!senderValidation?.ok || senderValidation.value.surface !== 'sidepanel') {
    port.disconnect();
    return;
  }
  let disconnected = false;
  port.onDisconnect.addListener(() => {
    disconnected = true;
    xSyncPorts.delete(port);
  });
  void securityBootstrap.then((bootstrap) => {
    if (disconnected) {
      return;
    }
    if (!bootstrap.ok) {
      port.disconnect();
      return;
    }
    xSyncPorts.add(port);
  });
  port.onMessage.addListener((message: unknown) => {
    void securityBootstrap.then((bootstrap) => {
      if (bootstrap.ok && !disconnected) {
        xSyncPorts.add(port);
      }
      return handleXSyncUiMessage(message, port.sender!).then((response) => {
        if (disconnected) {
          return;
        }
        postXSyncPortValue(port, response);
        if (!bootstrap.ok) {
          port.disconnect();
        }
      });
    });
  });
}

let xSyncRecovery: Promise<{ readonly ok: boolean }> | undefined;

function ensureXSyncRecovery(): Promise<{ readonly ok: boolean }> {
  xSyncRecovery ??= openSyncStore()
    .then(async (store) => {
      try {
        await store.recoverInterruptedScanningJobs();
        return { ok: true } as const;
      } finally {
        store.close();
      }
    })
    .catch(() => ({ ok: false }) as const);
  return xSyncRecovery;
}

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
    bookmarkOperations: [],
    lastMoveRecordCount: lastMoveRecords.length,
    onboarded,
    settings,
  };
}

async function getStateSummary(): Promise<StateSummary> {
  const tree = await getFullTree();
  const summary = flattenBookmarkTree(tree);
  const settings = await getSettings();
  const pendingCaptures = await getPendingCaptures();
  const exportManifests = await getExportManifests();
  const vaultHandle = await getVaultHandle().catch(() => null);

  return {
    bookmarkCount: summary.bookmarks.length,
    folderCount: summary.folders.length,
    pendingCaptureCount: pendingCaptures.length,
    onboarded: await getOnboarded(),
    hasVaultHandle: Boolean(vaultHandle),
    hasAiProvider: settings.aiProviders.some(
      (provider) => provider.enabled && provider.apiKey.trim().length > 0,
    ),
    lastExportDate: exportManifests[0]?.exportedAt,
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

function sanitizeAiProviderTestResult(
  result: Awaited<ReturnType<typeof testAiProviderConnection>>,
): SafeAiProviderTestResult {
  if (result.success) {
    return AI_PROVIDER_CONNECTION_RESULTS.connection_ok;
  }

  if (result.message === '请先填写 API Key') {
    return AI_PROVIDER_CONNECTION_RESULTS.api_key_required;
  }
  if (result.message === '请先填写 API 地址') {
    return AI_PROVIDER_CONNECTION_RESULTS.base_url_required;
  }
  if (result.message === '请先填写模型名称') {
    return AI_PROVIDER_CONNECTION_RESULTS.model_required;
  }
  if (result.status === 401) {
    return AI_PROVIDER_CONNECTION_RESULTS.unauthorized;
  }
  if (result.status === 404) {
    return AI_PROVIDER_CONNECTION_RESULTS.not_found;
  }
  if (result.status !== undefined) {
    return AI_PROVIDER_CONNECTION_RESULTS.request_failed;
  }
  return AI_PROVIDER_CONNECTION_RESULTS.network_failed;
}

async function executeLegacyRequest(request: ExtensionRequest): Promise<unknown> {
  switch (request.type) {
    case 'security:getBootstrapStatus':
      return { ok: true, data: { ready: true } };
    case 'state:get':
      return { ok: true, data: await getState() };
    case 'state:summary':
      return { ok: true, data: await getStateSummary() };
    case 'operations:getRecent':
      return { ok: true, data: { operations: await getBookmarkOperations() } };
    case 'plan:create':
      return { ok: true, data: await createPlan(request.mode) };
    case 'settings:get':
      return { ok: true, data: await getSettings() };
    case 'settings:set': {
      const settings = normalizeSettings(request.settings);
      await saveSettings(settings);
      return { ok: true, data: settings };
    }
    case 'ai:testConnection':
      return {
        ok: true,
        data: sanitizeAiProviderTestResult(await testAiProviderConnection(request.provider)),
      };
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
        throw new Error('capture_failed');
      }

      const capture = await executeArticleExtractor(tab.id);
      const stored = await storeCapture(capture, tab);
      if (!stored) {
        throw new Error('capture_failed');
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
    case 'backups:list':
      return { ok: true, data: await listBackups() };
  }
}

function validatedLegacyResponse(
  request: ExtensionRequest,
  response: unknown,
): LegacyResponse<ExtensionRequest> {
  try {
    return parseLegacyResponse(request, response);
  } catch {
    return makeLegacyError('response_invalid');
  }
}

async function handleLegacyMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<LegacyResponse<ExtensionRequest>> {
  if (!validateExtensionUiSender(sender)) {
    return makeLegacyError('forbidden_sender');
  }
  let request: ExtensionRequest;
  try {
    request = parseExtensionRequest(message);
  } catch {
    return makeLegacyError('invalid_request');
  }

  const bootstrap = await securityBootstrap;
  if (!bootstrap.ok) {
    return request.type === 'security:getBootstrapStatus'
      ? makeLegacyError('security_bootstrap_failed')
      : makeLegacyError('storage_unavailable');
  }

  try {
    return validatedLegacyResponse(request, await executeLegacyRequest(request));
  } catch {
    return makeLegacyError('operation_failed');
  }
}

type BookmarkOperationMessageResponse =
  | { ok: true; data: BookmarkOperationCommandResponse }
  | {
      ok: false;
      error: 'Bookmark operation command rejected';
      errorCode: string;
    };

function hasBookmarkOperationTypePrefix(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, 'type');
    if (!descriptor) {
      return false;
    }
    if (!('value' in descriptor)) {
      return true;
    }
    return (
      typeof descriptor.value === 'string' && descriptor.value.startsWith('bookmarkOperations:')
    );
  } catch {
    return true;
  }
}

function bookmarkOperationFailure(errorCode: string): BookmarkOperationMessageResponse {
  return {
    ok: false,
    error: 'Bookmark operation command rejected',
    errorCode,
  };
}

function bookmarkOperationErrorCode(error: unknown): string {
  if (
    error instanceof BookmarkOperationCommandError ||
    error instanceof BookmarkOperationStorageError
  ) {
    return error.code;
  }
  return 'internal_error';
}

function publishBookmarkOperation(operation: BookmarkOperation): void {
  if (typeof chrome.runtime.sendMessage !== 'function') {
    return;
  }
  try {
    chrome.runtime.sendMessage(
      { type: 'bookmarkOperations:progress', operation },
      () => void chrome.runtime.lastError,
    );
  } catch {
    // The persisted journal remains authoritative if no extension page is listening.
  }
}

async function handleBookmarkOperationMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<BookmarkOperationMessageResponse> {
  if (!validateExtensionUiSender(sender)) {
    return bookmarkOperationFailure('forbidden_sender');
  }

  let command: BookmarkOperationCommand;
  try {
    command = parseBookmarkOperationCommand(message);
  } catch {
    return bookmarkOperationFailure('invalid_request');
  }

  const bootstrap = await securityBootstrap;
  if (!bootstrap.ok) {
    return bookmarkOperationFailure('storage_read_failed');
  }

  try {
    await reconcileInterruptedBookmarkOperations();
    let response: BookmarkOperationCommandResponse;
    switch (command.type) {
      case 'bookmarkOperations:delete':
        response = await executeDeleteBookmarks(command.requestId, command.bookmarkIds, 'health', {
          onChange: publishBookmarkOperation,
        });
        break;
      case 'bookmarkOperations:updateUrls':
        response = await executeBookmarkUrlUpdates(command.requestId, command.updates, 'health', {
          onChange: publishBookmarkOperation,
        });
        break;
      case 'bookmarkOperations:move':
        response = await executeBookmarkMoves(command.requestId, command.moves, 'classification', {
          onChange: publishBookmarkOperation,
        });
        break;
      case 'bookmarkOperations:restore':
        response = await restoreBookmarkOperation(command.requestId, command.operationId, {
          onChange: publishBookmarkOperation,
        });
        break;
      case 'bookmarkOperations:acceptCurrent':
        response = await acceptBookmarkOperationCurrentState(
          command.requestId,
          command.operationId,
          { onChange: publishBookmarkOperation },
        );
        break;
      case 'bookmarkOperations:cancel':
        response = await cancelBookmarkOperation(command.requestId, command.operationId, {
          onChange: publishBookmarkOperation,
        });
        break;
    }
    return {
      ok: true,
      data: parseBookmarkOperationCommandResponse(response),
    };
  } catch (error) {
    return bookmarkOperationFailure(bookmarkOperationErrorCode(error));
  }
}

function postClassificationMessage(
  port: chrome.runtime.Port,
  message: ClassificationPortMessage,
): void {
  try {
    port.postMessage(parseClassificationPortMessage(message));
  } catch {
    port.disconnect();
  }
}

function classificationRequestId(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, 'requestId');
    return descriptor &&
      'value' in descriptor &&
      typeof descriptor.value === 'string' &&
      /^[A-Za-z0-9:_-]{8,128}$/u.test(descriptor.value)
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function handleClassificationPort(port: chrome.runtime.Port): void {
  if (!validateExtensionUiSender(port.sender)) {
    port.disconnect();
    return;
  }

  let controller: AbortController | undefined;
  let activeRequestId: string | undefined;
  let lastProgress: ClassificationProgress = {
    done: 0,
    total: 0,
    batch: 0,
    totalBatches: 0,
    elapsedMs: 0,
  };

  port.onDisconnect.addListener(() => {
    controller?.abort();
    controller = undefined;
    activeRequestId = undefined;
  });

  port.onMessage.addListener((message: unknown) => {
    let request: ClassificationPortRequest;
    try {
      request = parseClassificationPortRequest(message);
    } catch {
      const requestId = classificationRequestId(message);
      if (requestId) {
        postClassificationMessage(port, {
          type: 'error',
          requestId,
          error: 'Classification request failed',
          errorCode: 'invalid_request',
        });
      }
      port.disconnect();
      return;
    }

    if (request.type === 'cancel') {
      if (!activeRequestId || request.targetRequestId !== activeRequestId) {
        postClassificationMessage(port, {
          type: 'error',
          requestId: request.requestId,
          error: 'Classification request failed',
          errorCode: 'operation_failed',
        });
        port.disconnect();
        return;
      }
      controller?.abort();
      controller = undefined;
      activeRequestId = undefined;
      postClassificationMessage(port, {
        type: 'cancelled',
        requestId: request.requestId,
        targetRequestId: request.targetRequestId,
      });
      port.disconnect();
      return;
    }

    if (activeRequestId) {
      postClassificationMessage(port, {
        type: 'error',
        requestId: request.requestId,
        error: 'Classification request failed',
        errorCode: 'classification_in_progress',
      });
      port.disconnect();
      return;
    }
    activeRequestId = request.requestId;

    void securityBootstrap.then(async (bootstrap) => {
      if (activeRequestId !== request.requestId) {
        return;
      }
      if (!bootstrap.ok) {
        activeRequestId = undefined;
        postClassificationMessage(port, {
          type: 'error',
          requestId: request.requestId,
          error: 'Classification request failed',
          errorCode: 'storage_unavailable',
        });
        port.disconnect();
        return;
      }

      controller = new AbortController();
      const requestController = controller;
      try {
        const plan = await createPlan(request.mode, {
          signal: requestController.signal,
          onProgress: (progress) => {
            if (activeRequestId !== request.requestId) {
              return;
            }
            lastProgress = progress;
            postClassificationMessage(port, {
              type: 'progress',
              requestId: request.requestId,
              progress,
            });
          },
        });
        if (activeRequestId === request.requestId) {
          postClassificationMessage(port, {
            type: 'complete',
            requestId: request.requestId,
            plan,
            progress: {
              ...lastProgress,
              cancelled: requestController.signal.aborted,
            },
            cancelled: requestController.signal.aborted,
          });
        }
      } catch {
        if (activeRequestId === request.requestId) {
          postClassificationMessage(port, {
            type: 'error',
            requestId: request.requestId,
            error: 'Classification request failed',
            errorCode: 'operation_failed',
          });
        }
      } finally {
        if (activeRequestId === request.requestId) {
          activeRequestId = undefined;
        }
        if (controller === requestController) {
          controller = undefined;
        }
      }
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void securityBootstrap.then((bootstrap) => {
    if (!bootstrap.ok) {
      return;
    }
    if (chrome.sidePanel?.setPanelBehavior) {
      void chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: false })
        .catch(() => undefined);
    }

    chrome.contextMenus.removeAll(() => {
      if (chrome.runtime.lastError) {
        return;
      }
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
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (hasXSyncProtocolEnvelope(message)) {
    void handleXSyncUiMessage(message, sender).then(sendResponse);
    return true;
  }
  if (hasBookmarkOperationTypePrefix(message)) {
    void handleBookmarkOperationMessage(message, sender).then(sendResponse);
    return true;
  }
  void handleLegacyMessage(message, sender).then(sendResponse);
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === X_SYNC_PROTOCOL) {
    handleXSyncPort(port);
    return;
  }

  if (port.name === 'classify') {
    handleClassificationPort(port);
    return;
  }

  port.disconnect();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (
    activeXSyncRun?.tabId === tabId &&
    (changeInfo.status === 'loading' ||
      (changeInfo.url !== undefined && changeInfo.url !== X_SYNC_BOOKMARKS_URL))
  ) {
    activeXSyncRun.adapter.requestPause('tab_changed');
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  if (
    activeXSyncRun?.windowId === activeInfo.windowId &&
    activeXSyncRun.tabId !== activeInfo.tabId
  ) {
    activeXSyncRun.adapter.requestPause('tab_changed');
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeXSyncRun?.tabId === tabId) {
    activeXSyncRun.adapter.requestPause('tab_changed');
  }
});

chrome.permissions.onRemoved.addListener((permissions) => {
  if (permissions.origins?.includes(X_SYNC_ORIGIN)) {
    activeXSyncRun?.adapter.requestPause('permission_revoked');
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void securityBootstrap.then((bootstrap) => {
    if (!bootstrap.ok) {
      return;
    }

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
});
