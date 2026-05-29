import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, FolderOpen, HelpCircle } from 'lucide-react';
import type {
  AppSettings,
  BookmarkItem,
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
import { VirtualList } from '../../components/VirtualList.js';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../components/ui/tooltip.js';
import {
  checkVaultPermission,
  exportBookmarksToVault,
  getVaultHandle,
  previewBookmarkExport,
  requestVaultAccess,
} from '../../utils/vault-writer.js';

interface BookmarkIndexExportPanelProps {
  bookmarks: BookmarkItem[];
  exportManifests: ExportManifest[];
  plan?: ClassificationPlan;
  selectedMoveIds: string[];
  settings: AppSettings;
  surface?: 'popup' | 'sidepanel';
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

function isBookmarkIndexManifest(manifest: ExportManifest): boolean {
  return manifest.type === 'bookmark-index' || (!manifest.type && manifest.bookmarkCount > 5);
}

export default function BookmarkIndexExportPanel({
  bookmarks,
  exportManifests,
  plan,
  selectedMoveIds,
  settings,
  surface = 'popup',
  onRefresh,
}: BookmarkIndexExportPanelProps) {
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [scope, setScope] = useState<ExportScope>('all');
  const [directoryPrefix, setDirectoryPrefix] = useState(settings.exportDirectory);
  const [preview, setPreview] = useState<ExportPreview | undefined>();
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const exportControllerRef = useRef<AbortController | undefined>(undefined);
  const bookmarkIndexManifests = useMemo(
    () => exportManifests.filter(isBookmarkIndexManifest),
    [exportManifests],
  );

  useEffect(() => {
    setDirectoryPrefix(settings.exportDirectory);
  }, [settings.exportDirectory]);

  useEffect(() => {
    void getVaultHandle()
      .then(setHandle)
      .catch(() => setHandle(null));
  }, []);

  useEffect(() => {
    if (!status || error || busy) {
      return undefined;
    }

    const timer = window.setTimeout(() => setStatus(''), 3000);
    return () => window.clearTimeout(timer);
  }, [busy, error, status]);

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

    const controller = new AbortController();
    exportControllerRef.current = controller;
    setExporting(true);
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
          signal: controller.signal,
          settings,
        },
        (done, total, path) => {
          setStatus(`正在写入: ${done}/${total}${path ? ` (${path})` : ''}`);
          setProgress(total > 0 ? Math.round((done / total) * 100) : 0);
        },
      );

      if (controller.signal.aborted) {
        setStatus(`导出已取消：已处理 ${result.exported + result.skipped} 个书签`);
      } else {
        setStatus(
          `导出完成：新增 ${result.exported}，跳过 ${result.skipped}，失败 ${result.errors.length}`,
        );
        setProgress(100);
      }
      await onRefresh();
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    } finally {
      setBusy(false);
      setExporting(false);
      exportControllerRef.current = undefined;
    }
  };

  const cancelExport = () => {
    exportControllerRef.current?.abort();
    setStatus('正在取消导出...');
  };

  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            导出书签索引
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-3">
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          {status ? <Alert variant="success">{status}</Alert> : null}

          <p className="text-xs text-muted-foreground">
            为每个书签生成一个 .md 索引文件：标题、链接、分类、标签。不抓取网页正文。
          </p>

          <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-2 text-xs">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{handle?.name ?? '未选择 Vault'}</span>
            <Button disabled={busy} onClick={chooseVault} size="sm" variant="outline">
              {handle ? '更换' : '选择'}
            </Button>
          </div>

          <div className="flex gap-2">
            <Button
              disabled={busy || scopedBookmarks.length === 0}
              onClick={buildPreview}
              variant="secondary"
            >
              预览索引
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex flex-1">
                  <Button
                    className="flex-1"
                    disabled={busy || scopedBookmarks.length === 0}
                    loading={busy}
                    onClick={exportBookmarks}
                  >
                    <Download className="h-4 w-4" />
                    导出索引
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>把书签索引写成 Markdown 文件，不会抓取远程网页内容。</TooltipContent>
            </Tooltip>
            {exporting ? (
              <Button onClick={cancelExport} variant="outline">
                取消
              </Button>
            ) : null}
          </div>

          {busy || progress > 0 ? <Progress value={progress} /> : null}

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label>导出范围</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>只导出书签元数据，不访问网页内容。</TooltipContent>
              </Tooltip>
            </div>
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

          {preview ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">预览：最多 {preview.total} 个 .md 文件</div>
              <VirtualList
                className="h-48 rounded-md border border-border"
                containerHeight={surface === 'sidepanel' ? 260 : 192}
                itemHeight={32}
                items={preview.folders}
                renderItem={(folder) => (
                  <div className="flex h-8 items-center gap-2 px-2 text-xs">
                    <span className="min-w-0 flex-1 truncate">{folder.path}</span>
                    <Badge variant="outline">{folder.count}</Badge>
                  </div>
                )}
              />
            </div>
          ) : null}

          <div className="border-t border-border pt-3">
            <div className="mb-2 text-sm font-medium">最近导出</div>
            {bookmarkIndexManifests.length === 0 ? (
              <p className="text-xs text-muted-foreground">尚未导出过书签</p>
            ) : (
              <div className="space-y-2">
                {bookmarkIndexManifests.slice(0, 5).map((manifest) => (
                  <div className="flex items-center gap-2 text-xs" key={manifest.id}>
                    <span className="min-w-0 flex-1 truncate">
                      写入：{new Date(manifest.exportedAt).toLocaleString()}
                    </span>
                    <Badge variant="outline">{manifest.sourceLabel ?? '书签索引'}</Badge>
                    <Badge variant="secondary">{manifest.bookmarkCount} 条</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
