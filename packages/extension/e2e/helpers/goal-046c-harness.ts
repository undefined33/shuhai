import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import type { BrowserContext, Page } from '@playwright/test';

import {
  SyncJobItemRowSchema,
  SyncJobRowSchema,
  WriteIntentSchema,
  type SyncJobItemRow,
  type SyncJobRow,
  type WriteIntent,
} from '../../src/social/sync-schema.js';

const helperDirectory = path.dirname(fileURLToPath(import.meta.url));
export const WORKTREE_ROOT = path.resolve(helperDirectory, '../../../..');
export const EXTENSION_DIST = path.join(WORKTREE_ROOT, 'packages', 'extension', 'dist');
const CACHE_ROOT = path.join(WORKTREE_ROOT, 'node_modules', '.cache', 'shuhai-goal-046c');
const RUN_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;
const RUN_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUN_OWNER_MARKER = '.goal-046c-owner.json';
const SAFE_EXTENSION_ID_PATTERN = /^[a-p]{32}$/u;
const encoder = new TextEncoder();

export interface RunLayout {
  readonly runId: string;
  readonly runRoot: string;
  readonly artifactsRoot: string;
  readonly screenshotsRoot: string;
  readonly profileRoot: string;
  readonly runnerRoot: string;
}

export interface FixtureServer {
  readonly origin: string;
  readonly server: Server;
  close(): Promise<void>;
}

export interface FakeChromeScenario {
  readonly activeTabUrl: string;
  readonly surfaceSummary?: unknown;
  readonly bookmarkSnapshot?: unknown;
  readonly operations?: readonly unknown[];
  readonly settings?: unknown;
  readonly classificationPlan?: unknown;
  readonly xPermissionOrigins?: readonly string[];
}

export interface FakeChromeLedger {
  readonly tags: Readonly<Record<string, number>>;
  readonly forbiddenCalls: number;
  readonly pickerCalls: number;
  readonly permissionMutationCalls: number;
  readonly bookmarkMutationCalls: number;
  readonly sidePanelOpenCalls: number;
  readonly optionsOpenCalls: number;
  readonly xCommandCalls: number;
}

export interface FixtureSeed {
  readonly jobs?: readonly SyncJobRow[];
  readonly items?: readonly SyncJobItemRow[];
  readonly intents?: readonly WriteIntent[];
  readonly emptyVaultStore?: boolean;
}

export interface PageDiagnostics {
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
}

export interface PageAuditOptions {
  readonly bodySelector: string;
  readonly auxiliarySelector: string;
  readonly focusNames: readonly string[];
  readonly keySelectors?: readonly string[];
}

export interface PageAudit {
  readonly horizontalOverflow: number;
  readonly unnamedControls: readonly string[];
  readonly duplicateIds: readonly string[];
  readonly minimumVisibleTextPx: number | null;
  readonly bodyTextPx: number;
  readonly auxiliaryTextPx: number;
  readonly primaryCtaCount: number;
  readonly focusOrder: readonly string[];
  readonly focusVisible: boolean;
  readonly missingFocusNames: readonly string[];
  readonly keyGeometryFailures: readonly string[];
}

export interface ScenarioEvidence {
  readonly id: string;
  readonly layer: 'A' | 'B';
  readonly surface: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly theme: 'light' | 'dark';
  readonly textScale: string;
  readonly fontScaleEvidence?: {
    readonly rootPx: { readonly before: number; readonly after: number };
    readonly bodyPx: { readonly before: number; readonly after: number };
    readonly auxiliaryPx: { readonly before: number; readonly after: number };
  };
  readonly fixtureSeed?: {
    readonly recordCount: number;
    readonly bytes: number;
  };
  readonly readyTimeMs: number;
  readonly audit: PageAudit;
  readonly diagnostics: PageDiagnostics;
  readonly apiLedger?: FakeChromeLedger;
  readonly externalRequestBlockedCount: number;
  readonly screenshot: string;
  readonly status: 'PASS' | 'FAIL';
}

