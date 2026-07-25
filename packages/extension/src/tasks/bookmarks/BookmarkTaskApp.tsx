import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookmarkCheck, History, RefreshCw, ShieldAlert } from 'lucide-react';

import { inspectAiClassificationCandidates } from '../../shared/ai-classifier.js';
import { providerPermission, providerTemplate } from '../../shared/ai-providers.js';
import type {
  AiProviderConfig,
  AiProviderType,
  BookmarkOperation,
  BookmarkTaskSettings,
  ClassificationMode,
  ClassificationPlan,
  ClassificationProgress,
  MovePlan,
} from '../../shared/bookmark-types.js';
import { Alert } from '../../components/ui/alert.js';
import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { SurfaceLoading } from '../../shell/SurfaceLoading.js';
import { TaskHeader } from '../../shell/TaskHeader.js';
import BookmarkOrganizePage from './BookmarkOrganizePage.js';
import BookmarkRecoveryPage from './BookmarkRecoveryPage.js';
import {
  createBookmarkOperationRequestId,
  getBookmarkTaskSnapshot,
  getRecentBookmarkOperations,
  readBookmarkOperationEvent,
  requestOptionalOrigin,
  runBookmarkOperation,
  startClassificationSession,
  type BookmarkTaskSnapshot,
  type ClassificationSession,
} from './bookmark-task-client.js';
import {
  acquireClassificationStart,
  canExitBookmarkTask,
  operationCanCancel,
  operationRestorableCount,
  operationUnresolvedCount,
  releaseClassificationStart,
  replacePlanMove,
  selectedPlanMoves,
  upsertBookmarkOperation,
  type BookmarkTaskActivity,
  type BookmarkTaskView,
} from './bookmark-task-model.js';

interface BookmarkTaskAppProps {
  readonly onExit: () => void;
}

type LoadState = 'loading' | 'ready' | 'failed';
type Notice = {
  readonly tone: 'default' | 'warning' | 'destructive' | 'success';
  readonly message: string;
};

function activeProvider(settings: BookmarkTaskSettings): AiProviderConfig | undefined {
  return settings.aiProviders.find(
    (provider) =>
      provider.id === settings.activeProviderId && provider.enabled && provider.hasApiKey,
  );
}

export function requestAiConsent(
  provider: AiProviderConfig,
  candidateCount: number,
): Promise<{ ai?: { provider: AiProviderType; confirmed: true }; permissionDenied: boolean }> {
  if (!Number.isSafeInteger(candidateCount) || candidateCount <= 0) {
    return Promise.resolve({ permissionDenied: false });
  }
  const template = providerTemplate(provider.provider);
  const confirmed = window.confirm(
    [
      `AI Provider: ${provider.name} (${template.origin})`,
      `本次候选数量: ${candidateCount}`,
      '将发送: 受限标题、网站 hostname、已有目标目录标签',
      '不会发送: 完整 URL、query、正文、书签树、Vault、Cookie/token 或 API Key',
      '',
      '是否同意本次使用 AI？取消后仍会使用本地规则。',
    ].join('\n'),
  );
  if (!confirmed) {
    return Promise.resolve({ permissionDenied: false });
  }
  return requestOptionalOrigin(providerPermission(provider.provider)).then((granted) =>
    granted
      ? {
          ai: { provider: provider.provider, confirmed: true as const },
          permissionDenied: false,
        }
      : { permissionDenied: true },
  );
}

function safeFailureMessage(error: unknown): string {
  const errorCode =
    error && typeof error === 'object' && 'errorCode' in error
      ? String((error as { errorCode?: unknown }).errorCode ?? '')
      : '';
  if (errorCode === 'classification_cancelled') {
    return '本次书签分析已取消，没有修改 Chrome 书签。';
  }
  if (errorCode === 'permission_denied') {
    return '未获得本次 AI 服务权限，仍可使用本地规则。';
  }
  return '任务未完成。没有确认的书签更改不会被应用。';
}

