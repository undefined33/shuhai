import {
  X_SYNC_BOOKMARKS_URL,
  parseXSyncDocumentBinding,
  type XSyncDocumentBinding,
  type XSyncScanMode,
} from './x-sync-messages.js';

export const X_SYNC_MIN_SCROLL_INTERVAL_MS = 2_000 as const;
export const X_SYNC_MAX_SCROLL_ACTIONS = 20 as const;
export const X_SYNC_PROBE_MAX_SCROLL_ACTIONS = 5 as const;

const SAFE_RUNTIME_TOKEN = /^[A-Za-z0-9_-]{32,96}$/u;

export type XSyncRuntimeProfile = 'standard' | 'bounded_probe';
export type XSyncRuntimePauseReason =
  | 'user_paused'
  | 'budget_exceeded'
  | 'login_required'
  | 'rate_limited'
  | 'structure_changed'
  | 'no_progress'
  | 'tab_changed'
  | 'permission_revoked';

export interface XSyncRuntimeStartInput {
  readonly jobId: string;
  readonly scanRevision: number;
  readonly tabId: number;
  readonly windowId: number;
  readonly documentId: string;
  readonly mode: XSyncScanMode;
  readonly profile?: XSyncRuntimeProfile;
  readonly maxScrollActions?: number;
}

export interface XSyncInvocationLease {
  readonly source: 'x';
  readonly invocationId: string;
  readonly mode: XSyncScanMode;
  readonly profile: XSyncRuntimeProfile;
  readonly maxScrollActions: number;
  readonly binding: XSyncDocumentBinding;
}

export type XSyncRuntimeConflictCode = 'source_busy' | 'request_in_flight' | 'stale_invocation';

export interface XSyncRuntimeConflict {
  readonly code: XSyncRuntimeConflictCode;
  readonly activeJobId?: string;
  readonly activeScanRevision?: number;
}

export interface XSyncRuntimePause {
  readonly reason: XSyncRuntimePauseReason;
  readonly code:
    | 'pause_requested'
    | 'content_stop'
    | 'request_failed'
    | 'invalid_clock'
    | 'scroll_budget_exceeded';
  readonly phase: 'scanning';
  readonly jobId: string;
  readonly scanRevision: number;
}

export interface XSyncRuntimeError {
  readonly code: 'invalid_input' | 'invalid_clock' | 'random_unavailable';
  readonly phase: 'scanning';
  readonly jobId?: string;
  readonly scanRevision?: number;
}

export type XSyncBeginInvocationResult =
  | { readonly kind: 'started'; readonly lease: XSyncInvocationLease }
  | { readonly kind: 'conflict'; readonly conflict: XSyncRuntimeConflict }
  | { readonly kind: 'error'; readonly error: XSyncRuntimeError };

export type XSyncPauseInvocationResult =
  | { readonly kind: 'pause-requested'; readonly pause: XSyncRuntimePause }
  | { readonly kind: 'paused'; readonly pause: XSyncRuntimePause }
  | { readonly kind: 'conflict'; readonly conflict: XSyncRuntimeConflict };

export type XSyncFinishInvocationResult =
  | {
      readonly kind: 'finished';
      readonly jobId: string;
      readonly scanRevision: number;
      readonly scrollActions: number;
    }
  | { readonly kind: 'conflict'; readonly conflict: XSyncRuntimeConflict };

export type XSyncContentOperationResult<T> =
  | { readonly kind: 'response'; readonly value: T }
  | { readonly kind: 'pause'; readonly reason: XSyncRuntimePauseReason };

export type XSyncContentRequestResult<T> =
  | { readonly kind: 'completed'; readonly value: T }
  | { readonly kind: 'paused'; readonly pause: XSyncRuntimePause }
  | { readonly kind: 'conflict'; readonly conflict: XSyncRuntimeConflict };

export interface XSyncContentRequestDescriptor {
  readonly kind: 'batch' | 'ping';
  readonly performsScroll: boolean;
}

