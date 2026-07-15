import type {
  SyncJob,
  SyncJobItem,
  SyncScanMode,
  SyncStopReason,
  WriteOutcome,
} from '../../social/sync-schema.js';
import type { XSyncLaunchIntent } from '../../social/x-sync-messages.js';

export type XSyncUiPhase = 'preflight' | 'scanning' | 'review' | 'writing' | 'result';
export type XSyncUiTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
export type XHostPermissionState = 'granted' | 'not_granted' | 'overbroad' | 'unavailable';
export type XVaultPermissionState = 'granted' | 'prompt' | 'denied' | 'missing' | 'unavailable';
export type XSyncLaunchState = 'ready' | 'waiting' | 'expired' | 'unavailable';

export interface XSyncUiSnapshot {
  job?: SyncJob;
  lastJob?: SyncJob;
  items: readonly SyncJobItem[];
  requestedMode: SyncScanMode;
  xPermission: XHostPermissionState;
  vaultPermission: XVaultPermissionState;
  launchState: XSyncLaunchState;
  pendingIntentCount: number;
}

export interface XSyncTaskSnapshot {
  job?: SyncJob;
  lastJob?: SyncJob;
  items: readonly SyncJobItem[];
  pendingIntentCount: number;
}

export interface XSyncSessionTransition {
  readonly snapshot: XSyncTaskSnapshot;
  readonly launchState: XSyncLaunchState;
  readonly jobId: string | undefined;
  readonly launchIntent: XSyncLaunchIntent | undefined;
  readonly defaultReviewKey: '';
}

export function prepareNextXSyncBatch(job: SyncJob): XSyncSessionTransition {
  return {
    snapshot: { lastJob: job, items: [], pendingIntentCount: 0 },
    launchState: 'waiting',
    jobId: undefined,
    launchIntent: undefined,
    defaultReviewKey: '',
  };
}

export function acceptFreshXSyncLaunchIntent(
  current: XSyncTaskSnapshot,
  intent: XSyncLaunchIntent,
  now: number,
): XSyncSessionTransition | undefined {
  if (!Number.isFinite(now) || now >= intent.expiresAtMs) {
    return undefined;
  }
  return {
    snapshot: {
      lastJob: current.job ?? current.lastJob,
      items: [],
      pendingIntentCount: 0,
    },
    launchState: 'ready',
    jobId: undefined,
    launchIntent: intent,
    defaultReviewKey: '',
  };
}

export interface XSyncClassificationCounts {
  new: number;
  existingObservations: number;
  changed: number;
  incomplete: number;
  error: number;
  summaryOnly: number;
}

export interface XSyncResultRow {
  sourceItemId: string;
  status: WriteOutcome['status'];
  relativePath: string;
}

export interface XSyncUiModel {
  phase: XSyncUiPhase;
  headline: string;
  description: string;
  tone: XSyncUiTone;
  counts: XSyncClassificationCounts;
  candidateCount: number;
  candidateLimit: number;
  progressPercent: number;
  selectedSourceItemIds: string[];
  selectableSourceItemIds: string[];
  selectionIsPersisted: boolean;
  primaryReviewLabel: string;
  resultRows: XSyncResultRow[];
  canStart: boolean;
  canRequestXPermission: boolean;
  canRevokeXPermission: boolean;
  canPause: boolean;
  canResume: boolean;
  canFinalizeBatch: boolean;
  canCancel: boolean;
  canContinueWriting: boolean;
  canRetryWrites: boolean;
  canAbandonWriting: boolean;
  canPrepareNextBatch: boolean;
}

const X_HOST_ORIGIN = 'https://x.com/*';
const X_DEFAULT_CANDIDATE_LIMIT = 10;
const LEGACY_BROAD_HOST_ORIGINS = new Set(['http://*/*', 'https://*/*']);

export function classifyXHostPermissionOrigins(
  origins: readonly string[],
): Exclude<XHostPermissionState, 'unavailable'> {
  if (origins.some((origin) => LEGACY_BROAD_HOST_ORIGINS.has(origin))) {
    return 'overbroad';
  }
  return origins.includes(X_HOST_ORIGIN) ? 'granted' : 'not_granted';
}

const ACTIVE_STATUSES = new Set<SyncJob['status']>([
  'prepared',
  'scanning',
  'paused',
  'ready_for_review',
  'writing',
  'partial',
]);

function phaseForJob(job: SyncJob | undefined): XSyncUiPhase {
  if (!job || job.status === 'prepared') {
    return 'preflight';
  }
  if (job.status === 'scanning') {
    return 'scanning';
  }
  if (job.status === 'paused') {
    return job.stopRecord?.phase === 'writing' ? 'writing' : 'scanning';
  }
  if (job.status === 'ready_for_review') {
    return 'review';
  }
  if (job.status === 'writing') {
    return 'writing';
  }
  return 'result';
}