export default function BookmarkTaskApp({ onExit }: BookmarkTaskAppProps) {
  const [snapshot, setSnapshot] = useState<BookmarkTaskSnapshot>();
  const [snapshotState, setSnapshotState] = useState<LoadState>('loading');
  const [operations, setOperations] = useState<BookmarkOperation[]>([]);
  const [operationsState, setOperationsState] = useState<LoadState>('loading');
  const [view, setView] = useState<BookmarkTaskView>('bookmarks');
  const [activity, setActivity] = useState<BookmarkTaskActivity>('idle');
  const [classifyMode, setClassifyMode] = useState<ClassificationMode>('safe');
  const [plan, setPlan] = useState<ClassificationPlan>();
  const [classificationProgress, setClassificationProgress] = useState<ClassificationProgress>();
  const [selectedOperationId, setSelectedOperationId] = useState<string>();
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const classificationSessionRef = useRef<ClassificationSession | undefined>(undefined);
  const classificationStartPendingRef = useRef(false);
  const mountedRef = useRef(true);
  const initialSettingsAppliedRef = useRef(false);

  const journalBusy = operations.some(operationCanCancel);
  const exitAllowed = canExitBookmarkTask(activity, confirmApplyOpen) && !journalBusy;
  const busy = activity !== 'idle';
  const selectedMoves = useMemo(() => selectedPlanMoves(plan), [plan]);

  const loadSnapshot = useCallback(async () => {
    setSnapshotState('loading');
    try {
      const next = await getBookmarkTaskSnapshot();
      if (!mountedRef.current) return;
      setSnapshot(next);
      setSnapshotState('ready');
      if (!initialSettingsAppliedRef.current) {
        setClassifyMode(next.settings.defaultClassifyMode);
        initialSettingsAppliedRef.current = true;
      }
    } catch {
      if (!mountedRef.current) return;
      setSnapshot(undefined);
      setSnapshotState('failed');
    }
  }, []);

  const loadOperations = useCallback(async () => {
    setOperationsState('loading');
    try {
      const next = await getRecentBookmarkOperations();
      if (!mountedRef.current) return;
      setOperations(next);
      setOperationsState('ready');
      setSelectedOperationId((current) => current ?? next[0]?.id);
    } catch {
      if (!mountedRef.current) return;
      setOperationsState('failed');
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadSnapshot();
    void loadOperations();
    return () => {
      mountedRef.current = false;
      classificationSessionRef.current?.dispose();
      classificationSessionRef.current = undefined;
    };
  }, [loadOperations, loadSnapshot]);

  useEffect(() => {
    const listener = (message: unknown, sender: chrome.runtime.MessageSender) => {
      const operation = readBookmarkOperationEvent(message, sender);
      if (!operation) return;
      setOperations((current) => upsertBookmarkOperation(current, operation));
      setSelectedOperationId((current) => current ?? operation.id);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (confirmApplyOpen) {
        event.preventDefault();
        setConfirmApplyOpen(false);
        return;
      }
      if (exitAllowed) {
        event.preventDefault();
        onExit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmApplyOpen, exitAllowed, onExit]);

  const createPlan = async () => {
    if (!snapshot || busy || !acquireClassificationStart(classificationStartPendingRef)) return;
    setActivity('authorizing');
    setNotice(undefined);

    try {
      let ai: { provider: AiProviderType; confirmed: true } | undefined;
      const provider = activeProvider(snapshot.settings);
      if (snapshot.settings.useAi && provider) {
        const inspection = inspectAiClassificationCandidates(
          snapshot.bookmarks,
          snapshot.settings,
          {
            mode: classifyMode,
            folders: snapshot.folders,
          },
        );
        if (inspection.errorCode === 'request_invalid') {
          setNotice({
            tone: 'warning',
            message: 'AI 目标目录超过安全上限，本次将只使用本地规则。',
          });
        } else {
          const consent = await requestAiConsent(provider, inspection.count);
          if (!mountedRef.current) return;
          ai = consent.ai;
          if (consent.permissionDenied) {
            setNotice({
              tone: 'warning',
              message: '未获得 AI 服务权限，本次将只使用本地规则。',
            });
          }
        }
      }

      if (!mountedRef.current) return;
      setActivity('classifying');
      setClassificationProgress({
        batch: 0,
        done: 0,
        elapsedMs: 0,
        total: snapshot.bookmarks.length,
        totalBatches: 0,
      });

      const session = startClassificationSession({
        ai,
        mode: classifyMode,
        onProgress: setClassificationProgress,
      });
      classificationSessionRef.current = session;
      const nextPlan = await session.result;
      if (!mountedRef.current) return;
      setPlan(nextPlan);
      setNotice({
        tone: nextPlan.moves.length > 0 ? 'success' : 'default',
        message:
          nextPlan.moves.length > 0
            ? `已生成 ${nextPlan.moves.length} 条建议；确认应用前不会修改真实书签。`
            : '没有发现需要移动的书签。',
      });
    } catch (error) {
      if (!mountedRef.current) return;
      setNotice({ tone: 'warning', message: safeFailureMessage(error) });
    } finally {
      releaseClassificationStart(classificationStartPendingRef);
      if (mountedRef.current) {
        classificationSessionRef.current = undefined;
        setClassificationProgress(undefined);
        setActivity('idle');
      }
    }
  };

  const cancelClassification = () => {
    if (classificationSessionRef.current?.cancel()) {
      setNotice({ tone: 'warning', message: '正在安全停止本次分析…' });
    }
  };

  const runMutation = async (
    action: () => Promise<{ operation: BookmarkOperation }>,
    successMessage: (operation: BookmarkOperation) => string,
  ) => {
    setActivity('mutating');
    setNotice(undefined);
    try {
      const { operation } = await action();
      if (!mountedRef.current) return;
      setOperations((current) => upsertBookmarkOperation(current, operation));
      setSelectedOperationId(operation.id);
      setView('recovery');
      setNotice({
        tone:
          operation.status === 'complete' || operation.status === 'restored'
            ? 'success'
            : 'warning',
        message: successMessage(operation),
      });
      await loadSnapshot();
    } catch (error) {
      if (!mountedRef.current) return;
      setNotice({ tone: 'destructive', message: safeFailureMessage(error) });
      await loadOperations();
    } finally {
      if (mountedRef.current) setActivity('idle');
    }
  };

  const applyPlan = async () => {
    if (!plan || selectedMoves.length === 0) return;
    setConfirmApplyOpen(false);
    await runMutation(
      () =>
        runBookmarkOperation({
          type: 'bookmarkOperations:move',
          requestId: createBookmarkOperationRequestId(),
          moves: selectedMoves.map((move) => ({
            bookmarkId: move.bookmarkId,
            targetFolder: move.targetFolder,
          })),
        }),
      (operation) =>
        `整理结果：成功 ${operation.summary.succeeded}，失败 ${operation.summary.failed}，冲突 ${operation.summary.executionConflicts}，跳过 ${operation.summary.skipped}。`,
    );
    if (mountedRef.current) setPlan(undefined);
  };

  const restoreOperation = (operation: BookmarkOperation) => {
    const count = operationRestorableCount(operation);
    if (
      count === 0 ||
      !window.confirm(
        `恢复这次操作中的 ${count} 个成功变更吗？\n\n如果书签后来被修改，ShuHai 会保留当前状态并记录冲突。`,
      )
    ) {
      return;
    }
    void runMutation(
      () =>
        runBookmarkOperation({
          type: 'bookmarkOperations:restore',
          requestId: createBookmarkOperationRequestId(),
          operationId: operation.id,
        }),
      (restored) =>
        `恢复结果：成功 ${restored.summary.restored}，失败 ${restored.summary.restoreFailed}，冲突 ${restored.summary.restoreConflicts}。`,
    );
  };

  const acceptCurrentState = (operation: BookmarkOperation) => {
    const count = operationUnresolvedCount(operation);
    if (
      count === 0 ||
      !window.confirm(
        `接受 ${count} 个书签的当前状态吗？\n\n接受后 ShuHai 不会再次尝试覆盖这些项目。`,
      )
    ) {
      return;
    }
    void runMutation(
      () =>
        runBookmarkOperation({
          type: 'bookmarkOperations:acceptCurrent',
          requestId: createBookmarkOperationRequestId(),
          operationId: operation.id,
        }),
      (resolved) => `已接受 ${resolved.summary.acceptedCurrent} 个书签的当前状态。`,
    );
  };

  const cancelOperation = (operation: BookmarkOperation) => {
    if (!window.confirm('安全停止这次书签操作吗？已经完成的项目会保留在逐项结果中。')) {
      return;
    }
    void runMutation(
      () =>
        runBookmarkOperation({
          type: 'bookmarkOperations:cancel',
          requestId: createBookmarkOperationRequestId(),
          operationId: operation.id,
        }),
      () => '已发出安全停止请求；逐项结果仍保留在操作记录中。',
    );
  };

  const showFullFailure =
    snapshotState === 'failed' &&
    operationsState !== 'loading' &&
    (operationsState === 'failed' || operations.length === 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0">
        <div className="flex items-start gap-3">
          <Button
            aria-label="返回任务入口"
            disabled={!exitAllowed}
            onClick={onExit}
            size="icon"
            title={exitAllowed ? '返回任务入口' : '当前操作完成或取消后才能返回'}
            variant="ghost"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <TaskHeader
              description="生成建议、逐项复核并确认后，才会修改 Chrome 书签。"
              eyebrow="Chrome 书签"
              title="整理书签"
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 rounded-md border border-border p-1">
          <button
            aria-pressed={view === 'bookmarks'}
            className={
              view === 'bookmarks'
                ? 'flex min-h-9 items-center justify-center gap-2 rounded bg-muted px-3 text-[13px] font-medium text-foreground'
                : 'flex min-h-9 items-center justify-center gap-2 rounded px-3 text-[13px] text-muted-foreground hover:bg-muted/60'
            }
            disabled={busy}
            onClick={() => setView('bookmarks')}
            type="button"
          >
            <BookmarkCheck aria-hidden="true" className="h-4 w-4" />
            书签
          </button>
          <button
            aria-pressed={view === 'recovery'}
            className={
              view === 'recovery'
                ? 'flex min-h-9 items-center justify-center gap-2 rounded bg-muted px-3 text-[13px] font-medium text-foreground'
                : 'flex min-h-9 items-center justify-center gap-2 rounded px-3 text-[13px] text-muted-foreground hover:bg-muted/60'
            }
            disabled={busy}
            onClick={() => setView('recovery')}
            type="button"
          >
            <History aria-hidden="true" className="h-4 w-4" />
            恢复
            {operations.length > 0 ? (
              <span className="rounded bg-background px-1.5 py-0.5 text-[12px] tabular-nums">
                {operations.length}
              </span>
            ) : null}
          </button>
        </div>

        {notice ? (
          <Alert className="mt-3" variant={notice.tone}>
            {notice.message}
          </Alert>
        ) : null}
        {snapshotState === 'failed' && operations.length > 0 ? (
          <Alert className="mt-3" variant="warning">
            当前无法读取书签快照，但操作记录仍可独立查看和恢复。
          </Alert>
        ) : null}
        {operationsState === 'failed' && snapshotState === 'ready' ? (
          <Alert className="mt-3" variant="warning">
            当前无法读取恢复记录；浏览和生成建议仍可使用，但请暂缓应用更改。
          </Alert>
        ) : null}
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        {view === 'bookmarks' && snapshotState === 'loading' ? (
          <SurfaceLoading label="正在读取 Chrome 书签" />
        ) : null}

        {view === 'recovery' && operationsState === 'loading' ? (
          <SurfaceLoading label="正在读取恢复记录" />
        ) : null}

        {showFullFailure ? (
          <div className="flex min-h-[28rem] flex-col justify-center">
            <ShieldAlert aria-hidden="true" className="h-8 w-8 text-destructive" />
            <h2 className="mt-4 text-lg font-semibold">无法读取书签工作区</h2>
            <p className="mt-2 max-w-md text-[13px] leading-5 text-muted-foreground">
              没有修改 Chrome 书签。可以重新读取快照和恢复记录。
            </p>
            <Button
              className="mt-5 self-start"
              onClick={() => {
                void loadSnapshot();
                void loadOperations();
              }}
              variant="outline"
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              重新加载
            </Button>
          </div>
        ) : null}

        {view === 'bookmarks' && snapshot ? (
          <BookmarkOrganizePage
            bookmarks={snapshot.bookmarks}
            busy={busy}
            classificationProgress={classificationProgress}
            classifyMode={classifyMode}
            folders={snapshot.folders}
            mutationBlocked={operationsState === 'failed'}
            onApplyPlan={() => setConfirmApplyOpen(true)}
            onCancelClassification={cancelClassification}
            onClassifyModeChange={setClassifyMode}
            onCreatePlan={() => void createPlan()}
            onDiscardPlan={() => setPlan(undefined)}
            onMoveChange={(move: MovePlan) =>
              setPlan((current) =>
                current
                  ? replacePlanMove(
                      current,
                      move,
                      snapshot.folders.map((folder) => folder.path),
                    )
                  : current,
              )
            }
            onRefresh={() => void loadSnapshot()}
            plan={plan}
          />
        ) : null}

        {view === 'recovery' && operationsState !== 'loading' ? (
          <BookmarkRecoveryPage
            busy={busy}
            onAcceptCurrent={acceptCurrentState}
            onCancel={cancelOperation}
            onRestore={restoreOperation}
            onSelect={setSelectedOperationId}
            operations={operations}
            selectedOperationId={selectedOperationId}
          />
        ) : null}
      </div>

      <Dialog onOpenChange={setConfirmApplyOpen} open={confirmApplyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认移动 {selectedMoves.length} 个书签？</DialogTitle>
            <DialogDescription>
              ShuHai
              将逐项记录结果后再移动书签。失败、跳过或冲突不会被伪装成成功，完成后可在“恢复”中处理。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button disabled={busy} onClick={() => setConfirmApplyOpen(false)} variant="outline">
              继续复核
            </Button>
            <Button disabled={busy || selectedMoves.length === 0} onClick={() => void applyPlan()}>
              确认并应用
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
