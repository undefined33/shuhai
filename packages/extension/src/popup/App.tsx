import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
  Loader2,
  PanelRightOpen,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react';
import type {
  AiProviderConfig,
  AiProviderTestResult,
  AppSettings,
  BackupRecord,
  BookmarkItem,
  BookmarkNode,
  CapturedContent,
  ClassificationPortMessage,
  ClassificationPortRequest,
  ClassificationMode,
  ClassificationPlan,
  ClassificationProgress,
  ExportManifest,
  ExtensionRequest,
  ExtensionResponse,
  ExtensionState,
  FolderItem,
  MovePlan,
  UrlHealthPortMessage,
  UrlHealthPortRequest,
  UrlHealthProgress,
  UrlHealthRecord,
} from '../shared/bookmark-types.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog.js';
import { Progress } from '../components/ui/progress.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.js';
import { Alert } from '../components/ui/alert.js';
import { DEFAULT_SETTINGS, normalizeSettings } from '../utils/storage.js';
import CollectionPage from './pages/CollectionPage.js';
import OrganizePage, { type OrganizeMode } from './pages/OrganizePage.js';
import Settings from './pages/Settings.js';

type Surface = 'popup' | 'sidepanel';
type ViewName = 'organize' | 'collect' | 'settings';
type BusyAction = 'load' | 'plan' | 'apply' | 'undo' | 'settings' | 'health' | undefined;
type Notice = { kind: 'success' | 'warning' | 'error'; message: string } | undefined;

const PREFERRED_VIEW_KEY = 'shuhaiPreferredView';

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function normalizeExtensionState(value: unknown): ExtensionState {
  const state = objectRecord(value);

  return {
    tree: arrayOrEmpty<BookmarkNode>(state.tree),
    bookmarks: arrayOrEmpty<BookmarkItem>(state.bookmarks),
    folders: arrayOrEmpty<FolderItem>(state.folders),
    backups: arrayOrEmpty<BackupRecord>(state.backups),
    exportManifests: arrayOrEmpty<ExportManifest>(state.exportManifests),
    pendingCaptures: arrayOrEmpty<CapturedContent>(state.pendingCaptures),
    urlHealthRecords: arrayOrEmpty<UrlHealthRecord>(state.urlHealthRecords),
    lastMoveRecordCount:
      typeof state.lastMoveRecordCount === 'number' && Number.isFinite(state.lastMoveRecordCount)
        ? state.lastMoveRecordCount
        : 0,
    onboarded: state.onboarded === true,
    settings: normalizeSettings(state.settings),
  };
}

function sendMessage<T>(request: ExtensionRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(request, (response: ExtensionResponse | undefined) => {
      const error = chrome.runtime.lastError?.message;
      if (error) {
        reject(new Error(error));
        return;
      }

      if (!response) {
        reject(new Error('扩展后台没有响应'));
        return;
      }

      if (!response.ok) {
        reject(new Error(response.error));
        return;
      }

      resolve(response.data as T);
    });
  });
}

function selectedMoveIds(plan: ClassificationPlan): string[] {
  return plan.moves.filter((move) => move.selected).map((move) => move.id);
}

function replaceMove(plan: ClassificationPlan, nextMove: MovePlan): ClassificationPlan {
  const moves = plan.moves.map((move) => (move.id === nextMove.id ? nextMove : move));
  const targetFolders = new Set(moves.map((move) => move.targetFolder).filter(Boolean));

  return {
    ...plan,
    moves,
    newFolders: Array.from(targetFolders).sort((a, b) => a.localeCompare(b, 'zh-CN')),
  };
}

