import { useEffect, useMemo, useState } from 'react';
import type {
  AppSettings,
  BookmarkItem,
  CapturedContent,
  ClassificationPlan,
  ExportManifest,
  ExportPreview,
  ExportScope,
} from '../../shared/bookmark-types.js';
import {
  checkVaultPermission,
  exportBookmarksToVault,
  exportCaptureToVault,
  getVaultHandle,
  previewBookmarkExport,
  requestVaultAccess,
} from '../../utils/vault-writer.js';

interface ExportPageProps {
  bookmarks: BookmarkItem[];
  exportManifests: ExportManifest[];
  pendingCapture?: CapturedContent;
  plan?: ClassificationPlan;
  selectedMoveIds: string[];
  settings: AppSettings;
  onClearPendingCapture(): Promise<void>;
  onRefresh(): Promise<void>;
}

function bookmarksForScope(
  bookmarks: BookmarkItem[],
  plan: ClassificationPlan | undefined,
  scope: ExportScope,
  selectedMoveIds: string[],
): BookmarkItem[] {
  if (!plan || scope === 'all') {
    return bookmarks;
  }

  const moveIds =
    scope === 'selected' ? new Set(selectedMoveIds) : new Set(plan.moves.map((move) => move.id));
  const bookmarkIds = new Set(
    plan.moves.filter((move) => moveIds.has(move.id)).map((move) => move.bookmarkId),
  );

  return bookmarks.filter((bookmark) => bookmarkIds.has(bookmark.id));
}

export default function ExportPage({
  bookmarks,
  exportManifests,
  pendingCapture,
  plan,
  selectedMoveIds,
  settings,
  onClearPendingCapture,
  onRefresh,
}: ExportPageProps) {
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [scope, setScope] = useState<ExportScope>('all');
  const [directoryPrefix, setDirectoryPrefix] = useState(settings.exportDirectory);
  const [preview, setPreview] = useState<ExportPreview | undefined>();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setDirectoryPrefix(settings.exportDirectory);
  }, [settings.exportDirectory]);

  useEffect(() => {
    void getVaultHandle()
      .then(setHandle)
      .catch(() => setHandle(null));
  }, []);

  const scopedBookmarks = useMemo(
    () => bookmarksForScope(bookmarks, plan, scope, selectedMoveIds),
    [bookmarks, plan, scope, selectedMoveIds],
  );

  const chooseVault = async () => {
    setBusy(true);
    setError('');
    try {
      const nextHandle = await requestVaultAccess();
      setHandle(nextHandle);
      setStatus(`已选择 Vault：${nextHandle.name}`);
    } catch (chooseError) {
      setError(chooseError instanceof Error ? chooseError.message : String(chooseError));
    } finally {
      setBusy(false);
    }
  };

  const buildPreview = () => {
    setError('');
    setPreview(
      previewBookmarkExport(scopedBookmarks, {
        directoryPrefix,
        moves: plan?.moves,
      }),
    );
  };

  const exportBookmarks = async () => {
    if (!handle) {
      setError('请先选择 Obsidian Vault 目录');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const allowed = await checkVaultPermission(handle);
      if (!allowed) {
        throw new Error('没有 Vault 写入权限，请重新选择目录');
      }

      const result = await exportBookmarksToVault(
        handle,
        scopedBookmarks,
        {
          directoryPrefix,
          moves: plan?.moves,
        },
        (done, total) => setStatus(`正在导出 ${done}/${total}`),
      );
      setStatus(
        `导出完成：新增 ${result.exported}，跳过 ${result.skipped}，失败 ${result.errors.length}`,
      );
      await onRefresh();
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    } finally {
      setBusy(false);
    }
  };

  const exportCapture = async () => {
    if (!handle || !pendingCapture) {
      return;
    }

    setBusy(true);
    setError('');
    try {
      const allowed = await checkVaultPermission(handle);
      if (!allowed) {
        throw new Error('没有 Vault 写入权限，请重新选择目录');
      }

      const result = await exportCaptureToVault(handle, pendingCapture, directoryPrefix);
      setStatus(
        `内容保存完成：新增 ${result.exported}，跳过 ${result.skipped}，失败 ${result.errors.length}`,
      );
      await onClearPendingCapture();
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : String(captureError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel export-panel">
      {error ? <div className="notice error">{error}</div> : null}
      {status ? <div className="notice">{status}</div> : null}

      <div className="export-card">
        <h2>导出到 Obsidian</h2>
        <p>Vault 目录：{handle?.name ?? '未选择'}</p>
        <div className="actions">
          <button onClick={chooseVault} disabled={busy}>
            {handle ? '更换目录' : '选择 Obsidian Vault'}
          </button>
          <button onClick={buildPreview} disabled={busy || scopedBookmarks.length === 0}>
            预览
          </button>
          <button
            className="primary"
            onClick={exportBookmarks}
            disabled={busy || scopedBookmarks.length === 0}
          >
            导出书签索引
          </button>
        </div>
      </div>

      <label>
        <span>导出范围</span>
        <select value={scope} onChange={(event) => setScope(event.target.value as ExportScope)}>
          <option value="all">全部书签 ({bookmarks.length})</option>
          <option value="plan" disabled={!plan}>
            当前方案中的书签 ({plan?.moves.length ?? 0})
          </option>
          <option value="selected" disabled={!plan}>
            当前方案选中项 ({selectedMoveIds.length})
          </option>
        </select>
      </label>

      <label>
        <span>导出目录</span>
        <input
          value={directoryPrefix}
          onChange={(event) => setDirectoryPrefix(event.target.value)}
          placeholder="Bookmarks"
        />
      </label>

      {preview ? (
        <div className="notice">
          将创建最多 {preview.total} 个 .md 文件
          <ul>
            {preview.folders.slice(0, 8).map((folder) => (
              <li key={folder.path}>
                <span>{folder.path}</span>
                <small>{folder.count} 个文件</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {pendingCapture ? (
        <div className="export-card">
          <h2>待保存内容</h2>
          <p>{pendingCapture.title}</p>
          <small>{pendingCapture.url}</small>
          <div className="actions">
            <button className="primary" onClick={exportCapture} disabled={busy || !handle}>
              保存到 Vault
            </button>
            <button onClick={onClearPendingCapture} disabled={busy}>
              忽略
            </button>
          </div>
        </div>
      ) : null}

      <div className="backup-list">
        <h2>最近导出</h2>
        {exportManifests.length === 0 ? <p>暂无导出记录</p> : null}
        {exportManifests.slice(0, 5).map((manifest) => (
          <div className="backup-row" key={manifest.id}>
            <span>{new Date(manifest.exportedAt).toLocaleString()}</span>
            <small>{manifest.bookmarkCount} 个条目</small>
          </div>
        ))}
      </div>
    </section>
  );
}