export interface Goal046cReport {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly branch: string;
  readonly head: string;
  readonly distBundleSha256: Readonly<Record<string, string>>;
  readonly chromiumVersion: string;
  readonly profile: string;
  readonly extensionId: string;
  readonly mountMode: 'direct_extension_page';
  readonly bookmarkDigest: {
    readonly before: string;
    readonly after: string;
    readonly nodeCountBefore: number;
    readonly nodeCountAfter: number;
  };
  readonly xPermission: { readonly before: boolean; readonly after: boolean };
  readonly vaultHandleCount: { readonly before: number; readonly after: number };
  readonly seededFixtureRecords: number;
  readonly seededFixtureBytes: number;
  readonly scenarios: readonly ScenarioEvidence[];
  readonly handles: {
    readonly persistentContextCreated: boolean;
    readonly persistentContextClosed: boolean;
    readonly fixtureServerCreated: boolean;
    readonly fixtureServerClosed: boolean;
    readonly fixtureBrowserCreated: boolean;
    readonly fixtureBrowserClosed: boolean;
  };
  readonly runnerTraceRoot: string;
  readonly overall: 'PASS' | 'FAIL';
}

function comparablePath(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isStrictChild(parent: string, candidate: string): boolean {
  const comparableParent = comparablePath(parent);
  const comparableCandidate = comparablePath(candidate);
  return comparableCandidate.startsWith(`${comparableParent}${path.sep}`);
}

function assertNormalDirectory(directory: string, label: string): void {
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label}_not_normal_directory`);
  }
}

export function assertNormalFile(filePath: string, label: string): void {
  const metadata = lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label}_not_normal_file`);
  }
}

function validateRunBase(): string {
  const runId = process.env.SHUHAI_GOAL_046C_RUN_ID;
  if (!runId || !RUN_ID_PATTERN.test(runId)) {
    throw new Error('invalid_goal_046c_run_id');
  }
  if (comparablePath(process.cwd()) !== comparablePath(WORKTREE_ROOT)) {
    throw new Error('goal_046c_wrong_worktree');
  }
  if (!existsSync(EXTENSION_DIST)) {
    throw new Error('goal_046c_dist_missing');
  }
  assertNormalDirectory(EXTENSION_DIST, 'goal_046c_dist');
  return runId;
}

