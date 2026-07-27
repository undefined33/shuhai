import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import {
  chromium,
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
  type Worker,
} from '@playwright/test';

import {
  BookmarkOperationSchema,
  type BookmarkItem,
  type BookmarkOperation,
  type BookmarkTaskSettings,
  type ClassificationPlan,
  type FolderItem,
} from '../src/shared/bookmark-types.js';
import type { SurfaceSummary } from '../src/shared/surface-contract.js';
import {
  type CaptureCompleteness,
  type SyncItemClassification,
  type SyncItemWriteStatus,
  type SyncJobItemRow,
  type SyncJobRow,
  type SyncReviewDecision,
  type WriteOutcome,
} from '../src/social/sync-schema.js';
import { DEFAULT_SETTINGS } from '../src/utils/storage.js';
import {
  EXTENSION_DIST,
  assertExtensionId,
  assertNormalFile,
  attachPageDiagnostics,
  auditPage,
  currentGitIdentity,
  hashDistBundles,
  installFakeChrome,
  persistPassingEvidence,
  prepareRunLayout,
  readFakeChromeLedger,
  relativeToRun,
  seedFixtureDatabases,
  startFixtureServer,
  validateFixtureSeed,
  writeRunReport,
  type FakeChromeLedger,
  type FakeChromeScenario,
  type FixtureSeed,
  type FixtureServer,
  type Goal046cReport,
  type PageAudit,
  type PageAuditOptions,
  type PageDiagnostics,
  type RunLayout,
  type ScenarioEvidence,
} from './helpers/goal-046c-harness.js';

const FIXTURE_EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const FIXTURE_X_ORIGIN = 'https://x.com/*';
const CREATED_AT = '2026-07-27T00:00:00.000Z';
const DISCOVERED_AT = '2026-07-27T00:00:01.000Z';
const UPDATED_AT = '2026-07-27T00:01:00.000Z';
const AUXILIARY_SELECTOR = '[class*="text-muted-foreground"]';

interface ScenarioResult {
  readonly auditOptions: PageAuditOptions;
  readonly expectedPrimaryCtas?: number;
  readonly fontScaleEvidence?: ScenarioEvidence['fontScaleEvidence'];
  readonly readyTimeMs: number;
}

interface FixtureScenarioOptions {
  readonly browser: Browser;
  readonly fixtureServer: FixtureServer;
  readonly id: string;
  readonly surface: string;
  readonly pagePath: '/popup/index.html' | '/sidepanel/index.html' | '/options/index.html';
  readonly screenshotName: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly theme: 'light' | 'dark';
  readonly textScale: string;
  readonly chrome: FakeChromeScenario;
  readonly seed?: FixtureSeed;
  readonly run: (page: Page, startedAt: number) => Promise<ScenarioResult>;
}

function surfaceSummary(overrides: Partial<SurfaceSummary> = {}): SurfaceSummary {
  return {
    bookmarkCount: 1_370,
    folderCount: 108,
    vaultConfigured: false,
    aiConfigured: false,
    lastSavedAt: null,
    activeTask: null,
    pendingLaunch: null,
    ...overrides,
  };
}

function bookmarkTaskSettings(): BookmarkTaskSettings {
  return {
    useAi: false,
    activeProviderId: DEFAULT_SETTINGS.activeProviderId,
    aiProviders: structuredClone(DEFAULT_SETTINGS.aiProviders),
    aiLegacySummary: structuredClone(DEFAULT_SETTINGS.aiLegacySummary),
    customRules: [],
    defaultClassifyMode: 'safe',
  };
}

function bookmarkFixture(count = 12): {
  readonly bookmarks: BookmarkItem[];
  readonly folders: FolderItem[];
  readonly settings: BookmarkTaskSettings;
} {
  const folders: FolderItem[] = [
    {
      id: 'folder-research',
      title: 'Research',
      path: 'Bookmarks Bar/Research',
      parentId: '1',
      bookmarkCount: count,
    },
  ];
  const bookmarks = Array.from({ length: count }, (_, index): BookmarkItem => {
    const ordinal = index + 1;
    return {
      id: `bookmark-${ordinal}`,
      title:
        index === count - 1
          ? '末项：安全研究 long mixed-language title for keyboard and narrow viewport verification'
          : `合成书签 ${ordinal} · Defensive research reference`,
      url: `https://fixture.invalid/bookmarks/${ordinal}`,
      parentId: '1',
      parentTitle: 'Bookmarks Bar',
      parentPath: 'Bookmarks Bar',
      index,
    };
  });
  return { bookmarks, folders, settings: bookmarkTaskSettings() };
}

function classificationPlan(bookmarks: readonly BookmarkItem[]): ClassificationPlan {
  return {
    mode: 'safe',
    moves: bookmarks.map((bookmark, index) => ({
      id: `move-${index + 1}`,
      bookmarkId: bookmark.id,
      bookmarkTitle: bookmark.title,
      bookmarkUrl: bookmark.url,
      currentFolder: bookmark.parentPath,
      targetFolder: 'Bookmarks Bar/Research',
      confidence: index % 3 === 0 ? 0.55 : 0.82,
      reason: 'rule',
      ruleName: 'Fixture rule',
      tags: ['fixture'],
      selected: true,
    })),
    newFolders: [],
    unchanged: 1_205,
    totalBookmarks: bookmarks.length,
    generatedAt: UPDATED_AT,
  };
}

function partialBookmarkOperation(): BookmarkOperation {
  const payloadIdentity = `sha256:${'a'.repeat(64)}`;
  const items: BookmarkOperation['items'] = [
    {
      kind: 'update_url',
      bookmarkId: 'bookmark-success',
      title: '成功且可以恢复',
      original: {
        title: '成功且可以恢复',
        url: 'https://fixture.invalid/old/success',
        parentId: '1',
        index: 0,
      },
      oldUrl: 'https://fixture.invalid/old/success',
      newUrl: 'https://fixture.invalid/new/success',
      executionStatus: 'succeeded',
      restoreStatus: 'pending',
      executionAttemptedAt: DISCOVERED_AT,
      executionCompletedAt: UPDATED_AT,
      executionAttemptCount: 1,
      restoreAttemptCount: 0,
    },
    {
      kind: 'update_url',
      bookmarkId: 'bookmark-failed',
      title: '执行失败',
      original: {
        title: '执行失败',
        url: 'https://fixture.invalid/old/failed',
        parentId: '1',
        index: 1,
      },
      oldUrl: 'https://fixture.invalid/old/failed',
      newUrl: 'https://fixture.invalid/new/failed',
      executionStatus: 'failed',
      restoreStatus: 'not_needed',
      errorCode: 'chrome_api_error',
      executionAttemptedAt: DISCOVERED_AT,
      executionCompletedAt: UPDATED_AT,
      executionAttemptCount: 1,
      restoreAttemptCount: 0,
    },
    {
      kind: 'update_url',
      bookmarkId: 'bookmark-conflict',
      title: '执行冲突',
      original: {
        title: '执行冲突',
        url: 'https://fixture.invalid/old/conflict',
        parentId: '1',
        index: 2,
      },
      oldUrl: 'https://fixture.invalid/old/conflict',
      newUrl: 'https://fixture.invalid/new/conflict',
      executionStatus: 'conflict',
      restoreStatus: 'not_needed',
      errorCode: 'bookmark_changed',
      executionAttemptedAt: DISCOVERED_AT,
      executionCompletedAt: UPDATED_AT,
      executionAttemptCount: 1,
      restoreAttemptCount: 0,
    },
    {
      kind: 'update_url',
      bookmarkId: 'bookmark-restore-conflict',
      title: '恢复冲突待人工处理',
      original: {
        title: '恢复冲突待人工处理',
        url: 'https://fixture.invalid/old/restore-conflict',
        parentId: '1',
        index: 3,
      },
      oldUrl: 'https://fixture.invalid/old/restore-conflict',
      newUrl: 'https://fixture.invalid/new/restore-conflict',
      executionStatus: 'succeeded',
      restoreStatus: 'conflict',
      restoreErrorCode: 'restore_conflict',
      executionAttemptedAt: DISCOVERED_AT,
      executionCompletedAt: UPDATED_AT,
      executionAttemptCount: 1,
      restoreAttemptedAt: UPDATED_AT,
      restoreCompletedAt: UPDATED_AT,
      restoreAttemptCount: 1,
    },
  ];
  const summary = {
    requested: 4,
    pending: 0,
    succeeded: 2,
    failed: 1,
    skipped: 0,
    executionConflicts: 1,
    restorePending: 1,
    restored: 0,
    restoreFailed: 0,
    restoreConflicts: 1,
    acceptedCurrent: 0,
  };
  return BookmarkOperationSchema.parse({
    id: 'operation-partial-1',
    requestId: 'request-operation-partial-1',
    payloadIdentity,
    version: 1,
    type: 'update_bookmark_urls',
    status: 'restore_partial',
    source: 'health',
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    requestedCount: items.length,
    items,
    summary,
    commands: [
      {
        requestId: 'request-operation-partial-1',
        action: 'execute',
        payloadIdentity,
        status: 'succeeded',
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        result: {
          ok: true,
          operationStatus: 'partial',
          summary,
          completedAt: UPDATED_AT,
        },
      },
    ],
  });
}

