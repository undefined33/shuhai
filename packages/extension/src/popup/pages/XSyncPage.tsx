import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Ban, CheckCircle2, Pause, Play, RefreshCw, ShieldCheck } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { Checkbox } from '../../components/ui/checkbox.js';
import { Progress } from '../../components/ui/progress.js';
import { createVaultSyncEngine } from '../../social/sync-engine.js';
import type { SyncJobItem, SyncScanMode } from '../../social/sync-schema.js';
import { openSyncStore, type SyncStore } from '../../social/sync-store.js';
import {
  X_SYNC_LAUNCH_INTENT_KEY,
  X_SYNC_LAUNCH_WAIT_ATTEMPTS,
  X_SYNC_LAUNCH_WAIT_MS,
} from '../../social/x-sync-launch-intent.js';
import {
  X_SYNC_PROTOCOL,
  parseXSyncLaunchIntent,
  parseXSyncPortMessage,
  parseXSyncUiResponse,
  type XSyncLaunchIntent,
  type XSyncUiRequest,
  type XSyncUiResponse,
} from '../../social/x-sync-messages.js';
import {
  checkVaultPermission,
  getVaultHandle,
  queryVaultPermission,
  requestVaultAccess,
} from '../../utils/vault-writer.js';
import {
  acceptFreshXSyncLaunchIntent,
  classifyXHostPermissionOrigins,
  deriveXSyncUiModel,
  prepareNextXSyncBatch,
  type XHostPermissionState,
  type XSyncLaunchState,
  type XSyncTaskSnapshot,
  type XVaultPermissionState,
} from './x-sync-ui-model.js';

const X_ORIGIN = 'https://x.com/*';
const LEGACY_BROAD_ORIGINS = ['http://*/*', 'https://*/*'] as const;
const VAULT_PREFIX = 'ShuHai';
const COMMAND_TIMEOUT_MS = 30_000;

interface PendingCommand {
  resolve(response: XSyncUiResponse): void;
  reject(error: Error): void;
  timeoutId: number;
}

const EMPTY_SNAPSHOT: XSyncTaskSnapshot = { items: [], pendingIntentCount: 0 };

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function readSessionLaunchIntent(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.storage.session.get(X_SYNC_LAUNCH_INTENT_KEY, (items) => {
      const error = chrome.runtime.lastError?.message;
      if (error) {
        reject(new Error('无法读取本次启动状态'));
        return;
      }
      resolve(items[X_SYNC_LAUNCH_INTENT_KEY]);
    });
  });
}

async function waitForLaunchIntent(): Promise<XSyncLaunchIntent | undefined> {
  const startedAt = Date.now();
  for (let attempt = 0; attempt < X_SYNC_LAUNCH_WAIT_ATTEMPTS; attempt += 1) {
    const raw = await readSessionLaunchIntent();
    if (raw !== undefined) {
      const intent = parseXSyncLaunchIntent(raw);
      return Date.now() < intent.expiresAtMs ? intent : undefined;
    }
    if (attempt + 1 < X_SYNC_LAUNCH_WAIT_ATTEMPTS) {
      const elapsed = Date.now() - startedAt;
      const remaining = X_SYNC_LAUNCH_WAIT_MS - elapsed;
      if (remaining <= 0) {
        break;
      }
      await delay(Math.min(500, remaining));
    }
  }
  return undefined;
}

function inspectXPermission(): Promise<XHostPermissionState> {
  return new Promise((resolve) => {
    if (!chrome.permissions?.getAll) {
      resolve('unavailable');
      return;
    }
    chrome.permissions.getAll((permissions) => {
      if (chrome.runtime.lastError) {
        resolve('unavailable');
        return;
      }
      resolve(classifyXHostPermissionOrigins(permissions.origins ?? []));
    });
  });
}

function requestXPermission(): Promise<XHostPermissionState> {
  return new Promise((resolve) => {
    chrome.permissions.request({ origins: [X_ORIGIN] }, (granted) => {
      if (!granted || chrome.runtime.lastError) {
        resolve('not_granted');
        return;
      }
      void inspectXPermission().then(resolve);
    });
  });
}