export function preflightRunLayout(): string {
  const runId = validateRunBase();
  mkdirSync(CACHE_ROOT, { recursive: true });
  assertNormalDirectory(CACHE_ROOT, 'goal_046c_cache_root');

  const runRoot = path.join(CACHE_ROOT, runId);
  if (!isStrictChild(CACHE_ROOT, runRoot)) {
    throw new Error('goal_046c_run_root_outside_cache');
  }
  if (existsSync(runRoot)) {
    throw new Error('goal_046c_run_root_already_exists');
  }
  mkdirSync(runRoot);
  assertNormalDirectory(runRoot, 'goal_046c_run_root');

  const runToken = randomUUID();
  writeFileSync(
    path.join(runRoot, RUN_OWNER_MARKER),
    `${JSON.stringify({ schemaVersion: 1, runId, runToken })}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
  assertNormalFile(path.join(runRoot, RUN_OWNER_MARKER), 'goal_046c_owner_marker');
  return runToken;
}

export function prepareRunLayout(): RunLayout {
  const runId = validateRunBase();
  const runToken = process.env.SHUHAI_GOAL_046C_RUN_TOKEN;
  if (!runToken || !RUN_TOKEN_PATTERN.test(runToken)) {
    throw new Error('invalid_goal_046c_run_token');
  }

  assertNormalDirectory(CACHE_ROOT, 'goal_046c_cache_root');
  const runRoot = path.join(CACHE_ROOT, runId);
  if (!isStrictChild(CACHE_ROOT, runRoot) || !existsSync(runRoot)) {
    throw new Error('goal_046c_run_root_missing');
  }
  assertNormalDirectory(runRoot, 'goal_046c_run_root');

  const allowedEntries = new Set([RUN_OWNER_MARKER, 'runner']);
  const unexpected = readdirSync(runRoot).filter((entry) => !allowedEntries.has(entry));
  if (unexpected.length > 0) {
    throw new Error('goal_046c_run_root_reused');
  }
  const ownerMarker = path.join(runRoot, RUN_OWNER_MARKER);
  assertNormalFile(ownerMarker, 'goal_046c_owner_marker');
  let owner: unknown;
  try {
    owner = JSON.parse(readFileSync(ownerMarker, 'utf8')) as unknown;
  } catch {
    throw new Error('goal_046c_owner_marker_invalid');
  }
  if (
    typeof owner !== 'object' ||
    owner === null ||
    (owner as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    (owner as { runId?: unknown }).runId !== runId ||
    (owner as { runToken?: unknown }).runToken !== runToken
  ) {
    throw new Error('goal_046c_owner_marker_mismatch');
  }

  const runnerRoot = path.join(runRoot, 'runner');
  const artifactsRoot = path.join(runRoot, 'artifacts');
  const screenshotsRoot = path.join(artifactsRoot, 'screenshots');
  const profileRoot = path.join(artifactsRoot, 'profile');

  if (existsSync(runnerRoot)) {
    assertNormalDirectory(runnerRoot, 'goal_046c_runner_root');
  }
  if (existsSync(artifactsRoot) || existsSync(profileRoot)) {
    throw new Error('goal_046c_artifacts_already_exist');
  }

  mkdirSync(screenshotsRoot, { recursive: true });
  assertNormalDirectory(artifactsRoot, 'goal_046c_artifacts_root');
  assertNormalDirectory(screenshotsRoot, 'goal_046c_screenshots_root');
  if (!isStrictChild(runRoot, artifactsRoot) || !isStrictChild(artifactsRoot, profileRoot)) {
    throw new Error('goal_046c_artifact_path_invalid');
  }

  return { runId, runRoot, artifactsRoot, screenshotsRoot, profileRoot, runnerRoot };
}

const DIST_BUNDLES = [
  'background/service-worker.js',
  'popup.js',
  'sidepanel.js',
  'options.js',
] as const;

export function hashDistBundles(): Readonly<Record<string, string>> {
  return Object.fromEntries(
    DIST_BUNDLES.map((relativePath) => {
      const filePath = path.join(EXTENSION_DIST, ...relativePath.split('/'));
      assertNormalFile(filePath, `dist_${relativePath.replaceAll('/', '_')}`);
      return [
        relativePath,
        createHash('sha256').update(readFileSync(filePath)).digest('hex'),
      ] as const;
    }),
  );
}

export function currentGitIdentity(): { branch: string; head: string } {
  const read = (args: readonly string[]) =>
    execFileSync('git', [...args], {
      cwd: WORKTREE_ROOT,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  return {
    branch: read(['branch', '--show-current']),
    head: read(['rev-parse', 'HEAD']),
  };
}

function contentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    default:
      return 'application/octet-stream';
  }
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const realDist = realpathSync.native(EXTENSION_DIST);
  const server = createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end();
      return;
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }

    if (pathname === '/__fixture__/seed.html') {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/html; charset=utf-8',
      });
      response.end(
        request.method === 'HEAD'
          ? undefined
          : '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>fixture</title><body></body></html>',
      );
      return;
    }

    if (pathname.includes('\\') || pathname.includes('\0')) {
      response.writeHead(400).end();
      return;
    }
    const relativePath = pathname.replace(/^\/+/u, '');
    const candidate = path.resolve(EXTENSION_DIST, relativePath);
    if (!isStrictChild(EXTENSION_DIST, candidate) || !existsSync(candidate)) {
      response.writeHead(404).end();
      return;
    }

    let realCandidate: string;
    try {
      assertNormalFile(candidate, 'fixture_asset');
      realCandidate = realpathSync.native(candidate);
    } catch {
      response.writeHead(404).end();
      return;
    }
    if (!isStrictChild(realDist, realCandidate)) {
      response.writeHead(403).end();
      return;
    }

    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-length': statSync(candidate).size,
      'content-type': contentType(candidate),
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(candidate).pipe(response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('fixture_server_binding_invalid');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    server,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function fakeChromeBootstrap(config: FakeChromeScenario): void {
  type Listener<T extends (...args: never[]) => unknown> = T;
  const tags: Record<string, number> = {};
  let forbiddenCalls = 0;
  let pickerCalls = 0;
  let permissionMutationCalls = 0;
  let bookmarkMutationCalls = 0;
  let sidePanelOpenCalls = 0;
  let optionsOpenCalls = 0;
  let xCommandCalls = 0;

  const tag = (name: string) => {
    tags[name] = (tags[name] ?? 0) + 1;
  };
  const forbidden = (name: string): never => {
    tag(`forbidden:${name}`);
    forbiddenCalls += 1;
    throw new Error('unexpected_api_call');
  };
  const clone = <T>(value: T): T => structuredClone(value);
  const createEvent = <T extends (...args: never[]) => unknown>() => {
    const listeners = new Set<Listener<T>>();
    return {
      addListener(listener: Listener<T>) {
        listeners.add(listener);
      },
      removeListener(listener: Listener<T>) {
        listeners.delete(listener);
      },
      hasListener(listener: Listener<T>) {
        return listeners.has(listener);
      },
      hasListeners() {
        return listeners.size > 0;
      },
      emit(...args: Parameters<T>) {
        for (const listener of listeners) {
          listener(...args);
        }
      },
    };
  };

  const runtimeMessage =
    createEvent<(message: unknown, sender: chrome.runtime.MessageSender) => void>();
  const storageChanged =
    createEvent<
      (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void
    >();
  const permissionRemoved = createEvent<(permissions: chrome.permissions.Permissions) => void>();

  const surfaceResponse = (request: Record<string, unknown>, data: unknown) => ({
    protocol: 'shuhai-surface',
    version: 1,
    requestId: request.requestId,
    ok: true,
    data: clone(data),
  });

  const sendMessage = (request: unknown, callback?: (response: unknown) => void): undefined => {
    if (!request || typeof request !== 'object') {
      forbidden('runtime.sendMessage.invalid');
    }
    const value = request as Record<string, unknown>;
    let response: unknown;
    if (value.protocol === 'shuhai-surface' && value.type === 'summary') {
      if (config.surfaceSummary === undefined) {
        forbidden('surface.summary.unconfigured');
      }
      tag('runtime.sendMessage:surface.summary');
      response = surfaceResponse(value, config.surfaceSummary);
    } else if (value.protocol === 'shuhai-surface' && value.type === 'ackLaunch') {
      tag('runtime.sendMessage:surface.ackLaunch');
      response = surfaceResponse(value, {
        acknowledged: true,
        alreadyAcknowledged: false,
      });
    } else if (value.type === 'security:getBootstrapStatus') {
      tag('runtime.sendMessage:security.bootstrap');
      response = { ok: true, data: { ready: true } };
    } else if (value.type === 'bookmarkTask:getSnapshot') {
      if (config.bookmarkSnapshot === undefined) {
        forbidden('bookmark.snapshot.unconfigured');
      }
      tag('runtime.sendMessage:bookmark.snapshot');
      response = { ok: true, data: clone(config.bookmarkSnapshot) };
    } else if (value.type === 'operations:getRecent') {
      tag('runtime.sendMessage:bookmark.operations');
      response = { ok: true, data: { operations: clone(config.operations ?? []) } };
    } else if (value.type === 'settings:get') {
      if (config.settings === undefined) {
        forbidden('settings.get.unconfigured');
      }
      tag('runtime.sendMessage:settings.get');
      response = { ok: true, data: clone(config.settings) };
    } else {
      forbidden('runtime.sendMessage.unconfigured');
    }
    queueMicrotask(() => callback?.(response));
    return undefined;
  };

  const createPort = (name: string) => {
    const onMessage = createEvent<(message: unknown) => void>();
    const onDisconnect = createEvent<() => void>();
    let disconnected = false;
    return {
      name,
      sender: undefined,
      error: undefined,
      onMessage,
      onDisconnect,
      postMessage(message: unknown) {
        if (disconnected) {
          forbidden(`port.${name}.post_after_disconnect`);
        }
        if (
          name === 'classify' &&
          message &&
          typeof message === 'object' &&
          (message as Record<string, unknown>).type === 'plan:create' &&
          config.classificationPlan !== undefined
        ) {
          tag('port.classify:plan.create');
          const requestId = (message as Record<string, unknown>).requestId;
          const plan = clone(config.classificationPlan) as {
            totalBookmarks?: number;
          };
          queueMicrotask(() => {
            onMessage.emit({
              type: 'complete',
              requestId,
              plan,
              progress: {
                done: plan.totalBookmarks ?? 0,
                total: plan.totalBookmarks ?? 0,
                batch: 1,
                totalBatches: 1,
                elapsedMs: 1,
              },
              cancelled: false,
            });
          });
          return;
        }
        if (name === 'shuhai:x-sync:v1') {
          xCommandCalls += 1;
          forbidden('port.x-sync.command');
        }
        forbidden(`port.${name}.post`);
      },
      disconnect() {
        if (disconnected) return;
        disconnected = true;
        tag(`port.${name}:disconnect`);
        onDisconnect.emit();
      },
    };
  };

  const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const chromeApi = {
    runtime: {
      id: extensionId,
      lastError: undefined,
      onMessage: runtimeMessage,
      sendMessage,
      connect(options: { name?: string } = {}) {
        const name = options.name ?? '';
        if (name !== 'classify' && name !== 'shuhai:x-sync:v1') {
          forbidden('runtime.connect.unconfigured');
        }
        tag(`runtime.connect:${name}`);
        return createPort(name);
      },
      openOptionsPage() {
        optionsOpenCalls += 1;
        forbidden('runtime.openOptionsPage');
      },
      getURL(relativePath: string) {
        tag('runtime.getURL');
        return `chrome-extension://${extensionId}/${relativePath.replace(/^\/+/u, '')}`;
      },
    },
    windows: {
      getCurrent(callback: (window: { id: number }) => void) {
        tag('windows.getCurrent');
        queueMicrotask(() => callback({ id: 7 }));
      },
    },
    tabs: {
      query(
        query: { active?: boolean; windowId?: number },
        callback: (tabs: Array<{ id: number; windowId: number; url: string }>) => void,
      ) {
        if (query.active !== true || query.windowId !== 7) {
          forbidden('tabs.query.unconfigured');
        }
        tag('tabs.query:active');
        queueMicrotask(() => callback([{ id: 11, windowId: 7, url: config.activeTabUrl }]));
      },
    },
    sidePanel: {
      open() {
        sidePanelOpenCalls += 1;
        forbidden('sidePanel.open');
      },
    },
    storage: {
      onChanged: storageChanged,
      session: {
        get(key: string, callback: (items: Record<string, unknown>) => void) {
          if (key !== 'shuhai:x-sync:v1:launch-intent') {
            forbidden('storage.session.get.unconfigured');
          }
          tag('storage.session.get:x-launch-intent');
          queueMicrotask(() => callback({}));
        },
      },
    },
    permissions: {
      onRemoved: permissionRemoved,
      contains(permissions: { origins?: string[] }, callback: (granted: boolean) => void) {
        tag('permissions.contains');
        const requested = permissions.origins ?? [];
        queueMicrotask(() =>
          callback(requested.every((origin) => config.xPermissionOrigins?.includes(origin))),
        );
      },
      getAll(callback: (permissions: { origins: string[] }) => void) {
        tag('permissions.getAll');
        queueMicrotask(() => callback({ origins: [...(config.xPermissionOrigins ?? [])] }));
      },
      request(_permissions: { origins?: string[] }, callback?: (granted: boolean) => void) {
        permissionMutationCalls += 1;
        tag('forbidden:permissions.request');
        forbiddenCalls += 1;
        queueMicrotask(() => callback?.(false));
      },
      remove(_permissions: { origins?: string[] }, callback?: (removed: boolean) => void) {
        permissionMutationCalls += 1;
        tag('forbidden:permissions.remove');
        forbiddenCalls += 1;
        queueMicrotask(() => callback?.(false));
      },
    },
    bookmarks: Object.fromEntries(
      ['create', 'move', 'remove', 'removeTree', 'update'].map((method) => [
        method,
        () => {
          bookmarkMutationCalls += 1;
          forbidden(`bookmarks.${method}`);
        },
      ]),
    ),
  };

  Object.defineProperty(globalThis, 'chrome', {
    configurable: false,
    enumerable: true,
    value: chromeApi,
    writable: false,
  });
  Object.defineProperty(globalThis, 'showDirectoryPicker', {
    configurable: true,
    value: () => {
      pickerCalls += 1;
      forbidden('showDirectoryPicker');
    },
    writable: false,
  });
  Object.defineProperty(globalThis, '__SHUHAI_E2E_LEDGER__', {
    configurable: false,
    value: {
      snapshot: (): FakeChromeLedger => ({
        tags: { ...tags },
        forbiddenCalls,
        pickerCalls,
        permissionMutationCalls,
        bookmarkMutationCalls,
        sidePanelOpenCalls,
        optionsOpenCalls,
        xCommandCalls,
      }),
    },
    writable: false,
  });
}