function socialItem(
  sourceItemId: string,
  completeness: CaptureCompleteness,
  title: string,
): SyncJobItemRow['item'] {
  return {
    schemaVersion: 1,
    source: 'x',
    sourceItemId,
    canonicalUrl: `https://x.com/fixture_user/status/${sourceItemId}`,
    title,
    ...(completeness === 'metadata_only'
      ? {}
      : { text: `Synthetic fixture text for ${sourceItemId}.` }),
    author: { displayName: 'Fixture Author', handle: 'fixture_user' },
    publishedAt: CREATED_AT,
    capturedAt: DISCOVERED_AT,
    completeness,
    media: [],
    contentHash: createHash('sha256')
      .update(`${sourceItemId}:${completeness}:${title}`)
      .digest('hex'),
    extractorVersion: 1,
  };
}

function syncItem(input: {
  readonly jobId: string;
  readonly sourceItemId: string;
  readonly title: string;
  readonly completeness: CaptureCompleteness;
  readonly classification: SyncItemClassification;
  readonly reviewDecision: SyncReviewDecision;
  readonly writeStatus?: SyncItemWriteStatus;
  readonly outcome?: WriteOutcome;
}): SyncJobItemRow {
  const reviewRevision = input.reviewDecision === 'unreviewed' ? 0 : 1;
  return {
    key: `${input.jobId.length}:${input.jobId}:${input.sourceItemId}`,
    schemaVersion: 1,
    jobId: input.jobId,
    sourceItemId: input.sourceItemId,
    item: socialItem(input.sourceItemId, input.completeness, input.title),
    classification: input.classification,
    reviewDecision: input.reviewDecision,
    reviewRevision,
    writeStatus: input.writeStatus ?? 'not_requested',
    ...(input.outcome ? { outcome: input.outcome } : {}),
    discoveredAt: DISCOVERED_AT,
    updatedAt: UPDATED_AT,
  };
}

function summarizeSyncItems(
  items: readonly SyncJobItemRow[],
  scannedCount: number,
): SyncJobRow['summary'] {
  const count = <T>(select: (item: SyncJobItemRow) => T, expected: T) =>
    items.filter((item) => select(item) === expected).length;
  return {
    scannedCount,
    uniqueItemCount: items.length,
    pendingReviewCount: count((item) => item.classification, 'pending'),
    classificationErrorCount: count((item) => item.classification, 'error'),
    unreviewedCount: count((item) => item.reviewDecision, 'unreviewed'),
    selectedCount: count((item) => item.reviewDecision, 'selected'),
    excludedCount: count((item) => item.reviewDecision, 'excluded'),
    writePendingCount: count((item) => item.writeStatus, 'pending'),
    createdCount: count((item) => item.writeStatus, 'created'),
    alreadyExistsCount: count((item) => item.writeStatus, 'already_exists'),
    skippedCount: count((item) => item.writeStatus, 'skipped'),
    writeErrorCount: count((item) => item.writeStatus, 'error'),
  };
}

function checkpoint(
  items: readonly SyncJobItemRow[],
  scannedCount: number,
  acceptedCount: number,
): NonNullable<SyncJobRow['checkpoint']> {
  return {
    schemaVersion: 1,
    contractVersion: 2,
    adapterVersion: 1,
    scanRevision: 1,
    scannedCount,
    acceptedCount,
    acceptedBytes: 4_096,
    candidateCount: items.filter((item) =>
      ['new', 'changed', 'incomplete', 'error'].includes(item.classification),
    ).length,
    classificationErrorCount: items.filter((item) => item.classification === 'error').length,
    catalogExistingObservationCount: items.filter((item) => item.classification === 'existing')
      .length,
    consecutiveKnownIds: 0,
    updatedAt: UPDATED_AT,
  };
}

function pausedSeed(): FixtureSeed {
  const jobId = 'fixture-paused-job';
  const items = Array.from({ length: 6 }, (_, index) =>
    syncItem({
      jobId,
      sourceItemId: `9000000000000000${index + 10}`,
      title:
        index === 5
          ? '长标题：A deliberately long synthetic bookmark title for narrow side panel wrapping'
          : `暂停批次候选 ${index + 1}`,
      completeness: index === 4 ? 'summary_only' : 'complete',
      classification: index === 5 ? 'incomplete' : 'new',
      reviewDecision: 'unreviewed',
    }),
  );
  const scannedCount = 8;
  const job: SyncJobRow = {
    schemaVersion: 1,
    contractVersion: 2,
    id: jobId,
    source: 'x',
    status: 'paused',
    activeSource: 'x',
    scanMode: 'incremental',
    adapterVersion: 1,
    scanRevision: 1,
    reviewRevision: 0,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    stopRecord: {
      code: 'user_paused',
      stoppedAt: UPDATED_AT,
      phase: 'scanning',
      scanRevision: 1,
      scannedCount,
      acceptedCount: items.length,
    },
    checkpoint: checkpoint(items, scannedCount, items.length),
    budgets: {
      maxItems: 10,
      maxPages: 10,
      maxDurationMs: 60_000,
      maxItemBytes: 64 * 1_024,
      maxMediaPerItem: 0,
    },
    summary: summarizeSyncItems(items, scannedCount),
  };
  return { jobs: [job], items, emptyVaultStore: true };
}