export interface XSyncRuntimeSnapshot {
  readonly source: 'x';
  readonly status: 'idle' | 'active' | 'stopping';
  readonly jobId?: string;
  readonly scanRevision?: number;
  readonly outstandingRequest: boolean;
  readonly scrollActions: number;
  readonly maxScrollActions: number;
}

export interface XSyncRuntimeOptions {
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly randomToken?: () => string;
}

interface ActiveInvocation {
  readonly lease: XSyncInvocationLease;
  outstandingRequest: boolean;
  requestController?: AbortController;
  pauseRequest?: XSyncRuntimePause;
  scrollActions: number;
  lastScrollCompletedAt?: number;
}

function defaultRandomToken(): string {
  const random = globalThis.crypto?.getRandomValues;
  if (typeof random !== 'function') {
    throw new Error('random unavailable');
  }
  const bytes = new Uint8Array(32);
  Reflect.apply(random, globalThis.crypto, [bytes]);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function isPauseReason(value: unknown): value is XSyncRuntimePauseReason {
  return [
    'user_paused',
    'budget_exceeded',
    'login_required',
    'rate_limited',
    'structure_changed',
    'no_progress',
    'tab_changed',
    'permission_revoked',
  ].includes(value as string);
}

export class XSyncRuntime {
  private active?: ActiveInvocation;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private readonly randomToken: () => string;

  constructor(options: XSyncRuntimeOptions = {}) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.randomToken = options.randomToken ?? defaultRandomToken;
  }

  beginInvocation(input: XSyncRuntimeStartInput): XSyncBeginInvocationResult {
    if (this.active) {
      return { kind: 'conflict', conflict: this.activeConflict('source_busy') };
    }
    const profile = input.profile ?? 'standard';
    const profileCeiling =
      profile === 'bounded_probe'
        ? X_SYNC_PROBE_MAX_SCROLL_ACTIONS
        : profile === 'standard'
          ? X_SYNC_MAX_SCROLL_ACTIONS
          : undefined;
    if (profileCeiling === undefined || !['incremental', 'backfill'].includes(input.mode)) {
      return { kind: 'error', error: this.error('invalid_input', 'scanning') };
    }
    const requestedScrollActions = input.maxScrollActions ?? profileCeiling;
    if (!Number.isSafeInteger(requestedScrollActions) || requestedScrollActions < 1) {
      return { kind: 'error', error: this.error('invalid_input', 'scanning') };
    }
    const maxScrollActions = Math.min(requestedScrollActions, profileCeiling);

    let nonce: string;
    let invocationId: string;
    try {
      nonce = this.randomToken();
      invocationId = this.randomToken();
    } catch {
      return { kind: 'error', error: this.error('random_unavailable', 'scanning') };
    }
    if (!SAFE_RUNTIME_TOKEN.test(nonce) || !SAFE_RUNTIME_TOKEN.test(invocationId)) {
      return { kind: 'error', error: this.error('random_unavailable', 'scanning') };
    }
    if (this.clock() === null) {
      return { kind: 'error', error: this.error('invalid_clock', 'scanning') };
    }

    let binding: XSyncDocumentBinding;
    try {
      binding = parseXSyncDocumentBinding({
        jobId: input.jobId,
        scanRevision: input.scanRevision,
        tabId: input.tabId,
        windowId: input.windowId,
        frameId: 0,
        documentId: input.documentId,
        exactUrl: X_SYNC_BOOKMARKS_URL,
        nonce,
      });
    } catch {
      return { kind: 'error', error: this.error('invalid_input', 'scanning') };
    }

    const lease: XSyncInvocationLease = Object.freeze({
      source: 'x',
      invocationId,
      mode: input.mode,
      profile,
      maxScrollActions,
      binding: Object.freeze(binding),
    });
    this.active = {
      lease,
      outstandingRequest: false,
      scrollActions: 0,
    };
    return { kind: 'started', lease };
  }

  async executeContentRequest<T>(
    lease: XSyncInvocationLease,
    descriptor: XSyncContentRequestDescriptor,
    operation: (signal: AbortSignal) => Promise<XSyncContentOperationResult<T>>,
  ): Promise<XSyncContentRequestResult<T>> {
    const state = this.requireActiveLease(lease);
    if (!state) {
      return { kind: 'conflict', conflict: { code: 'stale_invocation' } };
    }
    if (state.outstandingRequest) {
      return { kind: 'conflict', conflict: this.activeConflict('request_in_flight') };
    }
    if (
      !['batch', 'ping'].includes(descriptor.kind) ||
      typeof descriptor.performsScroll !== 'boolean' ||
      (descriptor.kind === 'ping' && descriptor.performsScroll)
    ) {
      return {
        kind: 'paused',
        pause: this.releaseAsPaused(state, 'structure_changed', 'request_failed'),
      };
    }
    if (descriptor.performsScroll && state.scrollActions >= lease.maxScrollActions) {
      return {
        kind: 'paused',
        pause: this.releaseAsPaused(state, 'budget_exceeded', 'scroll_budget_exceeded'),
      };
    }

    state.outstandingRequest = true;
    const controller = new AbortController();
    state.requestController = controller;
    try {
      if (descriptor.kind === 'batch') {
        const pacingPause = await this.waitForScrollPacing(state, controller.signal);
        if (pacingPause) {
          return { kind: 'paused', pause: pacingPause };
        }
      }
      if (state.pauseRequest) {
        return { kind: 'paused', pause: this.releaseRequestedPause(state) };
      }

      let outcome: XSyncContentOperationResult<T>;
      try {
        outcome = await operation(controller.signal);
      } catch {
        if (state.pauseRequest) {
          return { kind: 'paused', pause: this.releaseRequestedPause(state) };
        }
        return {
          kind: 'paused',
          pause: this.releaseAsPaused(state, 'structure_changed', 'request_failed'),
        };
      }
      if (state.pauseRequest) {
        return { kind: 'paused', pause: this.releaseRequestedPause(state) };
      }
      if (outcome.kind === 'pause' && isPauseReason(outcome.reason)) {
        return {
          kind: 'paused',
          pause: this.releaseAsPaused(state, outcome.reason, 'content_stop'),
        };
      }
      if (outcome.kind !== 'response') {
        return {
          kind: 'paused',
          pause: this.releaseAsPaused(state, 'structure_changed', 'request_failed'),
        };
      }

      if (descriptor.performsScroll) {
        const completedAt = this.clock();
        if (completedAt === null) {
          return {
            kind: 'paused',
            pause: this.releaseAsPaused(state, 'structure_changed', 'invalid_clock'),
          };
        }
        state.scrollActions += 1;
        state.lastScrollCompletedAt = completedAt;
      }
      return { kind: 'completed', value: outcome.value };
    } finally {
      if (this.active === state) {
        state.outstandingRequest = false;
        state.requestController = undefined;
      }
    }
  }

  requestPause(
    lease: XSyncInvocationLease,
    reason: XSyncRuntimePauseReason = 'user_paused',
  ): XSyncPauseInvocationResult {
    const state = this.requireActiveLease(lease);
    if (!state || !isPauseReason(reason)) {
      return { kind: 'conflict', conflict: { code: 'stale_invocation' } };
    }
    if (!state.pauseRequest) {
      state.pauseRequest = this.pause(state, reason, 'pause_requested');
    }
    if (state.outstandingRequest) {
      state.requestController?.abort();
      return { kind: 'pause-requested', pause: state.pauseRequest };
    }
    return { kind: 'paused', pause: this.releaseRequestedPause(state) };
  }

  finishInvocation(lease: XSyncInvocationLease): XSyncFinishInvocationResult {
    const state = this.requireActiveLease(lease);
    if (!state) {
      return { kind: 'conflict', conflict: { code: 'stale_invocation' } };
    }
    if (state.outstandingRequest) {
      return { kind: 'conflict', conflict: this.activeConflict('request_in_flight') };
    }
    this.active = undefined;
    return {
      kind: 'finished',
      jobId: lease.binding.jobId,
      scanRevision: lease.binding.scanRevision,
      scrollActions: state.scrollActions,
    };
  }

  snapshot(): XSyncRuntimeSnapshot {
    if (!this.active) {
      return {
        source: 'x',
        status: 'idle',
        outstandingRequest: false,
        scrollActions: 0,
        maxScrollActions: 0,
      };
    }
    return {
      source: 'x',
      status: this.active.pauseRequest ? 'stopping' : 'active',
      jobId: this.active.lease.binding.jobId,
      scanRevision: this.active.lease.binding.scanRevision,
      outstandingRequest: this.active.outstandingRequest,
      scrollActions: this.active.scrollActions,
      maxScrollActions: this.active.lease.maxScrollActions,
    };
  }

  private async waitForScrollPacing(
    state: ActiveInvocation,
    signal: AbortSignal,
  ): Promise<XSyncRuntimePause | undefined> {
    if (state.lastScrollCompletedAt === undefined) {
      return undefined;
    }
    const beforeWait = this.clock();
    if (beforeWait === null || beforeWait < state.lastScrollCompletedAt) {
      return this.releaseAsPaused(state, 'structure_changed', 'invalid_clock');
    }
    const remaining = X_SYNC_MIN_SCROLL_INTERVAL_MS - (beforeWait - state.lastScrollCompletedAt);
    if (remaining > 0) {
      try {
        await this.sleep(remaining, signal);
      } catch {
        if (state.pauseRequest) {
          return this.releaseRequestedPause(state);
        }
        return this.releaseAsPaused(state, 'structure_changed', 'request_failed');
      }
    }
    if (state.pauseRequest) {
      return this.releaseRequestedPause(state);
    }
    const afterWait = this.clock();
    if (
      afterWait === null ||
      afterWait < state.lastScrollCompletedAt ||
      afterWait - state.lastScrollCompletedAt < X_SYNC_MIN_SCROLL_INTERVAL_MS
    ) {
      return this.releaseAsPaused(state, 'structure_changed', 'invalid_clock');
    }
    return undefined;
  }

  private requireActiveLease(lease: XSyncInvocationLease): ActiveInvocation | undefined {
    return this.active?.lease === lease ? this.active : undefined;
  }

  private activeConflict(code: XSyncRuntimeConflictCode): XSyncRuntimeConflict {
    return {
      code,
      ...(this.active
        ? {
            activeJobId: this.active.lease.binding.jobId,
            activeScanRevision: this.active.lease.binding.scanRevision,
          }
        : {}),
    };
  }

  private pause(
    state: ActiveInvocation,
    reason: XSyncRuntimePauseReason,
    code: XSyncRuntimePause['code'],
  ): XSyncRuntimePause {
    return Object.freeze({
      reason,
      code,
      phase: 'scanning',
      jobId: state.lease.binding.jobId,
      scanRevision: state.lease.binding.scanRevision,
    });
  }

  private releaseAsPaused(
    state: ActiveInvocation,
    reason: XSyncRuntimePauseReason,
    code: XSyncRuntimePause['code'],
  ): XSyncRuntimePause {
    const pause = this.pause(state, reason, code);
    state.outstandingRequest = false;
    state.requestController = undefined;
    if (this.active === state) {
      this.active = undefined;
    }
    return pause;
  }

  private releaseRequestedPause(state: ActiveInvocation): XSyncRuntimePause {
    const pause = state.pauseRequest ?? this.pause(state, 'user_paused', 'pause_requested');
    state.outstandingRequest = false;
    state.requestController = undefined;
    if (this.active === state) {
      this.active = undefined;
    }
    return pause;
  }

  private clock(): number | null {
    try {
      const value = this.now();
      return Number.isFinite(value) && value >= 0 ? value : null;
    } catch {
      return null;
    }
  }

  private error(
    code: XSyncRuntimeError['code'],
    phase: XSyncRuntimeError['phase'],
    jobId?: string,
    scanRevision?: number,
  ): XSyncRuntimeError {
    return Object.freeze({
      code,
      phase,
      ...(jobId === undefined ? {} : { jobId }),
      ...(scanRevision === undefined ? {} : { scanRevision }),
    });
  }
}