export async function installFakeChrome(
  context: BrowserContext,
  scenario: FakeChromeScenario,
): Promise<void> {
  await context.addInitScript(fakeChromeBootstrap, scenario);
}

export function readFakeChromeLedger(page: Page): Promise<FakeChromeLedger> {
  return page.evaluate(() => {
    const ledger = (
      globalThis as typeof globalThis & {
        __SHUHAI_E2E_LEDGER__?: { snapshot(): FakeChromeLedger };
      }
    ).__SHUHAI_E2E_LEDGER__;
    if (!ledger) throw new Error('fixture_ledger_missing');
    return ledger.snapshot();
  });
}

export function validateFixtureSeed(seed: FixtureSeed): {
  readonly recordCount: number;
  readonly bytes: number;
} {
  const jobs = (seed.jobs ?? []).map((row) => SyncJobRowSchema.parse(row));
  const items = (seed.items ?? []).map((row) => SyncJobItemRowSchema.parse(row));
  const intents = (seed.intents ?? []).map((row) => WriteIntentSchema.parse(row));
  const recordCount = jobs.length + items.length + intents.length;
  const bytes = encoder.encode(JSON.stringify({ jobs, items, intents })).byteLength;
  if (recordCount > 12 || bytes > 64 * 1024) {
    throw new Error('fixture_seed_budget_exceeded');
  }
  return { recordCount, bytes };
}

