import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bookmark,
  CircleHelp,
  Download,
  GitBranch,
  Loader2,
  PanelRightOpen,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react';
import type {
  AppSettings,
  BackupRecord,
  BookmarkItem,
  ClassificationPortMessage,
  ClassificationPortRequest,
  ClassificationMode,
  ClassificationPlan,
  ClassificationProgress,
  ExtensionRequest,
  ExtensionResponse,
  ExtensionState,
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
import { DEFAULT_SETTINGS } from '../utils/storage.js';
import BookmarkTree from './pages/BookmarkTree.js';
import ClassifyPreview from './pages/ClassifyPreview.js';
import ExportPage from './pages/ExportPage.js';
import HealthPage from './pages/HealthPage.js';
import HelpPage from './pages/HelpPage.js';
import Settings from './pages/Settings.js';

type Surface = 'popup' | 'sidepanel';
type ViewName = 'tree' | 'preview' | 'health' | 'export' | 'settings' | 'help';
type BusyAction = 'load' | 'plan' | 'apply' | 'undo' | 'settings' | undefined;
type Notice = { kind: 'success' | 'warning' | 'error'; message: string } | undefined;

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

interface PopupLauncherProps {
  busy: boolean;
  state?: ExtensionState;
  onOpenSidePanel(): void;
  onUsePopup(): void;
  onShowHelp(): void;
}

function PopupLauncher({
  busy,
  state,
  onOpenSidePanel,
  onUsePopup,
  onShowHelp,
}: PopupLauncherProps) {
  const bookmarkCount = state?.bookmarks.length ?? 0;
  const folderCount = state?.folders.length ?? 0;
  const hasVaultHistory = (state?.exportManifests.length ?? 0) > 0;

  return (
    <main className="flex h-[600px] flex-col gap-3 bg-background p-3 text-foreground">
      <header className="space-y-1">
        <h1 className="text-base font-semibold tracking-tight">ShuHai</h1>
        <p className="text-xs text-muted-foreground">
          侧边栏空间更适合整理大量书签；弹窗保留为快速入口。
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-semibold leading-none">{bookmarkCount}</div>
            <div className="mt-1 text-xs text-muted-foreground">书签</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-2xl font-semibold leading-none">{folderCount}</div>
            <div className="mt-1 text-xs text-muted-foreground">文件夹</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <PanelRightOpen className="h-4 w-4 text-primary" />
            推荐工作区
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button className="w-full" disabled={busy} loading={busy} onClick={onOpenSidePanel}>
            <PanelRightOpen className="h-4 w-4" />
            打开侧边栏
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button disabled={busy} onClick={onOpenSidePanel} variant="secondary">
              <Sparkles className="h-4 w-4" />
              整理书签
            </Button>
            <Button disabled={busy} onClick={onOpenSidePanel} variant="secondary">
              <Download className="h-4 w-4" />
              导出
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">DeepSeek AI</span>
            <Badge variant={state?.settings.useAi ? 'success' : 'warning'}>
              {state?.settings.useAi ? '已启用' : '规则模式'}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Vault 导出</span>
            <Badge variant={hasVaultHistory ? 'success' : 'outline'}>
              {hasVaultHistory ? '有历史记录' : '待配置'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="mt-auto grid grid-cols-2 gap-2">
        <Button disabled={busy} onClick={onShowHelp} variant="outline">
          <CircleHelp className="h-4 w-4" />
          帮助
        </Button>
        <Button disabled={busy} onClick={onUsePopup} variant="ghost">
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
              <div className="font-medium">2. 导出到 Obsidian</div>
              <p className="mt-1 text-xs text-muted-foreground">
                首次选择 Vault 目录后，浏览器会记住授权并写入 Markdown。
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="font-medium">3. 保存社交内容</div>
              <p className="mt-1 text-xs text-muted-foreground">
                在 Twitter/X 或微博页面右键保存当前内容，再到导出页确认写入。
              </p>
            </CardContent>
          </Card>
        </div>
        <DialogFooter>
          <Button onClick={onOpenHelp} variant="ghost">
            查看完整帮助
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
  const [view, setView] = useState<ViewName>('tree');
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
  const previousPendingCaptureCountRef = useRef(0);

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

  const loadState = async () => {
    setBusyAction('load');
    setNotice(undefined);
    try {
      const nextState = await sendMessage<ExtensionState>({ type: 'state:get' });
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
    const pendingCount = state?.pendingCaptures.length ?? 0;
    if (pendingCount > previousPendingCaptureCountRef.current) {
      setView('export');
    }
    previousPendingCaptureCountRef.current = pendingCount;
  }, [state?.pendingCaptures.length]);

  const createPlan = async (mode: ClassificationMode) => {
    setBusyAction('plan');
    setNotice(undefined);
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
      setView('preview');
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
          setStatus(`链接体检 ${message.progress.done}/${message.progress.total}`);
          return;
        }

        if (message.type === 'complete') {
          settled = true;
          setUrlHealthProgress(message.progress);
          setHealthChecking(false);
          healthPortRef.current = undefined;
          void loadState();
          setNotice({
            kind: message.progress.summary.dead + message.progress.summary.error > 0 ? 'warning' : 'success',
            message: `体检完成：死链 ${message.progress.summary.dead}，错误 ${message.progress.summary.error}，重定向 ${message.progress.summary.redirected}`,
          });
          setStatus('链接体检完成');
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
    healthPortRef.current?.postMessage({ type: 'cancel' } satisfies UrlHealthPortRequest);
    setStatus('正在取消链接体检...');
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
      setView('tree');
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

  const deleteBookmarkFromHealth = async (record: UrlHealthRecord) => {
    const confirmed = window.confirm(
      `确定删除这个 Chrome 书签吗？\n\n${record.bookmarkTitle}\n${record.bookmarkUrl}`,
    );

    if (!confirmed) {
      return;
    }

    try {
      await sendMessage<{ deleted: boolean; backupKey: string }>({
        type: 'bookmark:delete',
        id: record.bookmarkId,
      });
      setNotice({ kind: 'success', message: '已删除书签，并已创建备份。' });
      await loadState();
    } catch (deleteError) {
      showError(deleteError);
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

  const completeOnboarding = async () => {
    try {
      await sendMessage<{ onboarded: boolean }>({ type: 'onboarding:set', onboarded: true });
      setState((current) => (current ? { ...current, onboarded: true } : current));
    } catch (onboardingError) {
      showError(onboardingError);
    }
  };

  const openHelpFromWelcome = () => {
    setView('help');
    void completeOnboarding();
  };

  const handleOpenSidePanel = () => {
    void openSidePanel()
      .then(() => {
        setNotice({ kind: 'success', message: '侧边栏已打开。' });
      })
      .catch((error) => {
        showError(error);
      });
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
        if (view === 'preview' && plan && selectedCount > 0 && !busy) {
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

        if (view === 'preview') {
          event.preventDefault();
          setView('tree');
        }
        return;
      }

      if (event.key === '/') {
        event.preventDefault();
        setView('tree');
        window.setTimeout(() => {
          const search = document.querySelector<HTMLInputElement>('[data-shuhai-search]');
          search?.focus();
        }, 0);
      }
    };

    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [busy, busyAction, confirmApplyOpen, plan, selectedCount, showWorkspace, view]);

  if (!showWorkspace) {
    return (
      <>
        <PopupLauncher
          busy={busy}
          onOpenSidePanel={handleOpenSidePanel}
          onShowHelp={() => {
            setForcePopupWorkspace(true);
            setView('help');
          }}
          onUsePopup={() => setForcePopupWorkspace(true)}
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
        <TabsList className="grid-cols-6">
          <TabsTrigger value="tree">
            <Bookmark className="h-3.5 w-3.5" />
            书签
          </TabsTrigger>
          <TabsTrigger disabled={!plan} value="preview">
            <GitBranch className="h-3.5 w-3.5" />
            方案
          </TabsTrigger>
          <TabsTrigger value="export">
            <Download className="h-3.5 w-3.5" />
            导出
          </TabsTrigger>
          <TabsTrigger value="health">
            <Activity className="h-3.5 w-3.5" />
            体检
          </TabsTrigger>
          <TabsTrigger value="settings">
            <SettingsIcon className="h-3.5 w-3.5" />
            设置
          </TabsTrigger>
          <TabsTrigger value="help">
            <CircleHelp className="h-3.5 w-3.5" />
            帮助
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

        <TabsContent className="min-h-0 flex-1" value="tree">
          <BookmarkTree
            bookmarks={bookmarks}
            busy={busy}
            canUndo={canUndo}
            classifyMode={classifyMode}
            folders={folders}
            onClassifyModeChange={setClassifyMode}
            onCreatePlan={createPlan}
            onRefresh={loadState}
            onUndo={undoLast}
            surface={surface}
          />
        </TabsContent>

        <TabsContent className="min-h-0 flex-1" value="preview">
          {plan ? (
            <ClassifyPreview
              busy={busy}
              folders={folders}
              onApply={() => setConfirmApplyOpen(true)}
              onCancel={() => setView('tree')}
              onMoveChange={(move) =>
                setPlan((current) => (current ? replaceMove(current, move) : current))
              }
              plan={plan}
              selectedCount={selectedCount}
              surface={surface}
            />
          ) : null}
        </TabsContent>

        <TabsContent className="min-h-0 flex-1" forceMount value="export">
          <ExportPage
            bookmarks={exportBookmarks}
            exportManifests={state?.exportManifests ?? []}
            onClearPendingCapture={clearPendingCapture}
            onRemovePendingCapture={removePendingCapture}
            onRefresh={loadState}
            pendingCaptures={state?.pendingCaptures ?? []}
            plan={plan}
            selectedMoveIds={plan ? selectedMoveIds(plan) : []}
            settings={settings}
            surface={surface}
          />
        </TabsContent>

        <TabsContent className="min-h-0 flex-1" value="health">
          <HealthPage
            bookmarks={bookmarks}
            checking={healthChecking}
            onCancel={cancelHealthCheck}
            onClear={clearHealthRecords}
            onDelete={deleteBookmarkFromHealth}
            onStart={startHealthCheck}
            onUpdateUrl={updateBookmarkUrlFromHealth}
            progress={urlHealthProgress}
            records={state?.urlHealthRecords ?? []}
          />
        </TabsContent>

        <TabsContent className="min-h-0 flex-1" value="settings">
          <Settings
            backups={backups}
            busy={busy}
            exportManifests={state?.exportManifests ?? []}
            onDownloadBackup={downloadBackup}
            onSave={saveSettings}
            settings={settings}
          />
        </TabsContent>

        <TabsContent className="min-h-0 flex-1" value="help">
          <HelpPage />
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