function downloadBackup(backup: BackupRecord): void {
  const blob = new Blob([JSON.stringify(backup.tree, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `shuhai-bookmarks-${backup.createdAt.replace(/[:.]/g, '-')}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function applyPlanFolders(bookmarks: BookmarkItem[], plan: ClassificationPlan): BookmarkItem[] {
  const movesByBookmarkId = new Map(plan.moves.map((move) => [move.bookmarkId, move]));

  return bookmarks.map((bookmark) => {
    const move = movesByBookmarkId.get(bookmark.id);
    return move
      ? {
          ...bookmark,
          parentPath: move.targetFolder,
          parentTitle: move.targetFolder.split('/').at(-1) ?? move.targetFolder,
        }
      : bookmark;
  });
}

function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) {
    return '估算中';
  }

  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) {
    return `${seconds} 秒`;
  }

  return `${Math.ceil(seconds / 60)} 分钟`;
}

function healthStatusLabel(status: UrlHealthRecord['status']): string {
  switch (status) {
    case 'alive':
      return '正常';
    case 'redirected':
      return '重定向';
    case 'dead':
      return '死链';
    case 'error':
      return '检查失败';
    case 'skipped':
      return '已跳过';
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

function getCurrentWindowId(): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.windows.getCurrent((currentWindow) => {
      const error = chrome.runtime.lastError?.message;
      if (error) {
        reject(new Error(error));
        return;
      }

      if (typeof currentWindow.id !== 'number') {
        reject(new Error('无法识别当前 Chrome 窗口'));
        return;
      }

      resolve(currentWindow.id);
    });
  });
}

async function openSidePanel(): Promise<void> {
  if (!chrome.sidePanel?.open) {
    throw new Error('当前 Chrome 版本不支持侧边栏，请先使用弹窗模式。');
  }

  const windowId = await getCurrentWindowId();
  await chrome.sidePanel.open({ windowId });
}

function requestHealthCheckPermission(): Promise<boolean> {
  if (!chrome.permissions?.request) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    chrome.permissions.request(
      {
        origins: ['http://*/*', 'https://*/*'],
      },
      (granted) => resolve(Boolean(granted)),
    );
  });
}

function isViewName(value: unknown): value is ViewName {
  return value === 'organize' || value === 'collect' || value === 'settings';
}

function storePreferredView(view: ViewName): Promise<void> {
  if (!chrome.storage?.local) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    chrome.storage.local.set({ [PREFERRED_VIEW_KEY]: view }, () => resolve());
  });
}

function takePreferredView(): Promise<ViewName | undefined> {
  if (!chrome.storage?.local) {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve) => {
    chrome.storage.local.get(PREFERRED_VIEW_KEY, (items) => {
      const preferredView = items[PREFERRED_VIEW_KEY];
      if (isViewName(preferredView)) {
        void chrome.storage.local.remove(PREFERRED_VIEW_KEY);
        resolve(preferredView);
        return;
      }

      resolve(undefined);
    });
  });
}

interface PopupLauncherProps {
  busy: boolean;
  state?: ExtensionState;
  onOpenSidePanel(view: ViewName): void;
  onQuickClassify(): void;
  onQuickHealth(): void;
  onUsePopup(view: ViewName): void;
}

function PopupLauncher({
  busy,
  state,
  onOpenSidePanel,
  onQuickClassify,
  onQuickHealth,
  onUsePopup,
}: PopupLauncherProps) {
  const bookmarkCount = state?.bookmarks?.length ?? 0;
  const folderCount = state?.folders?.length ?? 0;
  const pendingCaptureCount = state?.pendingCaptures?.length ?? 0;

  return (
    <main className="flex h-[600px] flex-col gap-3 bg-background p-3 text-foreground">
      <header className="space-y-1">
        <h1 className="text-base font-semibold tracking-tight">ShuHai</h1>
        <p className="text-xs text-muted-foreground">
          {bookmarkCount} 书签 · {folderCount} 文件夹
        </p>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <PanelRightOpen className="h-4 w-4 text-primary" />
            打开工作区
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <Button disabled={busy} onClick={() => onOpenSidePanel('organize')} variant="outline">
            <Sparkles className="h-4 w-4" />
            整理书签
          </Button>
          <Button disabled={busy} onClick={() => onOpenSidePanel('collect')} variant="outline">
            <BookOpen className="h-4 w-4" />
            收藏内容
            {pendingCaptureCount > 0 ? <Badge variant="success">{pendingCaptureCount}</Badge> : null}
          </Button>
          <Button disabled={busy} onClick={() => onOpenSidePanel('settings')} variant="outline">
            <SettingsIcon className="h-4 w-4" />
            设置
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>快捷操作</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2">
          <Button disabled={busy || bookmarkCount === 0} onClick={onQuickClassify} variant="secondary">
            <Sparkles className="h-4 w-4" />
            AI 分类
          </Button>
          <Button disabled={busy || bookmarkCount === 0} onClick={onQuickHealth} variant="secondary">
            <Activity className="h-4 w-4" />
            体检链接
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">AI 分类</span>
            <Badge variant={state?.settings?.useAi ? 'success' : 'warning'}>
              {state?.settings?.useAi ? '已启用' : '规则模式'}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">待保存内容</span>
            <Badge variant={pendingCaptureCount > 0 ? 'success' : 'outline'}>
              {pendingCaptureCount}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="mt-auto">
        <Button
          className="w-full"
          disabled={busy}
          onClick={() => onUsePopup('organize')}
          variant="ghost"
        >
          继续用弹窗
        </Button>
      </div>
    </main>
  );
}

interface ProgressPanelProps {
  progress?: ClassificationProgress;
  onCancel(): void;
}

function ProgressPanel({ progress, onCancel }: ProgressPanelProps) {
  const total = progress?.total ?? 0;
  const done = progress?.done ?? 0;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="mt-3 rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium">AI 正在分析你的书签</p>
          <p className="text-[11px] text-muted-foreground">
            {done}/{total} ({percent}%) · 批次 {progress?.batch ?? 0}/
            {progress?.totalBatches ?? 0} · 预计剩余 {formatDuration(progress?.remainingMs)}
          </p>
        </div>
        <Button onClick={onCancel} size="sm" variant="outline">
          取消
        </Button>
      </div>
      <Progress value={percent} />
    </div>
  );
}

interface WelcomeGuideProps {
  open: boolean;
  onStart(): void;
  onOpenHelp(): void;
}

function WelcomeGuide({ open, onStart, onOpenHelp }: WelcomeGuideProps) {
  return (
    <Dialog open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>欢迎使用 ShuHai</DialogTitle>
          <DialogDescription>
            ShuHai 帮你整理 Chrome 书签，并把值得沉淀的内容写入 Obsidian。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <Card>
            <CardContent className="p-3">
              <div className="font-medium">1. 整理书签</div>
              <p className="mt-1 text-xs text-muted-foreground">
                AI 或内置规则会先生成移动方案，确认前不会修改真实书签。
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="font-medium">2. 收藏内容</div>
              <p className="mt-1 text-xs text-muted-foreground">
                在网页右键保存文章、推文或微博，到“收藏内容”确认后写入 Vault。
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="font-medium">3. 设置知识库</div>
              <p className="mt-1 text-xs text-muted-foreground">
                首次选择 Obsidian Vault 目录后，浏览器会记住授权并写入 Markdown。
              </p>
            </CardContent>
          </Card>
        </div>
        <DialogFooter>
          <Button onClick={onOpenHelp} variant="ghost">
            打开设置
          </Button>
          <Button onClick={onStart}>开始使用</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface AppProps {
  surface?: Surface;
}

export default function App({ surface = 'popup' }: AppProps) {
  const [view, setView] = useState<ViewName>('organize');
  const [organizeMode, setOrganizeMode] = useState<OrganizeMode>('browse');
  const [state, setState] = useState<ExtensionState | undefined>();
  const [plan, setPlan] = useState<ClassificationPlan | undefined>();
  const [classifyMode, setClassifyMode] = useState<ClassificationMode>('safe');
  const [busyAction, setBusyAction] = useState<BusyAction>('load');
  const [status, setStatus] = useState('正在读取书签...');
  const [notice, setNotice] = useState<Notice>();
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);
  const [classificationProgress, setClassificationProgress] =
    useState<ClassificationProgress>();
  const [urlHealthProgress, setUrlHealthProgress] = useState<UrlHealthProgress>();
  const [healthChecking, setHealthChecking] = useState(false);
  const [forcePopupWorkspace, setForcePopupWorkspace] = useState(false);
  const classificationPortRef = useRef<chrome.runtime.Port | undefined>(undefined);
  const healthPortRef = useRef<chrome.runtime.Port | undefined>(undefined);
  const previousPendingCaptureCountRef = useRef<number | undefined>(undefined);

  const busy = Boolean(busyAction) || healthChecking;

  useEffect(() => {
    if (notice?.kind !== 'success') {
      return undefined;
    }

    const timer = window.setTimeout(() => setNotice(undefined), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const showError = (error: unknown) => {
    setNotice({
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  };

  const setHealthRecords = (records: UrlHealthRecord[]) => {
    setState((current) => (current ? { ...current, urlHealthRecords: records } : current));
  };

  const loadState = async () => {
    setBusyAction('load');
    setNotice(undefined);
    try {
      const nextState = normalizeExtensionState(await sendMessage<unknown>({ type: 'state:get' }));
      setState(nextState);
      setClassifyMode(nextState.settings.defaultClassifyMode);
      setStatus(`已读取 ${nextState.bookmarks.length} 个书签`);
    } catch (loadError) {
      showError(loadError);
    } finally {
      setBusyAction(undefined);
    }
  };

  useEffect(() => {
    void loadState();
  }, []);

  useEffect(() => {
    void takePreferredView().then((preferredView) => {
      if (preferredView) {
        setView(preferredView);
      }
    });
  }, []);

  useEffect(() => {
    if (!chrome.storage?.onChanged) {
      return undefined;
    }

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local') {
        return;
      }

      const relevantKeys = new Set([
        'exportManifests',
        'lastMoveRecords',
        'onboarded',
        'pendingCapture',
        'settings',
        'urlHealthRecords',
      ]);

      if (Object.keys(changes).some((key) => relevantKeys.has(key))) {
        void loadState();
      }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  useEffect(() => {
    const pendingCount = state?.pendingCaptures?.length ?? 0;
    const previousCount = previousPendingCaptureCountRef.current;
    if (previousCount !== undefined && pendingCount > previousCount) {
      setView('collect');
      setNotice({ kind: 'success', message: '内容已保存到待写入队列。' });
    }
    previousPendingCaptureCountRef.current = pendingCount;
  }, [state?.pendingCaptures?.length]);

  const createPlan = async (mode: ClassificationMode) => {
    setBusyAction('plan');
    setNotice(undefined);
    setView('organize');
    setOrganizeMode('plan');
    setClassifyMode(mode);
    setClassificationProgress({
      done: 0,
      total: bookmarks.length,
      batch: 0,
      totalBatches: 0,
      elapsedMs: 0,
    });
    setStatus(mode === 'full' ? '正在重新审视全部书签...' : '正在生成安全整理方案...');
    try {
      const nextPlan = await createPlanWithProgress(mode);
      setPlan(nextPlan);
      setOrganizeMode('plan');
      setStatus(`生成 ${nextPlan.moves.length} 条移动建议`);
      setNotice({
        kind: nextPlan.moves.length > 0 ? 'success' : 'warning',
        message:
          nextPlan.moves.length > 0
            ? `已生成 ${nextPlan.moves.length} 条建议，应用前不会修改真实书签。`
            : '没有生成移动建议，可以切换整理模式后重试。',
      });
    } catch (planError) {
      showError(planError);
    } finally {
      classificationPortRef.current?.disconnect();
      classificationPortRef.current = undefined;
      setClassificationProgress(undefined);
      setBusyAction(undefined);
    }
  };

  const createPlanWithProgress = (mode: ClassificationMode): Promise<ClassificationPlan> =>
    new Promise((resolve, reject) => {
      if (!chrome.runtime.connect) {
        void sendMessage<ClassificationPlan>({ type: 'plan:create', mode }).then(resolve, reject);
        return;
      }

      const port = chrome.runtime.connect({ name: 'classify' });
      let settled = false;
      classificationPortRef.current = port;

      port.onMessage.addListener((message: ClassificationPortMessage) => {
        if (message.type === 'progress') {
          setClassificationProgress(message.progress);
          setStatus(
            `已分类 ${message.progress.done}/${message.progress.total}，批次 ${message.progress.batch}/${message.progress.totalBatches}`,
          );
          return;
        }

        if (message.type === 'complete') {
          settled = true;
          if (message.cancelled) {
            setNotice({
              kind: 'warning',
              message: `已取消，基于已分析的 ${message.progress.done} 个书签生成部分方案。`,
            });
          }
          resolve(message.plan);
          return;
        }

        if (message.type === 'error') {
          settled = true;
          reject(new Error(message.error));
        }
      });

      port.onDisconnect.addListener(() => {
        if (!settled && chrome.runtime.lastError?.message) {
          reject(new Error(chrome.runtime.lastError.message));
        }
      });

      port.postMessage({ type: 'plan:create', mode } satisfies ClassificationPortRequest);
    });

  const cancelClassification = () => {
    classificationPortRef.current?.postMessage({ type: 'cancel' } satisfies ClassificationPortRequest);
    setStatus('正在取消，本批次结束后会生成部分方案...');
  };

  const startHealthCheck = async () => {
    setNotice(undefined);
    setUrlHealthProgress(undefined);
    setView('organize');
    setOrganizeMode('health');

    try {
      const granted = await requestHealthCheckPermission();
      if (!granted) {
        setNotice({
          kind: 'warning',
          message: '链接体检需要临时访问书签中的 http/https 地址，未授权时不会发起检测。',
        });
        return;
      }

      if (!chrome.runtime.connect) {
        throw new Error('当前扩展环境不支持长任务连接');
      }

      healthPortRef.current?.disconnect();
      const port = chrome.runtime.connect({ name: 'health' });
      let settled = false;
      healthPortRef.current = port;
      setHealthChecking(true);
      setStatus('正在体检书签链接...');

      port.onMessage.addListener((message: UrlHealthPortMessage) => {
        if (message.type === 'progress') {
          setUrlHealthProgress(message.progress);
          setHealthRecords(message.records);
          setStatus(`链接体检 ${message.progress.done}/${message.progress.total}`);
          return;
        }

        if (message.type === 'complete') {
          settled = true;
          setUrlHealthProgress(message.progress);
          setHealthRecords(message.records);
          setHealthChecking(false);
          healthPortRef.current = undefined;
          void loadState();
          setNotice({
            kind: message.progress.summary.dead + message.progress.summary.error > 0 ? 'warning' : 'success',
            message: message.cancelled
              ? `已暂停：本次已保留 ${message.progress.done} 条体检结果。`
              : `体检完成：死链 ${message.progress.summary.dead}，错误 ${message.progress.summary.error}，重定向 ${message.progress.summary.redirected}`,
          });
          setStatus(message.cancelled ? '链接体检已暂停' : '链接体检完成');
          return;
        }

        if (message.type === 'error') {
          settled = true;
          setHealthChecking(false);
          healthPortRef.current = undefined;
          showError(new Error(message.error));
        }
      });

      port.onDisconnect.addListener(() => {
        if (!settled) {
          setHealthChecking(false);
          healthPortRef.current = undefined;
        }
      });

      port.postMessage({ type: 'health:check' } satisfies UrlHealthPortRequest);
    } catch (healthError) {
      setHealthChecking(false);
      showError(healthError);
    }
  };

  const cancelHealthCheck = () => {
    healthPortRef.current?.postMessage({ type: 'pause' } satisfies UrlHealthPortRequest);
    setStatus('正在暂停链接体检，已完成结果会保留...');
  };

  const applyPlan = async () => {
    if (!plan) {
      return;
    }

    setBusyAction('apply');
    setNotice(undefined);
    setStatus('正在备份并移动书签...');
    try {
      const result = await sendMessage<{ moved: number; failed: unknown[] }>({
        type: 'plan:apply',
        plan,
        selectedMoveIds: selectedMoveIds(plan),
      });
      setStatus(`已移动 ${result.moved} 个书签，失败 ${result.failed.length} 个`);
      setNotice({
        kind: result.failed.length > 0 ? 'warning' : 'success',
        message: `已移动 ${result.moved} 个书签，失败 ${result.failed.length} 个。`,
      });
      setPlan(undefined);
      setView('organize');
      setOrganizeMode('browse');
      await loadState();
    } catch (applyError) {
      showError(applyError);
    } finally {
      setConfirmApplyOpen(false);
      setBusyAction(undefined);
    }
  };

  const undoLast = async () => {
    setBusyAction('undo');
    setNotice(undefined);
    setStatus('正在撤销上次整理...');
    try {
      const result = await sendMessage<{ undone: number }>({ type: 'plan:undoLast' });
      setStatus(`已撤销 ${result.undone} 个移动操作`);
      setNotice({ kind: 'success', message: `已撤销 ${result.undone} 个移动操作。` });
      await loadState();
    } catch (undoError) {
      showError(undoError);
    } finally {
      setBusyAction(undefined);
    }
  };

  const saveSettings = async (settings: AppSettings) => {
    setBusyAction('settings');
    setNotice(undefined);
    try {
      const saved = await sendMessage<AppSettings>({ type: 'settings:set', settings });
      setState((current) =>
        current
          ? {
              ...current,
              settings: saved,
            }
          : current,
      );
      setClassifyMode(saved.defaultClassifyMode);
      setStatus('设置已保存');
      setNotice({ kind: 'success', message: '设置已保存。' });
    } catch (settingsError) {
      showError(settingsError);
    } finally {
      setBusyAction(undefined);
    }
  };

  const testAiProvider = async (
    provider: AiProviderConfig,
  ): Promise<AiProviderTestResult> =>
    sendMessage<AiProviderTestResult>({ type: 'ai:testConnection', provider });

  const clearPendingCapture = async () => {
    await sendMessage<{ cleared: boolean }>({ type: 'capture:clearPending' });
    await loadState();
  };

  const removePendingCapture = async (id: string) => {
    await sendMessage<{ removed: boolean }>({ type: 'capture:removePending', id });
    await loadState();
  };

  const clearHealthRecords = async () => {
    await sendMessage<{ cleared: boolean }>({ type: 'health:clearRecords' });
    setUrlHealthProgress(undefined);
    await loadState();
  };

  const deleteBookmarksFromHealth = async (records: UrlHealthRecord[]) => {
    if (records.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `确定批量删除 ${records.length} 个 Chrome 书签吗？\n\n删除前会逐条创建备份。`,
    );

    if (!confirmed) {
      return;
    }

    try {
      for (const record of records) {
        await sendMessage<{ deleted: boolean; backupKey: string }>({
          type: 'bookmark:delete',
          id: record.bookmarkId,
        });
      }
      setNotice({ kind: 'success', message: `已删除 ${records.length} 个书签，并已创建备份。` });
      await loadState();
    } catch (deleteError) {
      showError(deleteError);
    }
  };

  const retryHealthRecord = async (record: UrlHealthRecord) => {
    setNotice(undefined);
    try {
      const granted = await requestHealthCheckPermission();
      if (!granted) {
        setNotice({
          kind: 'warning',
          message: '重试检查需要临时访问该书签地址，未授权时不会发起检测。',
        });
        return;
      }

      setBusyAction('health');
      setStatus(`正在重新检查：${record.bookmarkTitle}`);
      const result = await sendMessage<{ record: UrlHealthRecord; records: UrlHealthRecord[] }>({
        type: 'health:retryOne',
        bookmarkId: record.bookmarkId,
      });
      setHealthRecords(result.records);
      setNotice({
        kind: result.record.status === 'alive' ? 'success' : 'warning',
        message: `已重新检查：${healthStatusLabel(result.record.status)}。`,
      });
      setStatus(`已重新检查：${record.bookmarkTitle}`);
    } catch (retryError) {
      showError(retryError);
    } finally {
      setBusyAction(undefined);
    }
  };

  const updateBookmarkUrlFromHealth = async (record: UrlHealthRecord, url: string) => {
    const confirmed = window.confirm(
      `确定替换这个 Chrome 书签的 URL 吗？\n\n${record.bookmarkTitle}\n${url}`,
    );

    if (!confirmed) {
      return;
    }

    try {
      await sendMessage<{ updated: boolean; backupKey: string }>({
        type: 'bookmark:updateUrl',
        id: record.bookmarkId,
        url,
      });
      setNotice({ kind: 'success', message: '已更新书签链接，并已创建备份。' });
      await loadState();
    } catch (updateError) {
      showError(updateError);
    }
  };

  const updateBookmarkUrlsFromHealth = async (records: UrlHealthRecord[]) => {
    const updatableRecords = records.filter((record) => record.status === 'redirected' && record.finalUrl);
    if (updatableRecords.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `确定批量更新 ${updatableRecords.length} 个重定向书签吗？\n\n会把它们替换为检测到的跳转目标，更新前会逐条创建备份。`,
    );

    if (!confirmed) {
      return;
    }

    setBusyAction('health');
    setNotice(undefined);
    try {
      for (const [index, record] of updatableRecords.entries()) {
        setStatus(`正在更新重定向 ${index + 1}/${updatableRecords.length}`);
        await sendMessage<{ updated: boolean; backupKey: string }>({
          type: 'bookmark:updateUrl',
          id: record.bookmarkId,
          url: record.finalUrl ?? record.bookmarkUrl,
        });
      }
      setNotice({
        kind: 'success',
        message: `已更新 ${updatableRecords.length} 个重定向书签，并已创建备份。`,
      });
      await loadState();
    } catch (updateError) {
      showError(updateError);
    } finally {
      setBusyAction(undefined);
    }
  };

  const completeOnboarding = async () => {
    try {
      await sendMessage<{ onboarded: boolean }>({ type: 'onboarding:set', onboarded: true });
      setState((current) => (current ? { ...current, onboarded: true } : current));
    } catch (onboardingError) {
      showError(onboardingError);
    }
  };

  const openHelpFromWelcome = () => {
    setView('settings');
    void completeOnboarding();
  };

  const handleOpenSidePanel = (nextView: ViewName) => {
    void storePreferredView(nextView)
      .then(openSidePanel)
      .then(() => {
        setNotice({ kind: 'success', message: '侧边栏已打开。' });
      })
      .catch((error) => {
        showError(error);
      });
  };

  const usePopupWorkspace = (nextView: ViewName) => {
    setView(nextView);
    setForcePopupWorkspace(true);
  };

  const quickClassifyFromPopup = () => {
    usePopupWorkspace('organize');
    setOrganizeMode('plan');
    void createPlan(classifyMode);
  };

  const quickHealthFromPopup = () => {
    usePopupWorkspace('organize');
    setOrganizeMode('health');
    void startHealthCheck();
  };

  const folders = state?.folders ?? [];
  const backups = state?.backups ?? [];
  const settings = state?.settings ?? DEFAULT_SETTINGS;
  const bookmarks = state?.bookmarks ?? [];
  const exportBookmarks = plan ? applyPlanFolders(bookmarks, plan) : bookmarks;
  const canUndo = (state?.lastMoveRecordCount ?? 0) > 0;
  const selectedCount = useMemo(
    () => plan?.moves.filter((move) => move.selected).length ?? 0,
    [plan],
  );
  const alertVariant =
    notice?.kind === 'error' ? 'destructive' : notice?.kind === 'warning' ? 'warning' : 'success';
  const workspaceClass =
    surface === 'sidepanel' ? 'h-screen' : 'h-[600px]';
  const showWorkspace = surface === 'sidepanel' || forcePopupWorkspace;

  useEffect(() => {
    if (!showWorkspace) {
      return undefined;
    }

    const listener = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        if (
          view === 'organize' &&
          organizeMode === 'plan' &&
          plan &&
          selectedCount > 0 &&
          !busy
        ) {
          event.preventDefault();
          setConfirmApplyOpen(true);
        }
        return;
      }

      if (event.key === 'Escape') {
        if (busyAction === 'plan') {
          event.preventDefault();
          cancelClassification();
          return;
        }

        if (confirmApplyOpen) {
          event.preventDefault();
          setConfirmApplyOpen(false);
          return;
        }

        if (view === 'organize' && organizeMode !== 'browse') {
          event.preventDefault();
          setOrganizeMode('browse');
        }
        return;
      }

      if (event.key === '/') {
        event.preventDefault();
        setView('organize');
        setOrganizeMode('browse');
        window.setTimeout(() => {
          const search = document.querySelector<HTMLInputElement>('[data-shuhai-search]');
          search?.focus();
        }, 0);
      }
    };

    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [
    busy,
    busyAction,
    confirmApplyOpen,
    organizeMode,
    plan,
    selectedCount,
    showWorkspace,
    view,
  ]);

  if (!showWorkspace) {
    return (
      <>
        <PopupLauncher
          busy={busy}
          onOpenSidePanel={handleOpenSidePanel}
          onQuickClassify={quickClassifyFromPopup}
          onQuickHealth={quickHealthFromPopup}
          onUsePopup={usePopupWorkspace}
          state={state}
        />
        <WelcomeGuide
          onOpenHelp={() => {
            setForcePopupWorkspace(true);
            openHelpFromWelcome();
          }}
          onStart={completeOnboarding}
          open={Boolean(state && !state.onboarded)}
        />
      </>
    );
  }

  return (
    <main className={`flex ${workspaceClass} flex-col bg-background text-foreground`}>
      <header className="border-b border-border px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight">ShuHai</h1>
            <p className="truncate text-xs text-muted-foreground">{status}</p>
          </div>
          {busy ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              处理中
            </div>
          ) : null}
        </div>
        {busyAction === 'plan' ? (
          <ProgressPanel onCancel={cancelClassification} progress={classificationProgress} />
        ) : null}
      </header>

      <Tabs
        className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-2"
        onValueChange={(next) => setView(next as ViewName)}
        value={view}
      >
        <TabsList className="grid-cols-3">
          <TabsTrigger value="organize">
            <Sparkles className="h-3.5 w-3.5" />
            整理书签
          </TabsTrigger>
          <TabsTrigger value="collect">
            <BookOpen className="h-3.5 w-3.5" />
            收藏内容
            {(state?.pendingCaptures?.length ?? 0) > 0 ? (
              <Badge variant="success">{state?.pendingCaptures.length}</Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="settings">
            <SettingsIcon className="h-3.5 w-3.5" />
            设置
          </TabsTrigger>
        </TabsList>

        {notice ? (
          <Alert
            className="mt-3"
            onClose={notice.kind === 'success' ? undefined : () => setNotice(undefined)}
            variant={alertVariant}
          >
            {notice.message}
          </Alert>
        ) : null}

        <TabsContent className="min-h-0 flex-1" forceMount value="organize">
          <OrganizePage
            backups={backups}
            bookmarks={bookmarks}
            busy={busy}
            canUndo={canUndo}
            classifying={busyAction === 'plan'}
            classifyMode={classifyMode}
            exportBookmarks={exportBookmarks}
            exportManifests={state?.exportManifests ?? []}
            folders={folders}
            healthChecking={healthChecking}
            healthProgress={urlHealthProgress}
            healthRecords={state?.urlHealthRecords ?? []}
            mode={organizeMode}
            onApplyPlan={() => setConfirmApplyOpen(true)}
            onCancelHealth={cancelHealthCheck}
            onCancelPlan={() => setOrganizeMode('browse')}
            onClassifyModeChange={setClassifyMode}
            onClearHealthRecords={clearHealthRecords}
            onCreatePlan={createPlan}
            onDeleteManyHealthRecords={deleteBookmarksFromHealth}
            onDownloadBackup={downloadBackup}
            onModeChange={setOrganizeMode}
            onMoveChange={(move) =>
              setPlan((current) => (current ? replaceMove(current, move) : current))
            }
            onRefresh={loadState}
            onRetryHealthRecord={retryHealthRecord}
            onStartHealthCheck={startHealthCheck}
            onUndo={undoLast}
            onUpdateHealthUrl={updateBookmarkUrlFromHealth}
            onUpdateManyHealthUrls={updateBookmarkUrlsFromHealth}
            plan={plan}
            selectedCount={selectedCount}
            selectedMoveIds={plan ? selectedMoveIds(plan) : []}
            settings={settings}
            surface={surface}
          />
        </TabsContent>

        <TabsContent className="min-h-0 flex-1" forceMount value="collect">
          <CollectionPage
            exportManifests={state?.exportManifests ?? []}
            onClearPendingCapture={clearPendingCapture}
            onRefresh={loadState}
            onRemovePendingCapture={removePendingCapture}
            pendingCaptures={state?.pendingCaptures ?? []}
            settings={settings}
          />
        </TabsContent>

        <TabsContent className="min-h-0 flex-1" value="settings">
          <Settings
            backups={backups}
            busy={busy}
            exportManifests={state?.exportManifests ?? []}
            onDownloadBackup={downloadBackup}
            onSave={saveSettings}
            onTestProvider={testAiProvider}
            settings={settings}
          />
        </TabsContent>
      </Tabs>

      <Dialog onOpenChange={setConfirmApplyOpen} open={confirmApplyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认移动真实 Chrome 书签？</DialogTitle>
            <DialogDescription>
              将移动 {selectedCount} 个书签。ShuHai 会先备份并支持撤销，但这一步会实际修改当前浏览器书签。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirmApplyOpen(false)} variant="ghost">
              取消
            </Button>
            <Button loading={busyAction === 'apply'} onClick={applyPlan}>
              确认应用
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <WelcomeGuide
        onOpenHelp={openHelpFromWelcome}
        onStart={completeOnboarding}
        open={Boolean(state && !state.onboarded)}
      />
    </main>
  );
}