export async function seedFixtureDatabases(page: Page, seed: FixtureSeed): Promise<void> {
  validateFixtureSeed(seed);
  await page.evaluate(
    async ({ jobs, items, intents, emptyVaultStore }) => {
      const requestResult = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.addEventListener('success', () => resolve(request.result), { once: true });
          request.addEventListener(
            'error',
            () => reject(request.error ?? new Error('fixture_idb_request_failed')),
            { once: true },
          );
        });
      const transactionDone = (transaction: IDBTransaction) =>
        new Promise<void>((resolve, reject) => {
          transaction.addEventListener('complete', () => resolve(), { once: true });
          transaction.addEventListener(
            'abort',
            () => reject(transaction.error ?? new Error('fixture_idb_transaction_aborted')),
            { once: true },
          );
          transaction.addEventListener(
            'error',
            () => reject(transaction.error ?? new Error('fixture_idb_transaction_failed')),
            { once: true },
          );
        });

      const syncRequest = indexedDB.open('shuhai-sync', 3);
      syncRequest.addEventListener(
        'upgradeneeded',
        () => {
          const database = syncRequest.result;
          const jobStore = database.createObjectStore('jobs', { keyPath: 'id' });
          jobStore.createIndex('by-source', 'source');
          jobStore.createIndex('by-status', 'status');
          jobStore.createIndex('by-active-source', 'activeSource', { unique: true });

          const itemStore = database.createObjectStore('items', { keyPath: 'key' });
          itemStore.createIndex('by-job-id', 'jobId');
          itemStore.createIndex('by-job-source-item', ['jobId', 'sourceItemId'], {
            unique: true,
          });
          itemStore.createIndex('by-job-classification', ['jobId', 'classification']);
          itemStore.createIndex('by-job-write-status', ['jobId', 'writeStatus']);

          const recordStore = database.createObjectStore('records', { keyPath: 'key' });
          recordStore.createIndex('by-source', 'source');
          recordStore.createIndex('by-canonical-url', 'canonicalUrl');
          recordStore.createIndex('by-content-hash', 'contentHash');

          const intentStore = database.createObjectStore('intents', { keyPath: 'id' });
          intentStore.createIndex('by-job-id', 'jobId');
          intentStore.createIndex('by-item-key', 'itemKey', { unique: true });
          intentStore.createIndex('by-record-key', 'recordKey');

          database.createObjectStore('meta', { keyPath: 'key' });
        },
        { once: true },
      );
      const syncDatabase = await requestResult(syncRequest);
      const syncTransaction = syncDatabase.transaction(
        ['jobs', 'items', 'records', 'intents', 'meta'],
        'readwrite',
      );
      syncTransaction.objectStore('meta').put({
        key: 'schema',
        schemaVersion: 1,
        databaseVersion: 3,
        validationState: 'complete',
      });
      for (const row of jobs) syncTransaction.objectStore('jobs').put(row);
      for (const row of items) syncTransaction.objectStore('items').put(row);
      for (const row of intents) syncTransaction.objectStore('intents').put(row);
      await transactionDone(syncTransaction);
      syncDatabase.close();

      if (emptyVaultStore) {
        const vaultRequest = indexedDB.open('shuhai-vault', 1);
        vaultRequest.addEventListener(
          'upgradeneeded',
          () => vaultRequest.result.createObjectStore('handles'),
          { once: true },
        );
        const vaultDatabase = await requestResult(vaultRequest);
        vaultDatabase.close();
      }
    },
    {
      jobs: seed.jobs ?? [],
      items: seed.items ?? [],
      intents: seed.intents ?? [],
      emptyVaultStore: seed.emptyVaultStore ?? false,
    },
  );
}