function stopReasonCopy(
  reason: SyncStopReason,
  phase: 'scanning' | 'writing',
): Pick<XSyncUiModel, 'headline' | 'description' | 'tone'> {
  switch (reason) {
    case 'user_paused':
      return {
        headline: '扫描已暂停',
        description: '你可以继续扫描，或使用当前批次进入复核。',
        tone: 'info',
      };
    case 'budget_exceeded':
      return {
        headline: '本批达到安全上限',
        description: '仍可能有更早收藏。你可以使用本批结果，之后再启动下一批。',
        tone: 'warning',
      };
    case 'login_required':
      return {
        headline: 'X 需要重新登录',
        description: '任务已暂停，不会尝试自动登录或绕过验证。',
        tone: 'warning',
      };
    case 'rate_limited':
      return {
        headline: 'X 暂时限制访问',
        description: '任务已暂停且不会自动重试。请稍后由你手动继续。',
        tone: 'warning',
      };
    case 'structure_changed':
      return {
        headline: '收藏页结构发生变化',
        description: '为避免读取错误内容，ShuHai 已停止本次扫描。',
        tone: 'danger',
      };
    case 'no_progress':
      return {
        headline: '扫描没有继续前进',
        description: '连续多个批次没有发现新的稳定条目，任务已暂停。',
        tone: 'warning',
      };
    case 'tab_changed':
      return {
        headline: '收藏页已切换',
        description: '任务已暂停，ShuHai 不会读取其它标签页或其它页面。',
        tone: 'warning',
      };
    case 'permission_revoked':
      return phase === 'writing'
        ? {
            headline: 'Vault 写入权限已失效',
            description: '已写入结果会保留。重新授权后才能继续剩余条目。',
            tone: 'warning',
          }
        : {
            headline: 'X 读取权限已撤销',
            description: '复核数据已保留；重新允许访问后才能继续扫描。',
            tone: 'warning',
          };
    case 'worker_interrupted':
      return {
        headline: '后台任务被中断',
        description: '进度已保存。由你确认后可以从当前任务继续。',
        tone: 'warning',
      };
  }
}

function scanCompletionCopy(job: SyncJob): Pick<XSyncUiModel, 'headline' | 'description' | 'tone'> {
  switch (job.scanCompletion) {
    case 'trusted_terminal':
      return {
        headline: '已到收藏列表末尾',
        description: '请复核本次发现的内容；只有新增条目会被默认选择。',
        tone: 'success',
      };
    case 'known_frontier':
      return {
        headline: '已到已同步记录边界',
        description: '本次增量扫描已停止，但这不代表平台上的全部历史收藏都已导入。',
        tone: 'info',
      };
    case 'user_finalized_batch':
      return {
        headline: '正在使用本批结果',
        description: '本批已经停止扫描，仍可能有更早收藏等待下一批处理。',
        tone: 'info',
      };
    case 'legacy_migrated':
      return {
        headline: '旧任务结果已迁移',
        description: '这些结果可以复核，但不能据此判断是否到达收藏列表末尾。',
        tone: 'warning',
      };
    default:
      return {
        headline: '本批等待复核',
        description: '请选择要写入 Vault 的新增内容。',
        tone: 'info',
      };
  }
}

function terminalCopy(job: SyncJob): Pick<XSyncUiModel, 'headline' | 'description' | 'tone'> {
  const summary = job.summary;
  const settled = summary.createdCount + summary.alreadyExistsCount + summary.skippedCount;
  switch (job.status) {
    case 'complete':
      return summary.selectedCount === 0
        ? {
            headline: '本次已结束，没有写入 Vault',
            description: '没有选择需要保存的新增内容，扫描与复核记录仍保留在本地。',
            tone: 'neutral',
          }
        : {
            headline: `本次写入完成：${settled} 条已有结果`,
            description: `新建 ${summary.createdCount}，已存在 ${summary.alreadyExistsCount}，跳过 ${summary.skippedCount}。`,
            tone: 'success',
          };
    case 'complete_with_issues':
      return {
        headline: '本次已结束，但仍有未处理问题',
        description: `${summary.classificationErrorCount} 条提取或分类错误未保存，且没有写入 Vault。`,
        tone: 'warning',
      };
    case 'partial':
      return summary.writeErrorCount === 0
        ? {
            headline: '写入已结束，但有内容未保存',
            description: `新建 ${summary.createdCount}，已存在 ${summary.alreadyExistsCount}，跳过 ${summary.skippedCount}；另有 ${summary.classificationErrorCount} 条提取或分类问题未写入。`,
            tone: 'warning',
          }
        : {
            headline: '写入未全部完成',
            description: `新建 ${summary.createdCount}，已存在 ${summary.alreadyExistsCount}，跳过 ${summary.skippedCount}，写入失败 ${summary.writeErrorCount}${summary.classificationErrorCount > 0 ? `，另有 ${summary.classificationErrorCount} 条内容问题` : ''}。`,
            tone: 'warning',
          };
    case 'cancelled':
      return {
        headline: '本次任务已取消',
        description:
          settled + summary.writeErrorCount > 0
            ? `已保留 ${settled + summary.writeErrorCount} 条逐项写入结果，不会回滚或删除文件。`
            : '没有写入新文件；扫描和复核历史仍保留在本地。',
        tone: 'neutral',
      };
    case 'failed':
      return {
        headline: '本次任务未完成',
        description: '已保留可核实的进度与结果，没有把失败写成成功。',
        tone: 'danger',
      };
    default:
      return {
        headline: '写入结果已保留',
        description: '请根据逐项结果继续处理。',
        tone: 'warning',
      };
  }
}

