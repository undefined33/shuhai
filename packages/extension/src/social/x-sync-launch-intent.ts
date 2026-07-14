import {
  X_SYNC_LAUNCH_INTENT_TTL_MS,
  parseXSyncLaunchIntent,
  type XSyncLaunchIntent,
} from './x-sync-messages.js';

export const X_SYNC_LAUNCH_INTENT_KEY = 'shuhai:x-sync:v1:launch-intent' as const;
export const X_SYNC_LAUNCH_WAIT_MS = 2_000 as const;
export const X_SYNC_LAUNCH_WAIT_ATTEMPTS = 5 as const;
const SAFE_NONCE_PATTERN = /^[A-Za-z0-9_-]{32,96}$/u;

export interface XSyncSessionStoragePort {
  get(key: typeof X_SYNC_LAUNCH_INTENT_KEY): Promise<unknown>;
  set(key: typeof X_SYNC_LAUNCH_INTENT_KEY, value: XSyncLaunchIntent): Promise<void>;
  remove(key: typeof X_SYNC_LAUNCH_INTENT_KEY): Promise<void>;
}

export type XSyncLaunchWindowValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'window_missing' | 'tab_changed' };

export interface XSyncLaunchIntentOptions {
  readonly now?: () => number;
  readonly randomNonce?: () => string;
}

export type XSyncLaunchIntentErrorCode =
  | 'invalid_request'
  | 'invalid_clock'
  | 'random_unavailable'
  | 'storage_error'
  | 'storage_corrupt'
  | 'missing'
  | 'expired'
  | 'nonce_mismatch'
  | 'window_missing'
  | 'tab_changed'
  | 'validation_failed';

const ERROR_MESSAGES: Readonly<Record<XSyncLaunchIntentErrorCode, string>> = Object.freeze({
  invalid_request: 'The X sync launch request is invalid',
  invalid_clock: 'The X sync launch clock is invalid',
  random_unavailable: 'A secure X sync launch nonce is unavailable',
  storage_error: 'The X sync launch session storage operation failed',
  storage_corrupt: 'The X sync launch session intent is corrupt',
  missing: 'The X sync launch intent is missing',
  expired: 'The X sync launch intent has expired',
  nonce_mismatch: 'The X sync launch nonce does not match',
  window_missing: 'The X sync launch window is unavailable',
  tab_changed: 'The X sync launch tab changed',
  validation_failed: 'The X sync launch context could not be validated',
});

export class XSyncLaunchIntentError extends Error {
  readonly code: XSyncLaunchIntentErrorCode;

  constructor(code: XSyncLaunchIntentErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'XSyncLaunchIntentError';
    this.code = code;
  }
}

function defaultRandomNonce(): string {
  const random = globalThis.crypto?.getRandomValues;
  if (typeof random !== 'function') {
    throw new XSyncLaunchIntentError('random_unavailable');
  }
  const bytes = new Uint8Array(32);
  try {
    Reflect.apply(random, globalThis.crypto, [bytes]);
  } catch {
    throw new XSyncLaunchIntentError('random_unavailable');
  }
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export class XSyncLaunchIntentStore {
  private queue: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly randomNonce: () => string;

  constructor(
    private readonly storage: XSyncSessionStoragePort,
    options: XSyncLaunchIntentOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.randomNonce = options.randomNonce ?? defaultRandomNonce;
  }

  create(input: { readonly serverValidatedWindowId: number }): Promise<XSyncLaunchIntent> {
    return this.exclusive(async () => {
      const createdAtMs = this.clock();
      let nonce: string;
      try {
        nonce = this.randomNonce();
      } catch (error) {
        if (error instanceof XSyncLaunchIntentError) {
          throw error;
        }
        throw new XSyncLaunchIntentError('random_unavailable');
      }
      if (!SAFE_NONCE_PATTERN.test(nonce)) {
        throw new XSyncLaunchIntentError('random_unavailable');
      }

      let intent: XSyncLaunchIntent;
      try {
        intent = parseXSyncLaunchIntent({
          protocol: 'shuhai:x-sync:v1',
          action: 'start',
          windowId: input.serverValidatedWindowId,
          createdAtMs,
          expiresAtMs: createdAtMs + X_SYNC_LAUNCH_INTENT_TTL_MS,
          nonce,
        });
      } catch {
        throw new XSyncLaunchIntentError('invalid_request');
      }

      try {
        await this.storage.set(X_SYNC_LAUNCH_INTENT_KEY, intent);
      } catch {
        throw new XSyncLaunchIntentError('storage_error');
      }
      return Object.freeze(intent);
    });
  }

  consume(
    nonceInput: unknown,
    revalidateWindow: (windowId: number) => Promise<XSyncLaunchWindowValidation>,
  ): Promise<XSyncLaunchIntent> {
    return this.exclusive(async () => {
      let rawIntent: unknown;
      try {
        rawIntent = await this.storage.get(X_SYNC_LAUNCH_INTENT_KEY);
      } catch {
        throw new XSyncLaunchIntentError('storage_error');
      }
      if (rawIntent === undefined || rawIntent === null) {
        throw new XSyncLaunchIntentError('missing');
      }

      let intent: XSyncLaunchIntent;
      try {
        intent = parseXSyncLaunchIntent(rawIntent);
      } catch {
        await this.removeOrThrow();
        throw new XSyncLaunchIntentError('storage_corrupt');
      }

      const now = this.clock();
      if (now >= intent.expiresAtMs || now < intent.createdAtMs) {
        await this.removeOrThrow();
        throw new XSyncLaunchIntentError('expired');
      }
      if (typeof nonceInput !== 'string' || !SAFE_NONCE_PATTERN.test(nonceInput)) {
        throw new XSyncLaunchIntentError('invalid_request');
      }
      if (nonceInput !== intent.nonce) {
        throw new XSyncLaunchIntentError('nonce_mismatch');
      }

      await this.removeOrThrow();

      let validation: XSyncLaunchWindowValidation;
      try {
        validation = await revalidateWindow(intent.windowId);
      } catch {
        throw new XSyncLaunchIntentError('validation_failed');
      }
      if (validation.ok) {
        return Object.freeze(intent);
      }
      if (validation.code === 'window_missing' || validation.code === 'tab_changed') {
        throw new XSyncLaunchIntentError(validation.code);
      }
      throw new XSyncLaunchIntentError('validation_failed');
    });
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private clock(): number {
    let value: number;
    try {
      value = this.now();
    } catch {
      throw new XSyncLaunchIntentError('invalid_clock');
    }
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new XSyncLaunchIntentError('invalid_clock');
    }
    return value;
  }

  private async removeOrThrow(): Promise<void> {
    try {
      await this.storage.remove(X_SYNC_LAUNCH_INTENT_KEY);
    } catch {
      throw new XSyncLaunchIntentError('storage_error');
    }
  }
}
