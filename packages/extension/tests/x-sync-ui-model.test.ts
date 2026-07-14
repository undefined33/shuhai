import { describe, expect, it } from 'vitest';

import type {
  SyncJob,
  SyncJobItem,
  SyncJobStatus,
  SyncStopReason,
} from '../src/social/sync-schema.js';
import {
  classifyXHostPermissionOrigins,
  deriveXSyncUiModel,
  formatXSyncShortStatus,
  type XSyncUiSnapshot,
} from '../src/popup/pages/x-sync-ui-model.js';

const NOW = '2026-07-14T00:00:00.000Z';

function summary(overrides: Partial<SyncJob['summary']> = {}): SyncJob['summary'] {
  return {
    scannedCount: 0,
    uniqueItemCount: 0,
    pendingReviewCount: 0,
    classificationErrorCount: 0,
    unreviewedCount: 0,
    selectedCount: 0,
    excludedCount: 0,
    writePendingCount: 0,
    createdCount: 0,
    alreadyExistsCount: 0,
    skippedCount: 0,
    writeErrorCount: 0,
    ...overrides,
  };
}

function job(status: SyncJobStatus, overrides: Partial<SyncJob> = {}): SyncJob {
  return {
    schemaVersion: 1,
    contractVersion: 2,
    id: 'job-ui-1',
    source: 'x',
    status,
    scanMode: 'incremental',
    adapterVersion: 1,
    scanRevision: 1,
    reviewRevision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    budgets: {
      maxItems: 50,
      maxPages: 20,
      maxDurationMs: 15_000,
      maxItemBytes: 16_384,
      maxMediaPerItem: 12,
    },
    summary: summary(),
    ...overrides,
  };
}

function item(
  sourceItemId: string,
  classification: SyncJobItem['classification'],
  options: {
    completeness?: SyncJobItem['item']['completeness'];
    reviewDecision?: SyncJobItem['reviewDecision'];
    reviewRevision?: number;
    outcome?: SyncJobItem['outcome'];
  } = {},
): SyncJobItem {
  const reviewDecision = options.reviewDecision ?? 'unreviewed';
  return {
    schemaVersion: 1,
    jobId: 'job-ui-1',
    sourceItemId,
    item: {
      schemaVersion: 1,
      source: 'x',
      sourceItemId,
      canonicalUrl: `https://x.com/example/status/${sourceItemId}`,
      title: `Item ${sourceItemId}`,
      text: 'Bounded fixture text',
      capturedAt: NOW,
      completeness: options.completeness ?? 'complete',
      media: [],
      contentHash: sourceItemId.padStart(64, '0'),
      extractorVersion: 1,
    },
    classification,
    reviewDecision,
    reviewRevision: options.reviewRevision ?? (reviewDecision === 'unreviewed' ? 0 : 1),
    writeStatus: options.outcome?.status ?? 'not_requested',
    ...(options.outcome ? { outcome: options.outcome } : {}),
    discoveredAt: NOW,
    updatedAt: NOW,
  };
}

function snapshot(overrides: Partial<XSyncUiSnapshot> = {}): XSyncUiSnapshot {
  return {
    items: [],
    requestedMode: 'incremental',
    xPermission: 'granted',
    vaultPermission: 'missing',
    launchState: 'ready',
    pendingIntentCount: 0,
    ...overrides,
  };
}