function copyForSnapshot(
  snapshot: XSyncUiSnapshot,
  phase: XSyncUiPhase,
): Pick<XSyncUiModel, 'headline' | 'description' | 'tone'> {
  const job = snapshot.job;
  if (!job) {
    if (snapshot.launchState === 'expired') {
      return {
        headline: '启动已过期',
        description: '请重新点击扩展按钮，再从当前 X 收藏页启动。',
        tone: 'warning',
      };
    }
    if (snapshot.xPermission === 'overbroad') {
      return {
        headline: '先收回旧的全网站权限',
        description: '链接体检曾获得全网站访问；撤销后才能单独允许 ShuHai 读取 x.com。',
        tone: 'warning',
      };
    }
    if (
      snapshot.launchState === 'waiting' &&
      snapshot.lastJob &&
      !ACTIVE_STATUSES.has(snapshot.lastJob.status)
    ) {
      return {
        headline: '已返回 X 同步入口',
        description: '点击浏览器工具栏中的 ShuHai 启动下一批；侧边栏会自动继续，无需重载扩展。',
        tone: 'neutral',
      };
    }
    if (snapshot.xPermission !== 'granted') {
      return {
        headline: '允许读取当前 X 收藏页',
        description: '仅申请 x.com 页面权限，不读取 Cookie、token 或其它标签页。',
        tone: 'neutral',
      };
    }
    return {
      headline: '准备同步 X 收藏',
      description: '确认模式后开始受预算扫描；内容不会在复核前写入 Vault。',
      tone: 'neutral',
    };
  }
  if (job.status === 'paused' && job.stopRecord) {
    return stopReasonCopy(job.stopRecord.code, job.stopRecord.phase);
  }
  if (job.status === 'prepared') {
    return {
      headline: '同步任务已创建，等待继续',
      description: '后台在扫描开始前中断；你可以从当前 X 收藏页继续，或取消本次任务。',
      tone: 'warning',
    };
  }
  if (phase === 'scanning') {
    return {
      headline: '正在扫描当前收藏页',
      description: '每次只处理一个受界批次；你可以随时暂停。',
      tone: 'info',
    };
  }
  if (phase === 'review') {
    return scanCompletionCopy(job);
  }
  if (phase === 'writing') {
    return {
      headline: '正在逐条写入 Vault',
      description: '每条结果和实际相对路径都会持久化；已有文件默认不覆盖。',
      tone: 'info',
    };
  }
  return terminalCopy(job);
}

function classificationCounts(
  job: SyncJob | undefined,
  items: readonly SyncJobItem[],
): XSyncClassificationCounts {
  const count = (classification: SyncJobItem['classification']): number =>
    items.filter((item) => item.classification === classification).length;
  const legacyExistingRows = count('existing');
  return {
    new: count('new'),
    existingObservations: Math.max(
      legacyExistingRows,
      job?.checkpoint?.catalogExistingObservationCount ?? 0,
    ),
    changed: count('changed'),
    incomplete: count('incomplete'),
    error: count('error'),
    summaryOnly: items.filter((item) => item.item.completeness === 'summary_only').length,
  };
}

function eligibleItems(items: readonly SyncJobItem[]): SyncJobItem[] {
  return items.filter(
    (item) =>
      item.classification === 'new' &&
      (item.item.completeness === 'complete' || item.item.completeness === 'summary_only'),
  );
}