function safeDiagnostic(message: string): string {
  return message
    .replaceAll(WORKTREE_ROOT, '<worktree>')
    .replaceAll('\\', '/')
    .replace(/https?:\/\/(?!127\.0\.0\.1)[^\s)]+/gu, '<external-url>')
    .slice(0, 320);
}

export function attachPageDiagnostics(page: Page): PageDiagnostics {
  const diagnostics: PageDiagnostics = { consoleErrors: [], pageErrors: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') {
      diagnostics.consoleErrors.push(safeDiagnostic(message.text()));
    }
  });
  page.on('pageerror', (error) => {
    diagnostics.pageErrors.push(safeDiagnostic(error.message));
  });
  return diagnostics;
}

export async function auditPage(page: Page, options: PageAuditOptions): Promise<PageAudit> {
  const staticAudit = await page.evaluate(
    ({ bodySelector, auxiliarySelector, keySelectors }) => {
      const accessibleName = (element: Element): string => {
        const ariaLabel = element.getAttribute('aria-label')?.trim();
        if (ariaLabel) return ariaLabel;
        const labelledBy = element.getAttribute('aria-labelledby')?.trim();
        if (labelledBy) {
          const value = labelledBy
            .split(/\s+/u)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
            .filter(Boolean)
            .join(' ');
          if (value) return value;
        }
        const title = element.getAttribute('title')?.trim();
        if (title) return title;
        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLButtonElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
        ) {
          const labels = [...(element.labels ?? [])]
            .map((label) => label.textContent?.trim() ?? '')
            .filter(Boolean)
            .join(' ');
          if (labels) return labels;
          const placeholder = element.getAttribute('placeholder')?.trim();
          if (placeholder) return placeholder;
        }
        return element.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
      };
      const isRendered = (element: Element) => {
        const style = getComputedStyle(element);
        const rectangle = element.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) !== 0 &&
          rectangle.width > 0 &&
          rectangle.height > 0
        );
      };
      const controls = [
        ...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]'),
      ].filter(isRendered);
      const unnamedControls = controls
        .filter((element) => !accessibleName(element))
        .map((element) => `${element.tagName.toLowerCase()}:${element.getAttribute('role') ?? ''}`);
      const ids = [...document.querySelectorAll('[id]')]
        .map((element) => element.id)
        .filter(Boolean);
      const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
      const textElements = [...document.querySelectorAll('body *')].filter(
        (element) =>
          isRendered(element) &&
          element.children.length === 0 &&
          Boolean(element.textContent?.trim()) &&
          !['SCRIPT', 'STYLE', 'SVG', 'PATH'].includes(element.tagName),
      );
      const textSizes = textElements
        .map((element) => Number.parseFloat(getComputedStyle(element).fontSize))
        .filter(Number.isFinite);
      const readFont = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element || !isRendered(element)) {
          throw new Error(`audit_selector_missing:${selector}`);
        }
        return Number.parseFloat(getComputedStyle(element).fontSize);
      };
      const keyGeometryFailures = (keySelectors ?? []).flatMap((selector) => {
        const element = document.querySelector(selector);
        if (!element || !isRendered(element)) return [`missing:${selector}`];
        const rectangle = element.getBoundingClientRect();
        return rectangle.left < -0.5 ||
          rectangle.right > document.documentElement.clientWidth + 0.5 ||
          rectangle.top < -0.5 ||
          rectangle.bottom > window.innerHeight + 0.5
          ? [`outside:${selector}`]
          : [];
      });
      const primaryCtaCount = controls.filter(
        (element) =>
          element.tagName === 'BUTTON' &&
          element.className.toString().split(/\s+/u).includes('bg-primary') &&
          Boolean(accessibleName(element)),
      ).length;
      return {
        horizontalOverflow: Math.max(
          0,
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
        unnamedControls,
        duplicateIds,
        minimumVisibleTextPx: textSizes.length > 0 ? Math.min(...textSizes) : null,
        bodyTextPx: readFont(bodySelector),
        auxiliaryTextPx: readFont(auxiliarySelector),
        primaryCtaCount,
        keyGeometryFailures,
      };
    },
    {
      bodySelector: options.bodySelector,
      auxiliarySelector: options.auxiliarySelector,
      keySelectors: options.keySelectors ?? [],
    },
  );

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  const focusOrder: string[] = [];
  let focusVisible = false;
  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const accessibleName = (element: Element): string => {
        const ariaLabel = element.getAttribute('aria-label')?.trim();
        if (ariaLabel) return ariaLabel;
        const labelledBy = element.getAttribute('aria-labelledby')?.trim();
        if (labelledBy) {
          const value = labelledBy
            .split(/\s+/u)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
            .filter(Boolean)
            .join(' ');
          if (value) return value;
        }
        const title = element.getAttribute('title')?.trim();
        if (title) return title;
        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLButtonElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
        ) {
          const labels = [...(element.labels ?? [])]
            .map((label) => label.textContent?.trim() ?? '')
            .filter(Boolean)
            .join(' ');
          if (labels) return labels;
          const placeholder = element.getAttribute('placeholder')?.trim();
          if (placeholder) return placeholder;
        }
        return element.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
      };
      const element = document.activeElement;
      if (!(element instanceof HTMLElement) || element === document.body) {
        return { name: '', visible: false };
      }
      const style = getComputedStyle(element);
      return {
        name: accessibleName(element),
        visible:
          (style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0) ||
          (style.boxShadow !== 'none' && style.boxShadow !== ''),
      };
    });
    if (!focus.name) continue;
    focusOrder.push(focus.name);
    focusVisible ||= focus.visible;
  }

  const missingFocusNames = options.focusNames.filter(
    (expected) => !focusOrder.some((actual) => actual.includes(expected)),
  );
  return {
    ...staticAudit,
    focusOrder,
    focusVisible,
    missingFocusNames,
  };
}