function removeXPermission(): Promise<XHostPermissionState> {
  return new Promise((resolve) => {
    chrome.permissions.remove({ origins: [X_ORIGIN] }, () => {
      void inspectXPermission().then(resolve);
    });
  });
}

function removeLegacyBroadPermissions(): Promise<XHostPermissionState> {
  return new Promise((resolve) => {
    chrome.permissions.remove({ origins: [...LEGACY_BROAD_ORIGINS] }, () => {
      void inspectXPermission().then(resolve);
    });
  });
}

function newRequestId(): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (!id) {
    throw new Error('当前浏览器无法创建安全请求标识');
  }
  return `ui-${id}`;
}

function commandError(response: Extract<XSyncUiResponse, { ok: false }>): Error {
  const copy: Record<string, string> = {
    forbidden_sender: '当前页面无权控制 X 同步任务',
    launch_expired: '启动已过期，请重新点击扩展按钮',
    launch_missing: '没有找到本次启动请求，请重新点击扩展按钮',
    source_conflict: '已有一个 X 同步任务正在进行',
    stale_revision: '任务状态已经变化，已重新载入最新进度',
    invalid_state: '当前任务阶段不允许执行这个操作',
    tab_changed: 'X 收藏页已经切换，任务没有读取其它页面',
    permission_revoked: 'X 页面访问权限尚未授予或已被撤销',
    storage_corrupt: '同步状态无法安全读取，任务已停止',
    invalid_message: '同步请求未通过安全校验',
    internal_error: '同步任务暂时无法继续',
  };
  return new Error(copy[response.error.code] ?? '同步任务暂时无法继续');
}

function permissionLabel(state: XHostPermissionState): string {
  if (state === 'granted') return '已允许读取 x.com';
  if (state === 'overbroad') return '存在旧的全网站权限';
  if (state === 'not_granted') return '尚未允许读取 x.com';
  return '无法确认 X 权限';
}

function vaultLabel(state: XVaultPermissionState): string {
  if (state === 'granted') return 'Vault 已授权';
  if (state === 'prompt') return '保存时需要确认 Vault 权限';
  if (state === 'denied') return 'Vault 权限已拒绝';
  if (state === 'missing') return '保存时选择 Vault';
  return '无法确认 Vault 状态';
}

function outcomeLabel(status: NonNullable<SyncJobItem['outcome']>['status']): string {
  if (status === 'created') return '已新建';
  if (status === 'already_exists') return '已存在';
  if (status === 'skipped') return '已跳过';
  return '写入失败';
}

function classificationLabel(classification: SyncJobItem['classification']): string {
  if (classification === 'new') return '新增';
  if (classification === 'existing') return '已入库';
  if (classification === 'changed') return '内容变化';
  if (classification === 'incomplete') return '提取不完整';
  if (classification === 'error') return '提取错误';
  return '待判断';
}