function reviewSeed(): FixtureSeed {
  const jobId = 'fixture-review-job';
  const items = [
    syncItem({
      jobId,
      sourceItemId: '900000000000000021',
      title: '完整新增内容',
      completeness: 'complete',
      classification: 'new',
      reviewDecision: 'selected',
    }),
    syncItem({
      jobId,
      sourceItemId: '900000000000000022',
      title: '摘要新增内容',
      completeness: 'summary_only',
      classification: 'new',
      reviewDecision: 'selected',
    }),
    syncItem({
      jobId,
      sourceItemId: '900000000000000023',
      title: '仅元数据内容默认不选',
      completeness: 'metadata_only',
      classification: 'incomplete',
      reviewDecision: 'excluded',
    }),
    syncItem({
      jobId,
      sourceItemId: '900000000000000024',
      title: '提取错误内容',
      completeness: 'metadata_only',
      classification: 'error',
      reviewDecision: 'excluded',
    }),
    syncItem({
      jobId,
      sourceItemId: '900000000000000025',
      title: '内容变化待后续处理',
      completeness: 'complete',
      classification: 'changed',
      reviewDecision: 'excluded',
    }),
  ];
  const scannedCount = 7;
  const job: SyncJobRow = {
    schemaVersion: 1,
    contractVersion: 2,
    id: jobId,
    source: 'x',
    status: 'ready_for_review',
    activeSource: 'x',
    scanMode: 'incremental',
    scanCompletion: 'user_finalized_batch',
    adapterVersion: 1,
    scanRevision: 1,
    reviewRevision: 1,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    checkpoint: checkpoint(items, scannedCount, items.length),
    budgets: {
      maxItems: 10,
      maxPages: 10,
      maxDurationMs: 60_000,
      maxItemBytes: 64 * 1_024,
      maxMediaPerItem: 0,
    },
    summary: summarizeSyncItems(items, scannedCount),
  };
  return { jobs: [job], items, emptyVaultStore: true };
}

function terminalSeed(): FixtureSeed {
  const jobId = 'fixture-terminal-job';
  const items = [
    syncItem({
      jobId,
      sourceItemId: '900000000000000031',
      title: '终态新建',
      completeness: 'complete',
      classification: 'new',
      reviewDecision: 'selected',
      writeStatus: 'created',
      outcome: {
        status: 'created',
        relativePath: 'ShuHai/X/fixture-created.md',
        bytes: 512,
      },
    }),
    syncItem({
      jobId,
      sourceItemId: '900000000000000032',
      title: '终态已存在',
      completeness: 'complete',
      classification: 'new',
      reviewDecision: 'selected',
      writeStatus: 'already_exists',
      outcome: {
        status: 'already_exists',
        relativePath: 'ShuHai/X/fixture-existing.md',
      },
    }),
    syncItem({
      jobId,
      sourceItemId: '900000000000000033',
      title: '终态跳过',
      completeness: 'summary_only',
      classification: 'new',
      reviewDecision: 'selected',
      writeStatus: 'skipped',
      outcome: {
        status: 'skipped',
        relativePath: 'ShuHai/X/fixture-skipped.md',
        reason: 'fixture_existing_file',
      },
    }),
  ];
  const scannedCount = 5;
  const job: SyncJobRow = {
    schemaVersion: 1,
    contractVersion: 2,
    id: jobId,
    source: 'x',
    status: 'complete',
    scanMode: 'incremental',
    scanCompletion: 'known_frontier',
    adapterVersion: 1,
    scanRevision: 1,
    reviewRevision: 1,
    authorizedReviewRevision: 1,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    writeAuthorizedAt: DISCOVERED_AT,
    checkpoint: checkpoint(items, scannedCount, items.length),
    budgets: {
      maxItems: 10,
      maxPages: 10,
      maxDurationMs: 60_000,
      maxItemBytes: 64 * 1_024,
      maxMediaPerItem: 0,
    },
    summary: summarizeSyncItems(items, scannedCount),
  };
  return { jobs: [job], items, emptyVaultStore: true };
}

function configuredSettings() {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.useAi = true;
  settings.aiProviders = settings.aiProviders.map((provider) =>
    provider.provider === 'deepseek' ? { ...provider, enabled: true, hasApiKey: true } : provider,
  );
  return settings;
}

function assertRunnerOutput(testInfo: TestInfo, layout: RunLayout): void {
  const relative = path.relative(layout.runnerRoot, path.resolve(testInfo.outputDir));
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('goal_046c_runner_output_mismatch');
  }
}

async function extensionWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;
  return context.waitForEvent('serviceworker', { timeout: 15_000 });
}

async function serviceWorkerBundleHash(worker: Worker): Promise<string> {
  return worker.evaluate(async () => {
    const response = await fetch(chrome.runtime.getURL('background/service-worker.js'), {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('service_worker_bundle_unavailable');
    const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  });
}

async function bookmarkDigest(
  worker: Worker,
): Promise<{ readonly digest: string; readonly nodeCount: number }> {
  return worker.evaluate(async () => {
    const tree = await new Promise<chrome.bookmarks.BookmarkTreeNode[]>((resolve, reject) => {
      chrome.bookmarks.getTree((nodes) => {
        if (chrome.runtime.lastError) {
          reject(new Error('bookmark_digest_unavailable'));
          return;
        }
        resolve(nodes);
      });
    });
    const rows: string[] = [];
    const visit = (nodes: readonly chrome.bookmarks.BookmarkTreeNode[], parent = '') => {
      for (const node of nodes) {
        rows.push(
          JSON.stringify([parent, node.id, node.index ?? null, node.title, node.url ?? null]),
        );
        visit(node.children ?? [], node.id);
      }
    };
    visit(tree);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rows.join('\n')));
    return {
      digest: [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join(''),
      nodeCount: rows.length,
    };
  });
}

function xPermissionGranted(worker: Worker): Promise<boolean> {
  return worker.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        chrome.permissions.contains({ origins: ['https://x.com/*'] }, (granted) => {
          resolve(!chrome.runtime.lastError && granted === true);
        });
      }),
  );
}

function vaultHandleCount(worker: Worker): Promise<number> {
  return worker.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('shuhai-vault', 1);
        request.addEventListener(
          'upgradeneeded',
          () => request.result.createObjectStore('handles'),
          { once: true },
        );
        request.addEventListener(
          'error',
          () => reject(request.error ?? new Error('vault_count_failed')),
          { once: true },
        );
        request.addEventListener(
          'success',
          () => {
            const database = request.result;
            const transaction = database.transaction('handles', 'readonly');
            const count = transaction.objectStore('handles').count();
            count.addEventListener(
              'error',
              () => reject(count.error ?? new Error('vault_count_failed')),
              { once: true },
            );
            count.addEventListener(
              'success',
              () => {
                database.close();
                resolve(count.result);
              },
              { once: true },
            );
          },
          { once: true },
        );
      }),
  );
}

function assertCleanDiagnostics(diagnostics: PageDiagnostics): void {
  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
}

