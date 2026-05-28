import { useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  Download,
  GitBranch,
  Loader2,
  Settings as SettingsIcon,
} from 'lucide-react';
import type {
  AppSettings,
  BackupRecord,
  BookmarkItem,
  ClassificationMode,
  ClassificationPlan,
  ExtensionRequest,
  ExtensionResponse,
  ExtensionState,
  MovePlan,
} from '../shared/bookmark-types.js';
import { Button } from '../components/ui/button.js';
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
import Settings from './pages/Settings.js';

type ViewName = 'tree' | 'preview' | 'export' | 'settings';
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

export default function App() {
  const [view, setView] = useState<ViewName>('tree');
  const [state, setState] = useState<ExtensionState | undefined>();
  const [plan, setPlan] = useState<ClassificationPlan | undefined>();
  const [classifyMode, setClassifyMode] = useState<ClassificationMode>('safe');
  const [busyAction, setBusyAction] = useState<BusyAction>('load');
  const [status, setStatus] = useState('正在读取书签...');
  const [notice, setNotice] = useState<Notice>();
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);

  const busy = Boolean(busyAction);

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

  const createPlan = async (mode: ClassificationMode) => {
    setBusyAction('plan');
    setNotice(undefined);
    setClassifyMode(mode);
    setStatus(mode === 'full' ? '正在重新审视全部书签...' : '正在生成安全整理方案...');
    try {
      const nextPlan = await sendMessage<ClassificationPlan>({ type: 'plan:create', mode });
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
      setBusyAction(undefined);
    }
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

  return (
    <main className="flex h-[600px] flex-col bg-background text-foreground">
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
          <div className="mt-3 space-y-1">
            <Progress value={68} />
            <p className="text-[11px] text-muted-foreground">正在分批分类，请保持弹窗打开。</p>
          </div>
        ) : null}
      </header>

      <Tabs
        className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-2"
        onValueChange={(next) => setView(next as ViewName)}
        value={view}
      >
        <TabsList className="grid-cols-4">
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
            />
          ) : null}
        </TabsContent>

        <TabsContent className="min-h-0 flex-1" value="export">
          <ExportPage
            bookmarks={exportBookmarks}
            exportManifests={state?.exportManifests ?? []}
            onClearPendingCapture={clearPendingCapture}
            onRefresh={loadState}
            pendingCapture={state?.pendingCapture}
            plan={plan}
            selectedMoveIds={plan ? selectedMoveIds(plan) : []}
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
    </main>
  );
}