describe('X sync UI model', () => {
  it.each([
    [[], 'not_granted'],
    [['https://x.com/*'], 'granted'],
    [['http://*/*'], 'overbroad'],
    [['https://*/*'], 'overbroad'],
    [['https://x.com/*', 'https://*/*'], 'overbroad'],
  ] as const)('classifies host permission origins %j as %s', (origins, expected) => {
    expect(classifyXHostPermissionOrigins(origins)).toBe(expected);
  });

  it('keeps preflight permission and expired-launch states distinct', () => {
    const permission = deriveXSyncUiModel(
      snapshot({ xPermission: 'not_granted', launchState: 'ready' }),
    );
    const expired = deriveXSyncUiModel(snapshot({ launchState: 'expired' }));

    expect(permission.phase).toBe('preflight');
    expect(permission.canRequestXPermission).toBe(true);
    expect(permission.headline).toContain('允许读取');
    expect(expired.canStart).toBe(false);
    expect(expired.headline).toBe('启动已过期');
  });

  it('fails closed when a legacy broad host grant covers X', () => {
    const model = deriveXSyncUiModel(snapshot({ xPermission: 'overbroad' }));

    expect(model.phase).toBe('preflight');
    expect(model.canStart).toBe(false);
    expect(model.canRequestXPermission).toBe(false);
    expect(model.headline).toContain('全网站权限');
  });

  it.each<[SyncStopReason, string]>([
    ['budget_exceeded', '安全上限'],
    ['login_required', '重新登录'],
    ['rate_limited', '限制访问'],
    ['tab_changed', '收藏页已切换'],
    ['permission_revoked', '读取权限已撤销'],
    ['worker_interrupted', '后台任务被中断'],
    ['structure_changed', '结构发生变化'],
    ['no_progress', '没有继续前进'],
  ])('renders a specific scanning stop message for %s', (reason, expected) => {
    const model = deriveXSyncUiModel(
      snapshot({
        job: job('paused', {
          stopRecord: {
            code: reason,
            stoppedAt: NOW,
            phase: 'scanning',
            scanRevision: 1,
            scannedCount: 0,
            acceptedCount: 0,
          },
        }),
      }),
    );

    expect(model.phase).toBe('scanning');
    expect(model.headline).toContain(expected);
  });

  it('does not offer pre-write cancellation for a paused writing job', () => {
    const model = deriveXSyncUiModel(
      snapshot({
        job: job('paused', {
          stopRecord: {
            code: 'permission_revoked',
            stoppedAt: NOW,
            phase: 'writing',
            scanRevision: 1,
            scannedCount: 1,
            acceptedCount: 1,
          },
        }),
      }),
    );

    expect(model.phase).toBe('writing');
    expect(model.canCancel).toBe(false);
    expect(model.canAbandonWriting).toBe(true);
  });

  it('offers permission recovery for an existing scan paused after revocation', () => {
    const model = deriveXSyncUiModel(
      snapshot({
        xPermission: 'not_granted',
        launchState: 'unavailable',
        job: job('paused', {
          stopRecord: {
            code: 'permission_revoked',
            stoppedAt: NOW,
            phase: 'scanning',
            scanRevision: 1,
            scannedCount: 1,
            acceptedCount: 1,
          },
        }),
      }),
    );

    expect(model.canRequestXPermission).toBe(true);
    expect(model.canResume).toBe(true);
  });

  it('can continue or cancel a prepared job recovered after worker interruption', () => {
    const model = deriveXSyncUiModel(snapshot({ job: job('prepared') }));

    expect(model.phase).toBe('preflight');
    expect(model.headline).toContain('等待继续');
    expect(model.canResume).toBe(true);
    expect(model.canCancel).toBe(true);
  });

  it('distinguishes budget finalization, known frontier, and trusted terminal', () => {
    const budget = deriveXSyncUiModel(
      snapshot({
        job: job('paused', {
          stopRecord: {
            code: 'budget_exceeded',
            stoppedAt: NOW,
            phase: 'scanning',
            scanRevision: 1,
            scannedCount: 50,
            acceptedCount: 50,
          },
        }),
      }),
    );
    const frontier = deriveXSyncUiModel(
      snapshot({ job: job('ready_for_review', { scanCompletion: 'known_frontier' }) }),
    );
    const terminal = deriveXSyncUiModel(
      snapshot({ job: job('ready_for_review', { scanCompletion: 'trusted_terminal' }) }),
    );

    expect(budget.canFinalizeBatch).toBe(true);
    expect(budget.description).toContain('更早收藏');
    expect(frontier.headline).toContain('已同步记录边界');
    expect(frontier.description).toContain('不代表');
    expect(terminal.headline).toBe('已到收藏列表末尾');
  });

  it('allows an empty reviewed scan to finish without manufacturing a selection revision', () => {
    const model = deriveXSyncUiModel(
      snapshot({
        job: job('ready_for_review', {
          scanCompletion: 'trusted_terminal',
          reviewRevision: 0,
          summary: summary(),
        }),
      }),
    );

    expect(model.selectionIsPersisted).toBe(true);
    expect(model.selectedSourceItemIds).toEqual([]);
    expect(model.primaryReviewLabel).toBe('结束本次，不写入');
  });

  it('defaults only eligible new items and exposes summary-only content', () => {
    const items = [
      item('1', 'new'),
      item('2', 'new', { completeness: 'summary_only' }),
      item('3', 'changed'),
      item('4', 'incomplete'),
      item('5', 'error'),
      item('6', 'new', { completeness: 'metadata_only' }),
    ];
    const model = deriveXSyncUiModel(
      snapshot({
        job: job('ready_for_review', {
          scanCompletion: 'known_frontier',
          summary: summary({ uniqueItemCount: items.length, unreviewedCount: items.length }),
        }),
        items,
      }),
    );

    expect(model.selectedSourceItemIds).toEqual(['1', '2']);
    expect(model.selectableSourceItemIds).toEqual(['1', '2']);
    expect(model.counts).toMatchObject({
      new: 3,
      changed: 1,
      incomplete: 1,
      error: 1,
      summaryOnly: 1,
    });
    expect(model.primaryReviewLabel).toBe('保存 2 条到 Vault');
  });

  it('uses persisted review decisions instead of recomputing defaults', () => {
    const items = [
      item('1', 'new', { reviewDecision: 'excluded', reviewRevision: 2 }),
      item('2', 'new', { reviewDecision: 'selected', reviewRevision: 2 }),
    ];
    const model = deriveXSyncUiModel(
      snapshot({
        job: job('ready_for_review', {
          scanCompletion: 'user_finalized_batch',
          reviewRevision: 2,
          summary: summary({
            uniqueItemCount: 2,
            pendingReviewCount: 0,
            selectedCount: 1,
            excludedCount: 1,
          }),
        }),
        items,
      }),
    );

    expect(model.selectionIsPersisted).toBe(true);
    expect(model.selectedSourceItemIds).toEqual(['2']);
  });

  it('offers an explicit no-write completion when nothing is selected', () => {
    const model = deriveXSyncUiModel(
      snapshot({
        job: job('ready_for_review', {
          scanCompletion: 'user_finalized_batch',
          reviewRevision: 1,
          summary: summary({ uniqueItemCount: 1, excludedCount: 1 }),
        }),
        items: [item('1', 'changed', { reviewDecision: 'excluded' })],
      }),
    );

    expect(model.primaryReviewLabel).toBe('结束本次，不写入');
  });

  it('does not present no-write issues or partial writes as success', () => {
    const noWriteIssues = deriveXSyncUiModel(
      snapshot({
        job: job('complete_with_issues', {
          scanCompletion: 'user_finalized_batch',
          reviewRevision: 1,
          summary: summary({
            uniqueItemCount: 2,
            classificationErrorCount: 2,
            excludedCount: 2,
          }),
        }),
      }),
    );
    const partial = deriveXSyncUiModel(
      snapshot({
        job: job('partial', {
          scanCompletion: 'known_frontier',
          reviewRevision: 1,
          authorizedReviewRevision: 1,
          writeAuthorizedAt: NOW,
          summary: summary({
            uniqueItemCount: 2,
            selectedCount: 2,
            createdCount: 1,
            writeErrorCount: 1,
          }),
        }),
        items: [
          item('1', 'new', {
            reviewDecision: 'selected',
            outcome: { status: 'created', relativePath: 'ShuHai/x/1.md', bytes: 128 },
          }),
          item('2', 'new', {
            reviewDecision: 'selected',
            outcome: { status: 'error', relativePath: 'ShuHai/x/2.md', code: 'write_failed' },
          }),
        ],
      }),
    );

    expect(noWriteIssues.tone).toBe('warning');
    expect(noWriteIssues.description).toContain('没有写入 Vault');
    expect(partial.tone).toBe('warning');
    expect(partial.headline).toBe('写入未全部完成');
    expect(partial.canRetryWrites).toBe(true);
    expect(partial.resultRows.map((row) => row.relativePath)).toEqual([
      'ShuHai/x/1.md',
      'ShuHai/x/2.md',
    ]);
  });

  it('does not label classification-only partial results as retryable write failures', () => {
    const partial = job('partial', {
      scanCompletion: 'known_frontier',
      reviewRevision: 1,
      authorizedReviewRevision: 1,
      writeAuthorizedAt: NOW,
      summary: summary({
        uniqueItemCount: 2,
        selectedCount: 1,
        excludedCount: 1,
        createdCount: 1,
        classificationErrorCount: 1,
      }),
    });
    const model = deriveXSyncUiModel(snapshot({ job: partial }));

    expect(model.headline).toBe('写入已结束，但有内容未保存');
    expect(model.description).toContain('提取或分类问题');
    expect(model.canRetryWrites).toBe(false);
    expect(model.canAbandonWriting).toBe(true);
    expect(formatXSyncShortStatus(partial)).toBe('部分完成 · 1 条内容问题');
  });

  it('keeps cancelled probes on the bounded preflight limit', () => {
    const model = deriveXSyncUiModel(snapshot({ lastJob: job('cancelled') }));
    expect(model.candidateLimit).toBe(10);
  });

  it.each([
    ['complete', true],
    ['complete_with_issues', true],
    ['cancelled', true],
    ['failed', true],
    ['prepared', false],
    ['scanning', false],
    ['paused', false],
    ['ready_for_review', false],
    ['writing', false],
    ['partial', false],
  ] as const)('sets return-to-workspace for %s to %s', (status, expected) => {
    const model = deriveXSyncUiModel(snapshot({ job: job(status) }));

    expect(model.canReturnToWorkspace).toBe(expected);
  });

  it('does not offer a workspace return without a job', () => {
    expect(deriveXSyncUiModel(snapshot()).canReturnToWorkspace).toBe(false);
  });

  it('reports an explicit no-write terminal result', () => {
    const completed = job('complete', {
      scanCompletion: 'known_frontier',
      reviewRevision: 1,
      summary: summary({ uniqueItemCount: 3, excludedCount: 3 }),
    });
    const model = deriveXSyncUiModel(snapshot({ job: completed }));

    expect(model.headline).toBe('本次已结束，没有写入 Vault');
    expect(formatXSyncShortStatus(completed)).toBe('已结束 · 未写入');
  });
});