function assertPageAudit(
  audit: PageAudit,
  expectedPrimaryCtas?: number,
  expectedFocusVisible = true,
): void {
  expect(audit.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(audit.unnamedControls).toEqual([]);
  expect(audit.duplicateIds).toEqual([]);
  expect(audit.minimumVisibleTextPx).not.toBeNull();
  expect(audit.minimumVisibleTextPx ?? 0).toBeGreaterThanOrEqual(12);
  expect(audit.bodyTextPx).toBeGreaterThanOrEqual(13);
  expect(audit.auxiliaryTextPx).toBeGreaterThanOrEqual(12);
  expect(audit.focusVisible).toBe(expectedFocusVisible);
  if (audit.missingFocusNames.length > 0) {
    throw new Error(
      `missing_focus_names:${JSON.stringify({
        missing: audit.missingFocusNames,
        order: audit.focusOrder,
      })}`,
    );
  }
  expect(audit.keyGeometryFailures).toEqual([]);
  if (expectedPrimaryCtas !== undefined) {
    expect(audit.primaryCtaCount).toBe(expectedPrimaryCtas);
  }
}

function assertMountOnlyLedger(ledger: FakeChromeLedger): void {
  expect(ledger.forbiddenCalls).toBe(0);
  expect(ledger.pickerCalls).toBe(0);
  expect(ledger.permissionMutationCalls).toBe(0);
  expect(ledger.bookmarkMutationCalls).toBe(0);
  expect(ledger.sidePanelOpenCalls).toBe(0);
  expect(ledger.optionsOpenCalls).toBe(0);
  expect(ledger.xCommandCalls).toBe(0);
}

async function screenshotScenario(
  page: Page,
  layout: RunLayout,
  screenshotName: string,
): Promise<string> {
  const screenshotPath = path.join(layout.screenshotsRoot, screenshotName);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  return relativeToRun(layout, screenshotPath);
}

async function executeFixtureScenario(
  layout: RunLayout,
  options: FixtureScenarioOptions,
): Promise<ScenarioEvidence> {
  let blockedExternalRequests = 0;
  const seedStats = options.seed ? validateFixtureSeed(options.seed) : undefined;
  const context = await options.browser.newContext({
    colorScheme: options.theme,
    reducedMotion: 'reduce',
    viewport: options.viewport,
  });
  try {
    await context.route('**/*', async (route) => {
      const requestUrl = route.request().url();
      if (/^https?:/u.test(requestUrl)) {
        const requestOrigin = new URL(requestUrl).origin;
        if (requestOrigin !== options.fixtureServer.origin) {
          blockedExternalRequests += 1;
          await route.abort();
          return;
        }
      }
      await route.continue();
    });
    await installFakeChrome(context, options.chrome);
    const page = await context.newPage();
    const diagnostics = attachPageDiagnostics(page);
    if (options.seed) {
      await page.goto(`${options.fixtureServer.origin}/__fixture__/seed.html`, {
        waitUntil: 'domcontentloaded',
      });
      await seedFixtureDatabases(page, options.seed);
    }

    const startedAt = Date.now();
    await page.goto(`${options.fixtureServer.origin}${options.pagePath}`, {
      waitUntil: 'domcontentloaded',
    });
    const result = await options.run(page, startedAt);
    const screenshot = await screenshotScenario(page, layout, options.screenshotName);
    const audit = await auditPage(page, result.auditOptions);
    const ledger = await readFakeChromeLedger(page);
    assertPageAudit(audit, result.expectedPrimaryCtas);
    assertCleanDiagnostics(diagnostics);
    assertMountOnlyLedger(ledger);
    expect(blockedExternalRequests).toBe(0);
    return {
      id: options.id,
      layer: 'B',
      surface: options.surface,
      viewport: options.viewport,
      theme: options.theme,
      textScale: options.textScale,
      ...(result.fontScaleEvidence ? { fontScaleEvidence: result.fontScaleEvidence } : {}),
      ...(seedStats ? { fixtureSeed: seedStats } : {}),
      readyTimeMs: result.readyTimeMs,
      audit,
      diagnostics,
      apiLedger: ledger,
      externalRequestBlockedCount: blockedExternalRequests,
      screenshot,
      status: 'PASS',
    };
  } finally {
    await context.close();
  }
}

async function assertVisibleWithinViewport(page: Page, selector: string): Promise<void> {
  const locator = page.locator(selector);
  await locator.scrollIntoViewIfNeeded();
  const geometry = await locator.evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    return {
      left: rectangle.left,
      right: rectangle.right,
      top: rectangle.top,
      bottom: rectangle.bottom,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(-0.5);
  expect(geometry.right).toBeLessThanOrEqual(geometry.width + 0.5);
  expect(geometry.top).toBeGreaterThanOrEqual(-0.5);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.height + 0.5);
}

async function popupHandshakeDiagnostic(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    const currentWindow = await new Promise<chrome.windows.Window | undefined>((resolve) => {
      chrome.windows.getCurrent((value) => {
        resolve(chrome.runtime.lastError ? undefined : value);
      });
    });
    const windowId = currentWindow?.id;
    const tabs =
      typeof windowId === 'number'
        ? await new Promise<chrome.tabs.Tab[]>((resolve) => {
            chrome.tabs.query({ active: true, windowId }, (value) => {
              resolve(chrome.runtime.lastError ? [] : value);
            });
          })
        : [];
    const tabUrl = tabs[0]?.url;
    const tabKind =
      typeof tabUrl === 'string'
        ? tabUrl.startsWith('chrome-extension://')
          ? 'extension'
          : tabUrl.startsWith('http://') || tabUrl.startsWith('https://')
            ? 'http'
            : 'other'
        : 'missing';
    const response =
      typeof windowId === 'number'
        ? await new Promise<unknown>((resolve) => {
            chrome.runtime.sendMessage(
              {
                protocol: 'shuhai-surface',
                version: 1,
                requestId: `goal-046c-diagnostic-${crypto.randomUUID()}`,
                windowId,
                type: 'summary',
              },
              (value: unknown) => {
                resolve(chrome.runtime.lastError ? { runtimeError: true } : value);
              },
            );
          })
        : undefined;
    const safeResponse =
      response !== null && typeof response === 'object'
        ? {
            ok: Reflect.get(response, 'ok'),
            errorCode: Reflect.get(response, 'errorCode'),
          }
        : { responseType: typeof response };
    return {
      windowIdAvailable: typeof windowId === 'number',
      activeTabCount: tabs.length,
      activeTabWindowMatches: tabs[0]?.windowId === windowId,
      tabKind,
      response: safeResponse,
    };
  });
}

function configuredChromeScenario(overrides: Partial<FakeChromeScenario> = {}): FakeChromeScenario {
  return {
    activeTabUrl: 'https://fixture.invalid/current',
    surfaceSummary: surfaceSummary(),
    ...overrides,
  };
}

test.describe.configure({ mode: 'serial' });

