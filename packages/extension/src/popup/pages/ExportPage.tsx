import { useEffect, useMemo, useState } from 'react';
import { Database, Download, FolderOpen, Save } from 'lucide-react';
import type {
  AppSettings,
  BookmarkItem,
  CapturedContent,
  ClassificationPlan,
  ExportManifest,
  ExportPreview,
  ExportScope,
} from '../../shared/bookmark-types.js';
import { Alert } from '../../components/ui/alert.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { Label } from '../../components/ui/label.js';
import { Progress } from '../../components/ui/progress.js';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group.js';
import { ScrollArea } from '../../components/ui/scroll-area.js';
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
  const [progress, setProgress] = useState(0);
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
      setProgress(0);
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
    setProgress(0);
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
        (done, total) => {
          setStatus(`正在导出 ${done}/${total}`);
          setProgress(total > 0 ? Math.round((done / total) * 100) : 0);
        },
      );
      setStatus(
        `导出完成：新增 ${result.exported}，跳过 ${result.skipped}，失败 ${result.errors.length}`,
      );
      setProgress(100);
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
      setProgress(100);
      await onClearPendingCapture();
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : String(captureError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {status ? <Alert variant={error ? 'destructive' : 'success'}>{status}</Alert> : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            Obsidian Vault
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-2 text-xs">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{handle?.name ?? '未选择目录'}</span>
          </div>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={chooseVault} variant="outline">
              {handle ? '更换目录' : '选择 Vault'}
            </Button>
            <Button disabled={busy || scopedBookmarks.length === 0} onClick={buildPreview} variant="secondary">
              预览
            </Button>
            <Button
              className="flex-1"
              disabled={busy || scopedBookmarks.length === 0}
              loading={busy}
              onClick={exportBookmarks}
            >
              <Download className="h-4 w-4" />
              导出
            </Button>
          </div>
          {busy || progress > 0 ? <Progress value={progress} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-3">
          <div className="space-y-1.5">
            <Label>导出范围</Label>
            <RadioGroup onValueChange={(value) => setScope(value as ExportScope)} value={scope}>
              <label className="flex items-center gap-2 rounded-md border border-border px-2 py-2 text-sm">
                <RadioGroupItem value="all" />
                <span className="flex-1">全部书签</span>
                <Badge variant="secondary">{bookmarks.length}</Badge>
              </label>
              <label className="flex items-center gap-2 rounded-md border border-border px-2 py-2 text-sm">
                <RadioGroupItem disabled={!plan} value="plan" />
                <span className="flex-1">当前方案</span>
                <Badge variant="secondary">{plan?.moves.length ?? 0}</Badge>
              </label>
              <label className="flex items-center gap-2 rounded-md border border-border px-2 py-2 text-sm">
                <RadioGroupItem disabled={!plan} value="selected" />
                <span className="flex-1">方案选中项</span>
                <Badge variant="secondary">{selectedMoveIds.length}</Badge>
              </label>
            </RadioGroup>
          </div>

          <div className="space-y-1.5">
            <Label>导出目录</Label>
            <Input
              onChange={(event) => setDirectoryPrefix(event.target.value)}
              placeholder="Bookmarks"
              value={directoryPrefix}
            />
          </div>
        </CardContent>
      </Card>

      {pendingCapture ? (
        <Card>
          <CardContent className="space-y-2 p-3">
            <div className="text-sm font-medium">待保存内容</div>
            <div className="truncate text-xs text-muted-foreground">{pendingCapture.title}</div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={busy || !handle}
                loading={busy}
                onClick={exportCapture}
              >
                <Save className="h-4 w-4" />
                保存
              </Button>
              <Button disabled={busy} onClick={onClearPendingCapture} variant="ghost">
                忽略
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <ScrollArea className="min-h-0 flex-1 rounded-lg border border-border bg-card">
        <div className="space-y-2 p-3">
          {preview ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">预览：最多 {preview.total} 个 .md 文件</div>
              {preview.folders.slice(0, 8).map((folder) => (
                <div className="flex items-center gap-2 text-xs" key={folder.path}>
                  <span className="min-w-0 flex-1 truncate">{folder.path}</span>
                  <Badge variant="outline">{folder.count}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-sm text-muted-foreground">尚未生成导出预览</div>
          )}

          <div className="border-t border-border pt-3">
            <div className="mb-2 text-sm font-medium">最近导出</div>
            {exportManifests.length === 0 ? (
              <p className="text-xs text-muted-foreground">尚未导出过书签</p>
            ) : (
              <div className="space-y-2">
                {exportManifests.slice(0, 5).map((manifest) => (
                  <div className="flex items-center gap-2 text-xs" key={manifest.id}>
                    <span className="min-w-0 flex-1 truncate">
                      {new Date(manifest.exportedAt).toLocaleString()}
                    </span>
                    <Badge variant="secondary">{manifest.bookmarkCount}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </section>
  );
}
