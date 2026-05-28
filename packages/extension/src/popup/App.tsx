import { useEffect, useMemo, useState } from 'react';
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
import { DEFAULT_SETTINGS } from '../utils/storage.js';
import BookmarkTree from './pages/BookmarkTree.js';
import ClassifyPreview from './pages/ClassifyPreview.js';
import ExportPage from './pages/ExportPage.js';
import Settings from './pages/Settings.js';

type ViewName = 'tree' | 'preview' | 'export' | 'settings';

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
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('正在读取书签...');
  const [error, setError] = useState('');

  const loadState = async () => {
    setBusy(true);
    setError('');
    try {
      const nextState = await sendMessage<ExtensionState>({ type: 'state:get' });
      setState(nextState);
      setClassifyMode(nextState.settings.defaultClassifyMode);
      setStatus(`已读取 ${nextState.bookmarks.length} 个书签`);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void loadState();
  }, []);

  const createPlan = async (mode: ClassificationMode) => {
    setBusy(true);
    setError('');
    setClassifyMode(mode);
    setStatus(mode === 'full' ? '正在重新审视全部书签...' : '正在生成安全整理方案...');
    try {
      const nextPlan = await sendMessage<ClassificationPlan>({ type: 'plan:create', mode });
      setPlan(nextPlan);
      setView('preview');
      setStatus(`生成 ${nextPlan.moves.length} 条移动建议`);
    } catch (planError) {
      setError(planError instanceof Error ? planError.message : String(planError));
    } finally {
      setBusy(false);
    }
  };

  const applyPlan = async () => {
    if (!plan) {
      return;
    }

    const count = selectedMoveIds(plan).length;
    const confirmed = window.confirm(
      `将移动 ${count} 个真实 Chrome 书签。ShuHai 会先备份并支持撤销，是否继续？`,
    );

    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError('');
    setStatus('正在备份并移动书签...');
    try {
      const result = await sendMessage<{ moved: number; failed: unknown[] }>({
        type: 'plan:apply',
        plan,
        selectedMoveIds: selectedMoveIds(plan),
      });
      setStatus(`已移动 ${result.moved} 个书签，失败 ${result.failed.length} 个`);
      setPlan(undefined);
      setView('tree');
      await loadState();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : String(applyError));
    } finally {
      setBusy(false);
    }
  };

  const undoLast = async () => {
    setBusy(true);
    setError('');
    setStatus('正在撤销上次整理...');
    try {
      const result = await sendMessage<{ undone: number }>({ type: 'plan:undoLast' });
      setStatus(`已撤销 ${result.undone} 个移动操作`);
      await loadState();
    } catch (undoError) {
      setError(undoError instanceof Error ? undoError.message : String(undoError));
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async (settings: AppSettings) => {
    setBusy(true);
    setError('');
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
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : String(settingsError));
    } finally {
      setBusy(false);
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>ShuHai</h1>
          <p>{status}</p>
        </div>
        <nav aria-label="主导航">
          <button className={view === 'tree' ? 'active' : ''} onClick={() => setView('tree')}>
            书签
          </button>
          <button
            className={view === 'preview' ? 'active' : ''}
            disabled={!plan}
            onClick={() => setView('preview')}
          >
            方案
          </button>
          <button className={view === 'export' ? 'active' : ''} onClick={() => setView('export')}>
            导出
          </button>
          <button
            className={view === 'settings' ? 'active' : ''}
            onClick={() => setView('settings')}
          >
            设置
          </button>
        </nav>
      </header>

      {error ? <div className="notice error">{error}</div> : null}

      {view === 'tree' && (
        <BookmarkTree
          bookmarks={bookmarks}
          busy={busy}
          classifyMode={classifyMode}
          folders={folders}
          onClassifyModeChange={setClassifyMode}
          onCreatePlan={createPlan}
          onRefresh={loadState}
          onUndo={undoLast}
          canUndo={canUndo}
        />
      )}

      {view === 'preview' && plan && (
        <ClassifyPreview
          folders={folders}
          plan={plan}
          busy={busy}
          selectedCount={selectedCount}
          onApply={applyPlan}
          onCancel={() => setView('tree')}
          onMoveChange={(move) => setPlan((current) => (current ? replaceMove(current, move) : current))}
        />
      )}

      {view === 'export' && (
        <ExportPage
          bookmarks={exportBookmarks}
          exportManifests={state?.exportManifests ?? []}
          pendingCapture={state?.pendingCapture}
          plan={plan}
          settings={settings}
          selectedMoveIds={plan ? selectedMoveIds(plan) : []}
          onClearPendingCapture={clearPendingCapture}
          onRefresh={loadState}
        />
      )}

      {view === 'settings' && (
        <Settings
          backups={backups}
          busy={busy}
          exportManifests={state?.exportManifests ?? []}
          settings={settings}
          onDownloadBackup={downloadBackup}
          onSave={saveSettings}
        />
      )}
    </main>
  );
}