test('Goal 046C isolated production UI evidence', async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(150_000);
  const layout = prepareRunLayout();
  assertRunnerOutput(testInfo, layout);
  const git = currentGitIdentity();
  const beforeHashes = hashDistBundles();
  const scenarios: ScenarioEvidence[] = [];
  let fatalError: unknown;
  let persistentContext: BrowserContext | undefined;
  let fixtureBrowser: Browser | undefined;
  let fixtureServer: FixtureServer | undefined;
  let chromiumVersion = 'unavailable';
  let extensionId = '';
  let bookmarkBefore = { digest: '', nodeCount: 0 };
  let bookmarkAfter = { digest: '', nodeCount: 0 };
  let xPermissionBefore = false;
  let xPermissionAfter = false;
  let vaultBefore = 0;
  let vaultAfter = 0;
  let persistentContextCreated = false;
  let persistentContextClosed = false;
  let fixtureServerCreated = false;
  let fixtureServerClosed = false;
  let fixtureBrowserCreated = false;
  let fixtureBrowserClosed = false;

  try {
    const executablePath = chromium.executablePath();
    assertNormalFile(executablePath, 'playwright_chromium');
    if (lstatSync(executablePath).isSymbolicLink()) {
      throw new Error('playwright_chromium_symlink_rejected');
    }

    persistentContext = await chromium.launchPersistentContext(layout.profileRoot, {
      executablePath,
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      offline: true,
      reducedMotion: 'reduce',
      viewport: { width: 720, height: 900 },
      args: [
        `--disable-extensions-except=${EXTENSION_DIST}`,
        `--load-extension=${EXTENSION_DIST}`,
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-domain-reliability',
        '--disable-sync',
        '--metrics-recording-only',
        '--no-first-run',
      ],
    });
    persistentContextCreated = true;
    chromiumVersion = persistentContext.browser()?.version() ?? 'unknown';
    let aLayerBlockedExternalRequests = 0;
    await persistentContext.route('**/*', async (route) => {
      if (/^https?:/u.test(route.request().url())) {
        aLayerBlockedExternalRequests += 1;
        await route.abort();
        return;
      }
      await route.continue();
    });

    const worker = await extensionWorker(persistentContext);
    extensionId = assertExtensionId(new URL(worker.url()).host);
    expect(extensionId).not.toBe(FIXTURE_EXTENSION_ID);
    expect(await serviceWorkerBundleHash(worker)).toBe(
      beforeHashes['background/service-worker.js'],
    );
    bookmarkBefore = await bookmarkDigest(worker);
    xPermissionBefore = await xPermissionGranted(worker);
    vaultBefore = await vaultHandleCount(worker);
    expect(xPermissionBefore).toBe(false);
    expect(vaultBefore).toBe(0);

    const identityPage = await persistentContext.newPage();
    await identityPage.setViewportSize({ width: 420, height: 600 });
    await identityPage.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    const identityDiagnostics = attachPageDiagnostics(identityPage);
    const identityStarted = Date.now();
    await identityPage.goto(`chrome-extension://${extensionId}/popup/index.html`);
    await expect(identityPage.getByText('ShuHai', { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    const identityAudit = await auditPage(identityPage, {
      bodySelector: 'body',
      auxiliarySelector: AUXILIARY_SELECTOR,
      focusNames: ['打开设置'],
      keySelectors: ['h1'],
    });
    assertPageAudit(identityAudit);
    assertCleanDiagnostics(identityDiagnostics);
    const identityScreenshot = await screenshotScenario(identityPage, layout, 'A-01-extension.png');
    assertCleanDiagnostics(identityDiagnostics);
    scenarios.push({
      id: 'A-01',
      layer: 'A',
      surface: 'Extension identity',
      viewport: { width: 420, height: 600 },
      theme: 'light',
      textScale: 'default',
      readyTimeMs: Date.now() - identityStarted,
      audit: identityAudit,
      diagnostics: identityDiagnostics,
      externalRequestBlockedCount: aLayerBlockedExternalRequests,
      screenshot: identityScreenshot,
      status: 'PASS',
    });
    await identityPage.close();

    const popup = await persistentContext.newPage();
    await popup.setViewportSize({ width: 420, height: 600 });
    await popup.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    const popupDiagnostics = attachPageDiagnostics(popup);
    const popupStarted = Date.now();
    await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
    const popupErrorHeading = popup.getByRole('heading', { name: '无法准备 ShuHai' });
    await expect(popupErrorHeading).toBeVisible({ timeout: 10_000 });
    const popupHandshake = await popupHandshakeDiagnostic(popup);
    expect(popupHandshake).toMatchObject({
      windowIdAvailable: true,
      activeTabCount: 1,
      activeTabWindowMatches: true,
      response: { ok: false, errorCode: 'forbidden_sender' },
    });
    await expect(popup.getByRole('button', { name: '重新加载' })).toHaveCount(1);
    await expect(popup.getByText('链接检查', { exact: false })).toHaveCount(0);
    await expect(popup.getByText('高级设置', { exact: false })).toHaveCount(0);
    const popupAudit = await auditPage(popup, {
      bodySelector: 'body',
      auxiliarySelector: AUXILIARY_SELECTOR,
      focusNames: ['打开设置', '重新加载'],
      keySelectors: ['h1', 'button.bg-primary'],
    });
    assertPageAudit(popupAudit, 1);
    assertCleanDiagnostics(popupDiagnostics);
    const popupScreenshot = await screenshotScenario(popup, layout, 'A-02-popup-fail-closed.png');
    assertCleanDiagnostics(popupDiagnostics);
    scenarios.push({
      id: 'A-02',
      layer: 'A',
      surface: 'Direct Popup fail closed',
      viewport: { width: 420, height: 600 },
      theme: 'light',
      textScale: 'default',
      readyTimeMs: Date.now() - popupStarted,
      audit: popupAudit,
      diagnostics: popupDiagnostics,
      externalRequestBlockedCount: aLayerBlockedExternalRequests,
      screenshot: popupScreenshot,
      status: 'PASS',
    });
    await popup.close();

    const sidePanel = await persistentContext.newPage();
    await sidePanel.setViewportSize({ width: 360, height: 900 });
    await sidePanel.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    const sidePanelDiagnostics = attachPageDiagnostics(sidePanel);
    const sidePanelStarted = Date.now();
    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel/index.html`);
    await expect(sidePanel.getByRole('heading', { name: '无法打开工作区' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(sidePanel.getByRole('button', { name: '重新加载' })).toHaveCount(1);
    await expect(sidePanel.getByText('没有取消任务、修改书签或写入 Vault。')).toBeVisible();
    const sidePanelAudit = await auditPage(sidePanel, {
      bodySelector: 'body',
      auxiliarySelector: AUXILIARY_SELECTOR,
      focusNames: ['打开设置', '重新加载'],
      keySelectors: ['h1', 'button.bg-primary'],
    });
    assertPageAudit(sidePanelAudit, 1);
    assertCleanDiagnostics(sidePanelDiagnostics);
    const sidePanelScreenshot = await screenshotScenario(
      sidePanel,
      layout,
      'A-03-sidepanel-fail-closed.png',
    );
    assertCleanDiagnostics(sidePanelDiagnostics);
    scenarios.push({
      id: 'A-03',
      layer: 'A',
      surface: 'Direct Side Panel fail closed',
      viewport: { width: 360, height: 900 },
      theme: 'dark',
      textScale: 'default',
      readyTimeMs: Date.now() - sidePanelStarted,
      audit: sidePanelAudit,
      diagnostics: sidePanelDiagnostics,
      externalRequestBlockedCount: aLayerBlockedExternalRequests,
      screenshot: sidePanelScreenshot,
      status: 'PASS',
    });
    await sidePanel.close();

    const optionsPage = await persistentContext.newPage();
    await optionsPage.setViewportSize({ width: 720, height: 900 });
    await optionsPage.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    const optionsDiagnostics = attachPageDiagnostics(optionsPage);
    const optionsStarted = Date.now();
    await optionsPage.goto(`chrome-extension://${extensionId}/options/index.html`);
    await expect(optionsPage.getByRole('heading', { name: 'ShuHai 设置' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(optionsPage.getByRole('status')).toHaveText('当前设置请求未通过安全校验。');
    await expect(optionsPage.getByRole('heading', { name: 'Obsidian Vault' })).toHaveCount(0);
    await expect(optionsPage.getByRole('button')).toHaveCount(0);
    const optionsAudit = await auditPage(optionsPage, {
      bodySelector: 'body',
      auxiliarySelector: '[role="status"]',
      focusNames: [],
      keySelectors: ['h1', '[role="status"]'],
    });
    assertPageAudit(optionsAudit, 0, false);
    assertCleanDiagnostics(optionsDiagnostics);
    const optionsScreenshot = await screenshotScenario(
      optionsPage,
      layout,
      'A-04-options-fail-closed.png',
    );
    assertCleanDiagnostics(optionsDiagnostics);
    scenarios.push({
      id: 'A-04',
      layer: 'A',
      surface: 'Direct Options fail closed',
      viewport: { width: 720, height: 900 },
      theme: 'light',
      textScale: 'default',
      readyTimeMs: Date.now() - optionsStarted,
      audit: optionsAudit,
      diagnostics: optionsDiagnostics,
      externalRequestBlockedCount: aLayerBlockedExternalRequests,
      screenshot: optionsScreenshot,
      status: 'PASS',
    });
    await optionsPage.close();

    bookmarkAfter = await bookmarkDigest(worker);
    xPermissionAfter = await xPermissionGranted(worker);
    vaultAfter = await vaultHandleCount(worker);
    expect(bookmarkAfter).toEqual(bookmarkBefore);
    expect(xPermissionAfter).toBe(xPermissionBefore);
    expect(vaultAfter).toBe(vaultBefore);
    expect(aLayerBlockedExternalRequests).toBe(0);

    await persistentContext.close();
    persistentContext = undefined;
    persistentContextClosed = true;

    fixtureServer = await startFixtureServer();
    fixtureServerCreated = true;
    fixtureBrowser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-domain-reliability',
        '--disable-sync',
        '--metrics-recording-only',
        '--no-first-run',
      ],
    });
    fixtureBrowserCreated = true;

    scenarios.push(
      await executeFixtureScenario(layout, {
        browser: fixtureBrowser,
        fixtureServer,
        id: 'B-00',
        surface: 'Popup ordinary',
        pagePath: '/popup/index.html',
        screenshotName: 'B-00-popup-ordinary.png',
        viewport: { width: 420, height: 600 },
        theme: 'light',
        textScale: 'default',
        chrome: configuredChromeScenario({
          activeTabUrl: 'https://fixture.invalid/ordinary',
          surfaceSummary: surfaceSummary(),
        }),
        run: async (page, startedAt) => {
          await expect(page.getByRole('heading', { name: '整理 Chrome 书签' })).toBeVisible({
            timeout: 10_000,
          });
          await expect(page.getByRole('button', { name: '整理 Chrome 书签' })).toHaveCount(1);
          await expect(page.getByText('链接检查', { exact: false })).toHaveCount(0);
          await expect(page.getByText('高级设置', { exact: false })).toHaveCount(0);
          return {
            readyTimeMs: Date.now() - startedAt,
            expectedPrimaryCtas: 1,
            auditOptions: {
              bodySelector: 'body',
              auxiliarySelector: AUXILIARY_SELECTOR,
              focusNames: ['打开设置', '整理 Chrome 书签'],
              keySelectors: ['h1', 'button.bg-primary'],
            },
          };
        },
      }),
    );

    scenarios.push(
      await executeFixtureScenario(layout, {
        browser: fixtureBrowser,
        fixtureServer,
        id: 'B-01',
        surface: 'Popup X context',
        pagePath: '/popup/index.html',
        screenshotName: 'popup-x-context.png',
        viewport: { width: 420, height: 600 },
        theme: 'dark',
        textScale: 'default',
        chrome: configuredChromeScenario({
          activeTabUrl: 'https://x.com/i/bookmarks',
          surfaceSummary: surfaceSummary(),
        }),
        run: async (page, startedAt) => {
          await expect(page.getByRole('heading', { name: '同步 X 收藏' })).toBeVisible({
            timeout: 10_000,
          });
          await expect(page.getByRole('button', { name: '同步 X 收藏' })).toHaveCount(1);
          await expect(page.getByText('整理 Chrome 书签', { exact: false })).toHaveCount(0);
          return {
            readyTimeMs: Date.now() - startedAt,
            expectedPrimaryCtas: 1,
            auditOptions: {
              bodySelector: 'body',
              auxiliarySelector: AUXILIARY_SELECTOR,
              focusNames: ['打开设置', '同步 X 收藏'],
              keySelectors: ['h1', 'button.bg-primary'],
            },
          };
        },
      }),
    );

    scenarios.push(
      await executeFixtureScenario(layout, {
        browser: fixtureBrowser,
        fixtureServer,
        id: 'B-02',
        surface: 'Popup active task large-count input',
        pagePath: '/popup/index.html',
        screenshotName: 'B-02-popup-active-task.png',
        viewport: { width: 420, height: 600 },
        theme: 'light',
        textScale: 'default',
        chrome: configuredChromeScenario({
          activeTabUrl: 'https://fixture.invalid/large-count',
          surfaceSummary: surfaceSummary({
            bookmarkCount: 987_654,
            folderCount: 123_456,
            activeTask: {
              kind: 'x-sync',
              status: 'paused',
              updatedAt: UPDATED_AT,
            },
          }),
        }),
        run: async (page, startedAt) => {
          await expect(page.getByRole('heading', { name: '继续同步 X 收藏' })).toBeVisible({
            timeout: 10_000,
          });
          await expect(page.getByRole('button', { name: '继续当前任务' })).toHaveCount(1);
          await expect(page.getByText('987,654', { exact: false })).toHaveCount(0);
          return {
            readyTimeMs: Date.now() - startedAt,
            expectedPrimaryCtas: 1,
            auditOptions: {
              bodySelector: 'body',
              auxiliarySelector: AUXILIARY_SELECTOR,
              focusNames: ['打开设置', '继续当前任务'],
              keySelectors: ['h1', 'button.bg-primary'],
            },
          };
        },
      }),
    );

    const bookmarkData = bookmarkFixture();
    scenarios.push(
      await executeFixtureScenario(layout, {
        browser: fixtureBrowser,
        fixtureServer,
        id: 'B-03',
        surface: 'Bookmark plan ready',
        pagePath: '/sidepanel/index.html',
        screenshotName: 'sidepanel-bookmark-narrow.png',
        viewport: { width: 360, height: 900 },
        theme: 'dark',
        textScale: 'default',
        chrome: configuredChromeScenario({
          bookmarkSnapshot: bookmarkData,
          operations: [],
          classificationPlan: classificationPlan(bookmarkData.bookmarks),
        }),
        run: async (page, startedAt) => {
          await expect(page.getByRole('heading', { name: '现在要做什么？' })).toBeVisible({
            timeout: 10_000,
          });
          await page.getByRole('button', { name: /整理 Chrome 书签/u }).click();
          await expect(page.getByRole('heading', { name: '整理书签' })).toBeVisible();
          await page.getByRole('button', { name: '生成整理建议' }).click();
          await expect(page.getByRole('button', { name: '应用选中' })).toBeVisible();
          const list = page.getByRole('region', { name: '整理建议列表' });
          await list.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
            element.dispatchEvent(new Event('scroll', { bubbles: true }));
          });
          const lastTitle = page.getByText(
            '末项：安全研究 long mixed-language title for keyboard and narrow viewport verification',
            { exact: true },
          );
          await expect(lastTitle).toBeVisible();
          await expect
            .poll(async () => {
              const [listBox, titleBox] = await Promise.all([
                list.boundingBox(),
                lastTitle.boundingBox(),
              ]);
              return Boolean(
                listBox &&
                  titleBox &&
                  titleBox.y >= listBox.y &&
                  titleBox.y + titleBox.height <= listBox.y + listBox.height,
              );
            })
            .toBe(true);
          await expect
            .poll(() =>
              lastTitle.evaluate((element) => {
                const row = element.closest('.animate-list-item');
                return row ? getComputedStyle(row).opacity : null;
              }),
            )
            .toBe('1');
          await expect(page.getByRole('button', { name: '应用选中' })).toHaveCount(1);
          await expect(page.getByRole('status')).toHaveCount(2);
          return {
            readyTimeMs: Date.now() - startedAt,
            expectedPrimaryCtas: 1,
            auditOptions: {
              bodySelector: 'body',
              auxiliarySelector: '[class*="text-[12px]"]',
              focusNames: ['全选', '搜索标题', '整理建议列表', '应用选中'],
              keySelectors: ['[aria-label="整理建议列表"]', 'button.bg-primary'],
            },
          };
        },
      }),
    );

    scenarios.push(
      await executeFixtureScenario(layout, {
        browser: fixtureBrowser,
        fixtureServer,
        id: 'B-04',
        surface: 'Bookmark partial result',
        pagePath: '/sidepanel/index.html',
        screenshotName: 'B-04-bookmark-partial.png',
        viewport: { width: 720, height: 900 },
        theme: 'light',
        textScale: 'default',
        chrome: configuredChromeScenario({
          bookmarkSnapshot: bookmarkFixture(4),
          operations: [partialBookmarkOperation()],
        }),
        run: async (page, startedAt) => {
          await expect(page.getByRole('heading', { name: '现在要做什么？' })).toBeVisible({
            timeout: 10_000,
          });
          await page.getByRole('button', { name: /整理 Chrome 书签/u }).click();
          await page.getByRole('button', { name: /恢复/u }).click();
          await expect(page.getByRole('heading', { name: '操作记录' })).toBeVisible();
          await expect(page.getByText('已成功', { exact: true })).toBeVisible();
          await expect(page.getByText('失败 · chrome_api_error', { exact: true })).toBeVisible();
          await expect(page.getByText('冲突 · bookmark_changed', { exact: true })).toBeVisible();
          await expect(
            page.getByText('恢复冲突 · restore_conflict', { exact: true }),
          ).toBeVisible();
          await expect(page.getByRole('button', { name: '恢复成功项' })).toBeVisible();
          return {
            readyTimeMs: Date.now() - startedAt,
            expectedPrimaryCtas: 0,
            auditOptions: {
              bodySelector: 'body',
              auxiliarySelector: '[class*="text-[12px]"]',
              focusNames: ['返回任务入口', '恢复', '更新书签链接', '恢复成功项'],
              keySelectors: ['#operation-list-title', '#operation-detail-title'],
            },
          };
        },
      }),
    );

    const paused = pausedSeed();
    scenarios.push(
      await executeFixtureScenario(layout, {
        browser: fixtureBrowser,
        fixtureServer,
        id: 'B-05',
        surface: 'X sync paused',
        pagePath: '/sidepanel/index.html',
        screenshotName: 'B-05-x-paused.png',
        viewport: { width: 360, height: 900 },
        theme: 'light',
        textScale: 'default',
        seed: paused,
        chrome: configuredChromeScenario({
          xPermissionOrigins: [FIXTURE_X_ORIGIN],
          surfaceSummary: surfaceSummary({
            activeTask: { kind: 'x-sync', status: 'paused', updatedAt: UPDATED_AT },
          }),
        }),
        run: async (page, startedAt) => {
          await expect(page.getByRole('heading', { name: '扫描已暂停' })).toBeVisible({
            timeout: 10_000,
          });
          await expect(page.getByRole('button', { name: '继续扫描' })).toHaveCount(1);
          await expect(page.getByRole('button', { name: '使用本批结果' })).toHaveCount(1);
          await expect(page.getByRole('button', { name: '取消本次任务' })).toHaveCount(1);
          await assertVisibleWithinViewport(page, 'button:has-text("取消本次任务")');
          return {
            readyTimeMs: Date.now() - startedAt,
            expectedPrimaryCtas: 1,
            auditOptions: {
              bodySelector: 'body',
              auxiliarySelector: AUXILIARY_SELECTOR,
              focusNames: ['继续扫描', '使用本批结果', '取消本次任务'],
              keySelectors: ['#x-sync-scan-title'],
            },
          };
        },
      }),
    );

    const review = reviewSeed();
    scenarios.push(
      await executeFixtureScenario(layout, {
        browser: fixtureBrowser,
        fixtureServer,
        id: 'B-06',
        surface: 'X sync review',
        pagePath: '/sidepanel/index.html',
        screenshotName: 'B-06-x-review.png',
        viewport: { width: 480, height: 900 },
        theme: 'dark',
        textScale: 'default',
        seed: review,
        chrome: configuredChromeScenario({
          xPermissionOrigins: [FIXTURE_X_ORIGIN],
          surfaceSummary: surfaceSummary({
            activeTask: {
              kind: 'x-sync',
              status: 'ready_for_review',
              updatedAt: UPDATED_AT,
            },
          }),
        }),
        run: async (page, startedAt) => {
          await expect(page.getByRole('heading', { name: '复核本批内容' })).toBeVisible({
            timeout: 10_000,
          });
          const metadataRow = page.locator('label').filter({ hasText: '仅元数据内容默认不选' });
          const metadataCheckbox = metadataRow.getByRole('checkbox');
          await expect(metadataCheckbox).toBeDisabled();
          await expect(metadataCheckbox).not.toBeChecked();
          await expect(page.getByRole('button', { name: '保存 2 条到 Vault' })).toHaveCount(1);
          await expect(
            page.getByText('本批已经停止扫描，仍可能有更早收藏等待下一批处理。', {
              exact: true,
            }),
          ).toBeVisible();
          return {
            readyTimeMs: Date.now() - startedAt,
            expectedPrimaryCtas: 1,
            auditOptions: {
              bodySelector: 'body',
              auxiliarySelector: AUXILIARY_SELECTOR,
              focusNames: ['完整新增内容', '保存 2 条到 Vault', '取消本次任务'],
              keySelectors: ['#x-sync-review-title', 'button.bg-primary'],
            },
          };
        },
      }),
    );

    const terminal = terminalSeed();
    scenarios.push(
      await executeFixtureScenario(layout, {
        browser: fixtureBrowser,
        fixtureServer,
        id: 'B-07',
        surface: 'X sync terminal',
        pagePath: '/sidepanel/index.html',
        screenshotName: 'B-07-x-terminal.png',
        viewport: { width: 360, height: 900 },
        theme: 'light',
        textScale: 'default',
        seed: terminal,
        chrome: configuredChromeScenario({
          xPermissionOrigins: [FIXTURE_X_ORIGIN],
          surfaceSummary: surfaceSummary({
            pendingLaunch: {
              intentId: 'fixture-terminal-launch',
              target: 'x-sync',
              windowId: 7,
              expiresAtMs: Date.now() + 60_000,
            },
          }),
        }),
        run: async (page, startedAt) => {
          await expect(page.getByRole('heading', { name: /本次写入完成/u })).toBeVisible({
            timeout: 10_000,
          });
          await expect(page.getByRole('button', { name: '返回同步入口' })).toHaveCount(1);
          await expect(page.getByRole('button', { name: /继续扫描|保存 .* Vault/u })).toHaveCount(
            0,
          );
          await expect(page.getByRole('heading', { name: '逐项结果' })).toBeVisible();
          return {
            readyTimeMs: Date.now() - startedAt,
            expectedPrimaryCtas: 0,
            auditOptions: {
              bodySelector: 'body',
              auxiliarySelector: AUXILIARY_SELECTOR,
              focusNames: ['返回同步入口'],
              keySelectors: ['#x-sync-result-title'],
            },
          };
        },
      }),
    );

    scenarios.push(
      await executeFixtureScenario(layout, {
        browser: fixtureBrowser,
        fixtureServer,
        id: 'B-08',
        surface: 'Options configured AI root-rem 2x stress',
        pagePath: '/options/index.html',
        screenshotName: 'options-root-rem-2x.png',
        viewport: { width: 640, height: 900 },
        theme: 'dark',
        textScale: 'root-rem 2x stress',
        seed: { emptyVaultStore: true },
        chrome: configuredChromeScenario({
          settings: configuredSettings(),
          xPermissionOrigins: [FIXTURE_X_ORIGIN],
        }),
        run: async (page, startedAt) => {
          await expect(page.getByRole('heading', { name: 'ShuHai 设置' })).toBeVisible({
            timeout: 10_000,
          });
          const advanced = page.getByRole('button', { name: /高级设置/u });
          await advanced.scrollIntoViewIfNeeded();
          await expect(advanced).toHaveAttribute('aria-expanded', 'false');
          const baseline = await page.evaluate(() => ({
            root: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
            body: Number.parseFloat(getComputedStyle(document.body).fontSize),
            auxiliary: Number.parseFloat(
              getComputedStyle(document.querySelector('header p') as Element).fontSize,
            ),
          }));
          await advanced.focus();
          await page.keyboard.press('Enter');
          await expect(advanced).toHaveAttribute('aria-expanded', 'true');
          const rules = page.locator('summary').filter({ hasText: '分类规则' });
          await rules.focus();
          await page.keyboard.press('Enter');
          await expect(rules.locator('xpath=..')).toHaveAttribute('open', '');
          await page.evaluate(() => {
            document.documentElement.style.fontSize = '32px';
          });
          await page.waitForTimeout(50);
          const scaled = await page.evaluate(() => ({
            root: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
            body: Number.parseFloat(getComputedStyle(document.body).fontSize),
            auxiliary: Number.parseFloat(
              getComputedStyle(document.querySelector('header p') as Element).fontSize,
            ),
          }));
          expect(baseline.root).toBeGreaterThanOrEqual(16);
          expect(scaled.root).toBe(baseline.root * 2);
          await rules.scrollIntoViewIfNeeded();
          await expect(
            page.getByText('暂无自定义规则。可以添加域名、标题关键词、URL 模式或组合规则。'),
          ).toBeVisible();
          return {
            readyTimeMs: Date.now() - startedAt,
            fontScaleEvidence: {
              rootPx: { before: baseline.root, after: scaled.root },
              bodyPx: { before: baseline.body, after: scaled.body },
              auxiliaryPx: { before: baseline.auxiliary, after: scaled.auxiliary },
            },
            auditOptions: {
              bodySelector: 'body',
              auxiliarySelector: 'header p',
              focusNames: ['高级设置', '分类规则', '添加规则'],
            },
          };
        },
      }),
    );

    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      'A-01',
      'A-02',
      'A-03',
      'A-04',
      'B-00',
      'B-01',
      'B-02',
      'B-03',
      'B-04',
      'B-05',
      'B-06',
      'B-07',
      'B-08',
    ]);
    expect(hashDistBundles()).toEqual(beforeHashes);
  } catch (error) {
    fatalError = error;
  } finally {
    const teardownErrors: unknown[] = [];
    if (persistentContext) {
      try {
        await persistentContext.close();
        persistentContextClosed = true;
      } catch (error) {
        teardownErrors.push(error);
      }
    }
    if (fixtureBrowser) {
      try {
        await fixtureBrowser.close();
        fixtureBrowserClosed = true;
      } catch (error) {
        teardownErrors.push(error);
      }
    }
    if (fixtureServer) {
      try {
        await fixtureServer.close();
        fixtureServerClosed = true;
      } catch (error) {
        teardownErrors.push(error);
      }
    }
    if (teardownErrors.length > 0) {
      fatalError =
        fatalError === undefined
          ? new AggregateError(teardownErrors, 'goal_046c_teardown_failed')
          : new AggregateError(
              [fatalError, ...teardownErrors],
              'goal_046c_run_and_teardown_failed',
            );
    }
  }

  const seeded = scenarios
    .map((scenario) => scenario.fixtureSeed)
    .filter((value): value is NonNullable<typeof value> => value !== undefined);
  const handlesClosed =
    (!persistentContextCreated || persistentContextClosed) &&
    (!fixtureServerCreated || fixtureServerClosed) &&
    (!fixtureBrowserCreated || fixtureBrowserClosed);
  const overall =
    fatalError === undefined &&
    handlesClosed &&
    scenarios.length === 13 &&
    scenarios.every(
      (scenario) =>
        scenario.status === 'PASS' &&
        scenario.diagnostics.consoleErrors.length === 0 &&
        scenario.diagnostics.pageErrors.length === 0,
    )
      ? 'PASS'
      : 'FAIL';
  const report: Goal046cReport = {
    schemaVersion: 1,
    runId: layout.runId,
    branch: git.branch,
    head: git.head,
    distBundleSha256: beforeHashes,
    chromiumVersion,
    profile: relativeToRun(layout, layout.profileRoot),
    extensionId,
    mountMode: 'direct_extension_page',
    bookmarkDigest: {
      before: bookmarkBefore.digest,
      after: bookmarkAfter.digest,
      nodeCountBefore: bookmarkBefore.nodeCount,
      nodeCountAfter: bookmarkAfter.nodeCount,
    },
    xPermission: { before: xPermissionBefore, after: xPermissionAfter },
    vaultHandleCount: { before: vaultBefore, after: vaultAfter },
    seededFixtureRecords: Math.max(0, ...seeded.map((value) => value.recordCount)),
    seededFixtureBytes: Math.max(0, ...seeded.map((value) => value.bytes)),
    scenarios,
    handles: {
      persistentContextCreated,
      persistentContextClosed,
      fixtureServerCreated,
      fixtureServerClosed,
      fixtureBrowserCreated,
      fixtureBrowserClosed,
    },
    runnerTraceRoot: relativeToRun(layout, layout.runnerRoot),
    overall,
  };
  writeRunReport(layout, report);

  if (fatalError !== undefined) {
    throw fatalError;
  }
  try {
    persistPassingEvidence(layout, report);
  } catch (error) {
    writeRunReport(layout, { ...report, overall: 'FAIL' });
    throw error;
  }
});