export function writeRunReport(layout: RunLayout, report: Goal046cReport): void {
  writeFileSync(
    path.join(layout.artifactsRoot, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
}

export function persistPassingEvidence(layout: RunLayout, report: Goal046cReport): void {
  if (report.overall !== 'PASS') {
    throw new Error('cannot_persist_failing_goal_046c_evidence');
  }
  const assetsRoot = path.join(WORKTREE_ROOT, 'docs', 'reviews', 'assets', 'goal-046c');
  mkdirSync(assetsRoot, { recursive: true });
  const screenshotNames = [
    'popup-x-context.png',
    'sidepanel-bookmark-narrow.png',
    'options-root-rem-2x.png',
  ] as const;
  for (const screenshotName of screenshotNames) {
    const source = path.join(layout.screenshotsRoot, screenshotName);
    assertNormalFile(source, `evidence_${screenshotName}`);
    copyFileSync(source, path.join(assetsRoot, screenshotName));
  }
  const summary = {
    schemaVersion: report.schemaVersion,
    runId: report.runId,
    branch: report.branch,
    head: report.head,
    distBundleSha256: report.distBundleSha256,
    chromiumVersion: report.chromiumVersion,
    mountMode: report.mountMode,
    bookmarkDigest: report.bookmarkDigest,
    xPermission: report.xPermission,
    vaultHandleCount: report.vaultHandleCount,
    seededFixtureRecords: report.seededFixtureRecords,
    seededFixtureBytes: report.seededFixtureBytes,
    scenarios: report.scenarios.map((scenario) => ({
      id: scenario.id,
      layer: scenario.layer,
      surface: scenario.surface,
      viewport: scenario.viewport,
      theme: scenario.theme,
      textScale: scenario.textScale,
      fontScaleEvidence: scenario.fontScaleEvidence,
      fixtureSeed: scenario.fixtureSeed,
      readyTimeMs: scenario.readyTimeMs,
      audit: scenario.audit,
      diagnostics: {
        consoleErrorCount: scenario.diagnostics.consoleErrors.length,
        pageErrorCount: scenario.diagnostics.pageErrors.length,
      },
      apiLedger: scenario.apiLedger,
      externalRequestBlockedCount: scenario.externalRequestBlockedCount,
      screenshot: scenario.screenshot,
      status: scenario.status,
    })),
    handles: report.handles,
    overall: report.overall,
    limitations: [
      'direct extension pages do not prove toolbar user gestures or the Chrome Side Panel shell',
      'root-rem 2x stress is not Chrome browser zoom or Windows display scaling',
      'Obsidian Reading View and two-week owner dogfood remain manual gates',
    ],
  };
  writeFileSync(
    path.join(assetsRoot, 'report-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );
}

export function relativeToRun(layout: RunLayout, value: string): string {
  const relative = path.relative(layout.runRoot, value).replaceAll('\\', '/');
  if (relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error('goal_046c_report_path_outside_run');
  }
  return relative;
}

export function assertExtensionId(value: string): string {
  if (!SAFE_EXTENSION_ID_PATTERN.test(value)) {
    throw new Error('invalid_loaded_extension_id');
  }
  return value;
}

if (process.argv.includes('--goal-046c-preflight')) {
  process.stdout.write(`${preflightRunLayout()}\n`);
}