export default function XSyncPage() {
  const [snapshot, setSnapshot] = useState<XSyncTaskSnapshot>(EMPTY_SNAPSHOT);
  const [mode, setMode] = useState<SyncScanMode>('incremental');
  const [xPermission, setXPermission] = useState<XHostPermissionState>('unavailable');
  const [vaultPermission, setVaultPermission] = useState<XVaultPermissionState>('unavailable');
  const [launchState, setLaunchState] = useState<XSyncLaunchState>('waiting');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const storeRef = useRef<SyncStore | undefined>(undefined);
  const portRef = useRef<chrome.runtime.Port | undefined>(undefined);
  const jobIdRef = useRef<string | undefined>(undefined);
  const launchIntentRef = useRef<XSyncLaunchIntent | undefined>(undefined);
  const pendingCommandsRef = useRef(new Map<string, PendingCommand>());
  const refreshRef = useRef<
    ((jobId?: string, suppressLast?: boolean) => Promise<void>) | undefined
  >(undefined);
  const defaultReviewRef = useRef('');

  const model = useMemo(
    () =>
      deriveXSyncUiModel({
        job: snapshot.job,
        lastJob: snapshot.lastJob,
        items: snapshot.items,
        requestedMode: mode,
        xPermission,
        vaultPermission,
        launchState,
        pendingIntentCount: snapshot.pendingIntentCount,
      }),
    [launchState, mode, snapshot, vaultPermission, xPermission],
  );

  const refresh = async (requestedJobId = jobIdRef.current, suppressLast = false) => {
    const store = storeRef.current;
    if (!store) return;
    const [activeJob, recentJobs] = await Promise.all([
      store.getActiveJob('x'),
      store.listJobs({ source: 'x', limit: 1 }),
    ]);
    const lastJob = recentJobs[0];
    const job = requestedJobId
      ? await store.getJob(requestedJobId)
      : (activeJob ?? (suppressLast ? undefined : lastJob));
    const items = job ? await store.listJobItems(job.id, { limit: 50 }) : [];
    const pendingIntentCount = job
      ? (await store.listWriteIntents({ jobId: job.id, limit: 50 })).length
      : 0;
    if (job) jobIdRef.current = job.id;
    setSnapshot({ job, lastJob, items, pendingIntentCount });
  };
  refreshRef.current = refresh;

  const sendCommand = (request: XSyncUiRequest): Promise<XSyncUiResponse> => {
    const port = portRef.current;
    if (!port) return Promise.reject(new Error('同步通道尚未准备好'));
    return new Promise<XSyncUiResponse>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        pendingCommandsRef.current.delete(request.requestId);
        reject(new Error('同步命令等待超时，进度不会被清除'));
      }, COMMAND_TIMEOUT_MS);
      pendingCommandsRef.current.set(request.requestId, { resolve, reject, timeoutId });
      try {
        port.postMessage(request);
      } catch {
        window.clearTimeout(timeoutId);
        pendingCommandsRef.current.delete(request.requestId);
        reject(new Error('无法发送同步命令'));
      }
    }).then((response) => {
      if (!response.ok) throw commandError(response);
      return response;
    });
  };

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true);
    setErrorMessage('');
    try {
      await action();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '操作未完成');
      await refreshRef.current?.();
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let disposed = false;
    const port = chrome.runtime.connect({ name: X_SYNC_PROTOCOL });
    portRef.current = port;

    const onMessage = (value: unknown) => {
      try {
        const response = parseXSyncUiResponse(value);
        const pending = pendingCommandsRef.current.get(response.requestId);
        if (pending) {
          window.clearTimeout(pending.timeoutId);
          pendingCommandsRef.current.delete(response.requestId);
          pending.resolve(response);
        }
        return;
      } catch {
        // Runtime events use a separate strict schema below.
      }
      try {
        const message = parseXSyncPortMessage(value);
        if ('jobId' in message.event && message.event.jobId) {
          jobIdRef.current = message.event.jobId;
          void refreshRef.current?.(message.event.jobId);
        }
      } catch {
        setErrorMessage('收到无法验证的同步状态，界面已停止自动更新');
      }
    };
    const onDisconnect = () => {
      portRef.current = undefined;
      for (const pending of pendingCommandsRef.current.values()) {
        window.clearTimeout(pending.timeoutId);
        pending.reject(new Error('同步通道已断开，持久化进度仍然保留'));
      }
      pendingCommandsRef.current.clear();
    };
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);

    void (async () => {
      try {
        const store = await openSyncStore();
        if (disposed) {
          store.close();
          return;
        }
        storeRef.current = store;
        const [permissionState, handle, activeJob] = await Promise.all([
          inspectXPermission(),
          getVaultHandle().catch(() => null),
          store.getActiveJob('x'),
        ]);
        setXPermission(permissionState);
        if (handle) {
          const granted = await queryVaultPermission(handle).catch(() => false);
          setVaultPermission(granted ? 'granted' : 'prompt');
        } else {
          setVaultPermission('missing');
        }

        if (activeJob) {
          jobIdRef.current = activeJob.id;
          setMode(activeJob.scanMode);
          setLaunchState('ready');
          await refresh(activeJob.id);
          return;
        }

        const intent = await waitForLaunchIntent().catch(() => undefined);
        if (intent) {
          launchIntentRef.current = intent;
          setLaunchState('ready');
          await refresh(undefined, true);
        } else {
          setLaunchState('expired');
          await refresh();
        }
      } catch {
        setLaunchState('unavailable');
        setErrorMessage('无法安全读取同步状态');
      }
    })();

    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      const raw = changes[X_SYNC_LAUNCH_INTENT_KEY]?.newValue;
      if (areaName !== 'session' || raw === undefined) return;
      try {
        const intent = parseXSyncLaunchIntent(raw);
        const now = Date.now();
        if (now >= intent.expiresAtMs) return;
        launchIntentRef.current = intent;
        jobIdRef.current = undefined;
        defaultReviewRef.current = '';
        setLaunchState('ready');
        setSnapshot((current) => {
          const transition = acceptFreshXSyncLaunchIntent(current, intent, now);
          return transition?.snapshot ?? current;
        });
      } catch {
        setLaunchState('unavailable');
      }
    };
    chrome.storage.onChanged.addListener(onStorageChanged);

    const onPermissionRemoved = () => {
      void inspectXPermission().then(setXPermission);
    };
    chrome.permissions.onRemoved.addListener(onPermissionRemoved);

    return () => {
      disposed = true;
      chrome.storage.onChanged.removeListener(onStorageChanged);
      chrome.permissions.onRemoved.removeListener(onPermissionRemoved);
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
      port.disconnect();
      for (const pending of pendingCommandsRef.current.values()) {
        window.clearTimeout(pending.timeoutId);
        pending.reject(new Error('同步页面已关闭'));
      }
      pendingCommandsRef.current.clear();
      storeRef.current?.close();
      storeRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const job = snapshot.job;
    if (
      busy ||
      !portRef.current ||
      job?.status !== 'ready_for_review' ||
      job.summary.unreviewedCount === 0
    ) {
      return;
    }
    const key = `${job.id}:${job.reviewRevision}`;
    if (defaultReviewRef.current === key) return;
    defaultReviewRef.current = key;
    const selected = snapshot.items
      .filter(
        (item) =>
          item.classification === 'new' &&
          (item.item.completeness === 'complete' || item.item.completeness === 'summary_only'),
      )
      .map((item) => item.sourceItemId)
      .sort();
    void runAction(async () => {
      try {
        await sendCommand({
          protocol: X_SYNC_PROTOCOL,
          type: 'save-selection',
          requestId: newRequestId(),
          jobId: job.id,
          expectedReviewRevision: job.reviewRevision,
          selectedSourceItemIds: selected,
        });
        await refresh(job.id);
      } catch (error) {
        defaultReviewRef.current = '';
        throw error;
      }
    });
  }, [busy, snapshot.items, snapshot.job]);

  const handleRequestPermission = () =>
    runAction(async () => {
      const permissionState = await requestXPermission();
      setXPermission(permissionState);
      if (permissionState !== 'granted') {
        throw new Error(
          permissionState === 'overbroad'
            ? '仍存在旧的全网站权限，请先撤销后再单独允许 X'
            : snapshot.job
              ? '未重新授予 X 页面权限，任务保持暂停'
              : '未授予 X 页面权限，任务尚未创建',
        );
      }
    });

  const handleRevokePermission = () =>
    runAction(async () => {
      const permissionState = await removeXPermission();
      setXPermission(permissionState);
      if (permissionState !== 'not_granted') throw new Error('X 页面权限未被完整撤销');
    });

  const handleRemoveLegacyBroadPermissions = () =>
    runAction(async () => {
      const permissionState = await removeLegacyBroadPermissions();
      setXPermission(permissionState);
      if (permissionState === 'overbroad') {
        throw new Error('旧的全网站权限仍未撤销');
      }
    });

  const handleStart = () =>
    runAction(async () => {
      const intent = launchIntentRef.current;
      if (!intent || Date.now() >= intent.expiresAtMs) {
        setLaunchState('expired');
        throw new Error('启动已过期，请从 Popup 重新打开同步工作台');
      }
      // Launch intents are one-shot even when start fails after consumption.
      launchIntentRef.current = undefined;
      const response = await sendCommand({
        protocol: X_SYNC_PROTOCOL,
        type: 'start',
        requestId: newRequestId(),
        launchNonce: intent.nonce,
        mode,
      });
      if (!response.ok || response.result.kind !== 'accepted' || !response.result.jobId) {
        throw new Error('同步任务没有成功创建');
      }
      jobIdRef.current = response.result.jobId;
      await refresh(response.result.jobId);
    });

  const handlePrepareNextBatch = () => {
    const job = snapshot.job;
    if (!job || !model.canPrepareNextBatch || busy) return;
    const transition = prepareNextXSyncBatch(job);
    jobIdRef.current = transition.jobId;
    launchIntentRef.current = transition.launchIntent;
    defaultReviewRef.current = transition.defaultReviewKey;
    setErrorMessage('');
    setLaunchState(transition.launchState);
    setSnapshot(transition.snapshot);
  };

  const sendJobCommand = (type: 'pause' | 'resume' | 'finalize' | 'cancel') =>
    runAction(async () => {
      const job = snapshot.job;
      if (!job) throw new Error('没有可操作的同步任务');
      const request: XSyncUiRequest =
        type === 'cancel'
          ? {
              protocol: X_SYNC_PROTOCOL,
              type,
              requestId: newRequestId(),
              jobId: job.id,
              expectedScanRevision: job.scanRevision,
              expectedReviewRevision: job.reviewRevision,
            }
          : {
              protocol: X_SYNC_PROTOCOL,
              type,
              requestId: newRequestId(),
              jobId: job.id,
              expectedScanRevision: job.scanRevision,
            };
      await sendCommand(request);
      await refresh(job.id);
    });

  const saveSelection = (sourceItemId: string, checked: boolean) =>
    runAction(async () => {
      const job = snapshot.job;
      if (!job || job.status !== 'ready_for_review') return;
      const selected = new Set(model.selectedSourceItemIds);
      if (checked) selected.add(sourceItemId);
      else selected.delete(sourceItemId);
      await sendCommand({
        protocol: X_SYNC_PROTOCOL,
        type: 'save-selection',
        requestId: newRequestId(),
        jobId: job.id,
        expectedReviewRevision: job.reviewRevision,
        selectedSourceItemIds: [...selected].sort(),
      });
      await refresh(job.id);
    });

  const acquireVault = async (): Promise<FileSystemDirectoryHandle> => {
    let handle = await getVaultHandle();
    if (!handle) handle = await requestVaultAccess();
    const granted = await checkVaultPermission(handle);
    setVaultPermission(granted ? 'granted' : 'denied');
    if (!granted) throw new Error('未授予 Vault 写入权限，复核选择没有改变');
    return handle;
  };

  const writeAuthorizedItems = async (
    handle: FileSystemDirectoryHandle,
    jobId: string,
  ): Promise<void> => {
    const store = storeRef.current;
    if (!store) throw new Error('同步数据库尚未准备好');
    const engine = createVaultSyncEngine(store, handle);
    await engine.reconcilePendingIntents(jobId);
    const items = await store.listJobItems(jobId, { limit: 50 });
    for (const item of items.filter((entry) => entry.reviewDecision === 'selected')) {
      if (!(await queryVaultPermission(handle))) {
        const current = await store.getJob(jobId);
        if (current?.status === 'writing') {
          await store.pauseJobWithStopRecord(
            current.id,
            current.scanRevision,
            'permission_revoked',
            'writing',
          );
        }
        setVaultPermission('denied');
        await refresh(jobId);
        return;
      }
      await engine.writeItem(jobId, item.item, VAULT_PREFIX);
      await refresh(jobId);
    }
    const current = await store.getJob(jobId);
    const pending = await store.listWriteIntents({ jobId, limit: 50 });
    if (
      current?.status === 'writing' &&
      current.summary.writePendingCount === 0 &&
      pending.length === 0
    ) {
      const nextStatus =
        current.summary.classificationErrorCount + current.summary.writeErrorCount > 0
          ? 'partial'
          : 'complete';
      await store.transitionJob(current.id, nextStatus);
    }
    await refresh(jobId);
  };

  const handleReviewPrimary = () =>
    runAction(async () => {
      const job = snapshot.job;
      if (!job || job.status !== 'ready_for_review') return;
      if (model.selectedSourceItemIds.length === 0) {
        await sendCommand({
          protocol: X_SYNC_PROTOCOL,
          type: 'complete-without-writes',
          requestId: newRequestId(),
          jobId: job.id,
          expectedReviewRevision: job.reviewRevision,
        });
        await refresh(job.id);
        return;
      }
      const handle = await acquireVault();
      await sendCommand({
        protocol: X_SYNC_PROTOCOL,
        type: 'authorize',
        requestId: newRequestId(),
        jobId: job.id,
        expectedReviewRevision: job.reviewRevision,
        selectedSourceItemIds: model.selectedSourceItemIds,
      });
      await writeAuthorizedItems(handle, job.id);
    });

  const handleContinueWriting = () =>
    runAction(async () => {
      const job = snapshot.job;
      if (!job) return;
      const handle = await acquireVault();
      if (
        job.status === 'partial' ||
        (job.status === 'paused' && job.stopRecord?.phase === 'writing')
      ) {
        await sendCommand({
          protocol: X_SYNC_PROTOCOL,
          type: 'authorize',
          requestId: newRequestId(),
          jobId: job.id,
          expectedReviewRevision: job.reviewRevision,
          selectedSourceItemIds: model.selectedSourceItemIds,
        });
      }
      await writeAuthorizedItems(handle, job.id);
    });

  const toneClass =
    model.tone === 'success'
      ? 'border-primary/25 bg-primary/10'
      : model.tone === 'danger'
        ? 'border-destructive/30 bg-destructive/10'
        : model.tone === 'warning'
          ? 'border-accent/30 bg-accent-soft'
          : 'border-border bg-muted/40';

  return (
    <div className="h-full overflow-y-auto pb-4">
      {model.canPrepareNextBatch ? (
        <Button
          className="mb-3"
          disabled={busy}
          onClick={handlePrepareNextBatch}
          size="sm"
          variant="ghost"
        >
          <ArrowLeft className="h-4 w-4" /> 返回同步入口
        </Button>
      ) : null}

      <div className={`rounded-md border p-3 ${toneClass}`} role="status">
        <h2 className="text-sm font-semibold">{model.headline}</h2>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{model.description}</p>
      </div>

      {errorMessage ? (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-[13px] text-destructive">
          {errorMessage}
        </div>
      ) : null}

      {xPermission === 'overbroad' ? (
        <div className="mt-3 space-y-2 rounded-md border border-border bg-muted/40 p-3 text-[13px]">
          <p>
            旧版链接体检曾申请全网站访问。为确保 X
            权限可单独撤销，请先收回该权限；这不会删除书签或已保存内容。
          </p>
          <Button
            className="w-full"
            disabled={busy}
            onClick={handleRemoveLegacyBroadPermissions}
            variant="outline"
          >
            <Ban className="h-4 w-4" />
            撤销旧的全网站权限
          </Button>
        </div>
      ) : null}

      {model.phase === 'preflight' ? (
        <section className="mt-4 space-y-4" aria-labelledby="x-sync-preflight-title">
          <div>
            <h3 className="text-sm font-semibold" id="x-sync-preflight-title">
              同步范围
            </h3>
            <div className="mt-2 grid grid-cols-2 rounded-md border border-border p-1">
              <button
                aria-pressed={mode === 'incremental'}
                className={`min-h-9 rounded px-2 text-[13px] ${mode === 'incremental' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                disabled={Boolean(snapshot.job) || busy}
                onClick={() => setMode('incremental')}
                type="button"
              >
                检查新增收藏
              </button>
              <button
                aria-pressed={mode === 'backfill'}
                className={`min-h-9 rounded px-2 text-[13px] ${mode === 'backfill' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                disabled={Boolean(snapshot.job) || busy}
                onClick={() => setMode('backfill')}
                type="button"
              >
                导入更早收藏
              </button>
            </div>
          </div>

          <dl className="divide-y divide-border rounded-md border border-border text-[13px]">
            <div className="flex items-center justify-between gap-3 p-3">
              <dt className="text-muted-foreground">X 页面权限</dt>
              <dd>{permissionLabel(xPermission)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 p-3">
              <dt className="text-muted-foreground">Obsidian Vault</dt>
              <dd>{vaultLabel(vaultPermission)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 p-3">
              <dt className="text-muted-foreground">本批候选上限</dt>
              <dd>{model.candidateLimit} 条</dd>
            </div>
          </dl>

          <p className="text-xs leading-5 text-muted-foreground">
            只读取当前打开的 X 收藏页，不读取 Cookie、token、其它标签页，也不会在复核前写入 Vault。
          </p>

          {!snapshot.job && launchState === 'waiting' ? (
            <p className="rounded-md border border-border bg-muted/40 p-3 text-[13px] leading-5 text-muted-foreground">
              点击浏览器工具栏中的
              ShuHai，再选择“同步新增收藏”。本侧边栏会自动进入下一批，不需要关闭或重载扩展。
            </p>
          ) : null}

          {model.canRequestXPermission ? (
            <Button className="w-full" loading={busy} onClick={handleRequestPermission}>
              <ShieldCheck className="h-4 w-4" />
              {snapshot.job ? '重新允许读取 X 收藏页' : '允许读取 X 收藏页'}
            </Button>
          ) : model.canStart ? (
            <Button className="w-full" loading={busy} onClick={handleStart}>
              <Play className="h-4 w-4" />
              开始{mode === 'incremental' ? '检查新增收藏' : '导入更早收藏'}
            </Button>
          ) : snapshot.job?.status === 'prepared' && model.canResume ? (
            <Button
              className="w-full"
              disabled={busy || xPermission !== 'granted'}
              onClick={() => sendJobCommand('resume')}
            >
              <Play className="h-4 w-4" /> 继续启动扫描
            </Button>
          ) : null}
          {snapshot.job?.status === 'prepared' && model.canCancel ? (
            <Button
              className="w-full"
              disabled={busy}
              onClick={() => sendJobCommand('cancel')}
              variant="ghost"
            >
              取消本次任务
            </Button>
          ) : null}
          {model.canRevokeXPermission ? (
            <Button
              className="w-full"
              disabled={busy}
              onClick={handleRevokePermission}
              variant="outline"
            >
              <Ban className="h-4 w-4" />
              撤销 X 访问权限
            </Button>
          ) : null}
        </section>
      ) : null}

      {model.phase === 'scanning' ? (
        <section className="mt-4 space-y-4" aria-labelledby="x-sync-scan-title">
          <div>
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <h3 className="font-semibold" id="x-sync-scan-title">
                扫描进度
              </h3>
              <span className="tabular-nums">
                {model.candidateCount}/{model.candidateLimit} 条候选
              </span>
            </div>
            <Progress className="mt-2" value={model.progressPercent} />
            <p className="mt-2 text-xs text-muted-foreground">
              已跳过的已入库观察：{model.counts.existingObservations}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {model.canRequestXPermission ? (
              <Button disabled={busy} onClick={handleRequestPermission}>
                <ShieldCheck className="h-4 w-4" /> 重新允许读取 X 收藏页
              </Button>
            ) : null}
            {model.canPause ? (
              <Button disabled={busy} onClick={() => sendJobCommand('pause')} variant="outline">
                <Pause className="h-4 w-4" /> 暂停
              </Button>
            ) : null}
            {model.canResume ? (
              <Button
                disabled={busy || xPermission !== 'granted'}
                onClick={() => sendJobCommand('resume')}
              >
                <Play className="h-4 w-4" /> 继续扫描
              </Button>
            ) : null}
            {model.canFinalizeBatch ? (
              <Button
                disabled={busy}
                onClick={() => sendJobCommand('finalize')}
                variant="secondary"
              >
                使用本批结果
              </Button>
            ) : null}
            {model.canCancel ? (
              <Button disabled={busy} onClick={() => sendJobCommand('cancel')} variant="ghost">
                <Ban className="h-4 w-4" /> 取消本次任务
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      {model.phase === 'review' ? (
        <section className="mt-4 space-y-4" aria-labelledby="x-sync-review-title">
          <div>
            <h3 className="text-sm font-semibold" id="x-sync-review-title">
              复核本批内容
            </h3>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              <span>新增 {model.counts.new}</span>
              <span>已入库观察 {model.counts.existingObservations}</span>
              <span>内容变化 {model.counts.changed}</span>
              <span>不完整 {model.counts.incomplete}</span>
              <span>提取错误 {model.counts.error}</span>
              <span>摘要内容 {model.counts.summaryOnly}</span>
            </div>
          </div>
          <div className="divide-y divide-border rounded-md border border-border">
            {snapshot.items.length === 0 ? (
              <p className="p-4 text-[13px] text-muted-foreground">本批没有需要写入的新内容。</p>
            ) : (
              snapshot.items.map((item) => {
                const selectable = model.selectableSourceItemIds.includes(item.sourceItemId);
                const checked = model.selectedSourceItemIds.includes(item.sourceItemId);
                return (
                  <label className="flex gap-3 p-3" key={item.sourceItemId}>
                    <Checkbox
                      checked={checked}
                      disabled={!selectable || busy || !model.selectionIsPersisted}
                      onCheckedChange={(value) => saveSelection(item.sourceItemId, value === true)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-[13px] font-medium">
                        {item.item.title || '未命名收藏'}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {classificationLabel(item.classification)} ·{' '}
                        {item.item.completeness === 'summary_only'
                          ? '列表摘要'
                          : item.item.completeness}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
          <Button
            className="w-full"
            disabled={busy || !model.selectionIsPersisted}
            loading={busy}
            onClick={handleReviewPrimary}
          >
            <CheckCircle2 className="h-4 w-4" />
            {model.primaryReviewLabel}
          </Button>
          {model.canCancel ? (
            <Button
              className="w-full"
              disabled={busy}
              onClick={() => sendJobCommand('cancel')}
              variant="ghost"
            >
              取消本次任务
            </Button>
          ) : null}
        </section>
      ) : null}

      {model.phase === 'writing' ? (
        <section className="mt-4 space-y-4" aria-labelledby="x-sync-writing-title">
          <div>
            <h3 className="text-sm font-semibold" id="x-sync-writing-title">
              逐条写入 Vault
            </h3>
            <p className="mt-1 text-[13px] text-muted-foreground">
              已新建 {snapshot.job?.summary.createdCount ?? 0}，待处理{' '}
              {snapshot.job?.summary.writePendingCount ?? 0}。
            </p>
          </div>
          {model.canContinueWriting ? (
            <Button className="w-full" loading={busy} onClick={handleContinueWriting}>
              <RefreshCw className="h-4 w-4" />
              {snapshot.job?.status === 'paused' ? '重新授权并继续' : '继续写入'}
            </Button>
          ) : null}
          {model.canAbandonWriting ? (
            <Button
              className="w-full"
              disabled={busy}
              onClick={() => sendJobCommand('cancel')}
              variant="outline"
            >
              停止本次任务并保留已有结果
            </Button>
          ) : null}
        </section>
      ) : null}

      {model.phase === 'result' ? (
        <section className="mt-4 space-y-4" aria-labelledby="x-sync-result-title">
          <h3 className="text-sm font-semibold" id="x-sync-result-title">
            逐项结果
          </h3>
          {model.resultRows.length > 0 ? (
            <div className="divide-y divide-border rounded-md border border-border">
              {model.resultRows.map((row) => (
                <div className="p-3" key={`${row.sourceItemId}:${row.relativePath}`}>
                  <div className="flex items-center justify-between gap-3 text-[13px]">
                    <span>{outcomeLabel(row.status)}</span>
                    <span className="text-xs text-muted-foreground">{row.status}</span>
                  </div>
                  <p className="mt-1 break-all text-xs text-muted-foreground">{row.relativePath}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-md border border-border p-4 text-[13px] text-muted-foreground">
              本次没有产生 Vault 文件结果。
            </p>
          )}
          {model.canRetryWrites ? (
            <Button className="w-full" loading={busy} onClick={handleContinueWriting}>
              <RefreshCw className="h-4 w-4" /> 重试失败项
            </Button>
          ) : null}
          {model.canAbandonWriting ? (
            <Button
              className="w-full"
              disabled={busy}
              onClick={() => sendJobCommand('cancel')}
              variant="outline"
            >
              停止本次任务并保留已有结果
            </Button>
          ) : null}
          {model.canRevokeXPermission ? (
            <Button
              className="w-full"
              disabled={busy}
              onClick={handleRevokePermission}
              variant="outline"
            >
              <Ban className="h-4 w-4" /> 撤销 X 访问权限
            </Button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