function resultRows(items: readonly SyncJobItem[]): XSyncResultRow[] {
  return items
    .filter((item): item is SyncJobItem & { outcome: WriteOutcome } => item.outcome !== undefined)
    .map((item) => ({
      sourceItemId: item.sourceItemId,
      status: item.outcome.status,
      relativePath: item.outcome.relativePath,
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function formatXSyncShortStatus(job: SyncJob | undefined): string {
  if (!job) {
    return '尚未同步';
  }
  switch (job.status) {
    case 'prepared':
      return '等待开始';
    case 'scanning':
      return `正在扫描 · ${job.checkpoint?.candidateCount ?? 0} 条待复核`;
    case 'paused':
      return `已暂停 · ${stopReasonCopy(job.stopRecord?.code ?? 'worker_interrupted', job.stopRecord?.phase ?? 'scanning').headline}`;
    case 'ready_for_review':
      return `等待复核 · ${job.summary.uniqueItemCount} 条`;
    case 'writing':
      return `正在写入 · 剩余 ${job.summary.writePendingCount} 条`;
    case 'partial':
      return job.summary.writeErrorCount > 0
        ? `部分完成 · ${job.summary.writeErrorCount} 条写入失败`
        : `部分完成 · ${job.summary.classificationErrorCount} 条内容问题`;
    case 'complete':
      return job.summary.selectedCount === 0
        ? '已结束 · 未写入'
        : `已完成 · 新建 ${job.summary.createdCount} 条`;
    case 'complete_with_issues':
      return `已结束 · ${job.summary.classificationErrorCount} 条问题`;
    case 'cancelled':
      return '已取消';
    case 'failed':
      return '未完成';
  }
}

export function deriveXSyncUiModel(snapshot: XSyncUiSnapshot): XSyncUiModel {
  const job = snapshot.job;
  const phase = phaseForJob(job);
  const copy = copyForSnapshot(snapshot, phase);
  const eligible = eligibleItems(snapshot.items);
  const selectionIsPersisted = Boolean(
    job &&
      (job.reviewRevision > 0 ||
        (job.status === 'ready_for_review' &&
          job.summary.uniqueItemCount === 0 &&
          job.summary.unreviewedCount === 0)),
  );
  const selected = selectionIsPersisted
    ? snapshot.items.filter((item) => item.reviewDecision === 'selected')
    : eligible;
  const selectedSourceItemIds = selected.map((item) => item.sourceItemId).sort();
  const selectableSourceItemIds = eligible.map((item) => item.sourceItemId).sort();
  const candidateCount = job?.checkpoint?.candidateCount ?? job?.summary.uniqueItemCount ?? 0;
  const candidateLimit = job?.budgets.maxItems ?? X_DEFAULT_CANDIDATE_LIMIT;
  const progressPercent =
    candidateLimit > 0 ? Math.min(100, Math.round((candidateCount / candidateLimit) * 100)) : 0;
  const isActive = Boolean(job && ACTIVE_STATUSES.has(job.status));
  const pausedScanning = job?.status === 'paused' && job.stopRecord?.phase === 'scanning';
  const pausedWriting = job?.status === 'paused' && job.stopRecord?.phase === 'writing';
  const hasPendingWrites = Boolean(
    job && (job.summary.writePendingCount > 0 || snapshot.pendingIntentCount > 0),
  );
  const canFinalizeBatch = Boolean(
    pausedScanning &&
      (job.stopRecord?.code === 'user_paused' || job.stopRecord?.code === 'budget_exceeded'),
  );

  return {
    phase,
    ...copy,
    counts: classificationCounts(job, snapshot.items),
    candidateCount,
    candidateLimit,
    progressPercent,
    selectedSourceItemIds,
    selectableSourceItemIds,
    selectionIsPersisted,
    primaryReviewLabel:
      selectedSourceItemIds.length === 0
        ? '结束本次，不写入'
        : `保存 ${selectedSourceItemIds.length} 条到 Vault`,
    resultRows: resultRows(snapshot.items),
    canStart: !job && snapshot.launchState === 'ready' && snapshot.xPermission === 'granted',
    canRequestXPermission:
      snapshot.xPermission === 'not_granted' &&
      ((!job && snapshot.launchState === 'ready') ||
        job?.status === 'prepared' ||
        Boolean(pausedScanning && job.stopRecord?.code === 'permission_revoked')),
    canRevokeXPermission: snapshot.xPermission === 'granted' && !isActive,
    canPause: job?.status === 'scanning',
    canResume: Boolean(job?.status === 'prepared' || pausedScanning),
    canFinalizeBatch,
    canCancel: Boolean(
      job && (['prepared', 'scanning', 'ready_for_review'].includes(job.status) || pausedScanning),
    ),
    canContinueWriting: Boolean((job?.status === 'writing' || pausedWriting) && hasPendingWrites),
    canRetryWrites: Boolean(
      job?.status === 'partial' && (job.summary.writeErrorCount > 0 || hasPendingWrites),
    ),
    canAbandonWriting: Boolean(
      job &&
        (job.status === 'writing' || job.status === 'partial' || pausedWriting) &&
        !hasPendingWrites,
    ),
    canPrepareNextBatch: Boolean(job && !ACTIVE_STATUSES.has(job.status)),
  };
}
