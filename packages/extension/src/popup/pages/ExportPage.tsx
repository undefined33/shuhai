import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Database,
  Download,
  Eye,
  FileText,
  FolderOpen,
  HelpCircle,
  Save,
  Trash2,
} from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
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
  exportCaptureToVault,
  getVaultHandle,
  previewBookmarkExport,
  requestVaultAccess,
} from '../../utils/vault-writer.js';

interface ExportPageProps {
  bookmarks: BookmarkItem[];
  exportManifests: ExportManifest[];
  pendingCaptures: CapturedContent[];
  plan?: ClassificationPlan;
  selectedMoveIds: string[];
  settings: AppSettings;
  surface?: 'popup' | 'sidepanel';
  onClearPendingCapture(): Promise<void>;
  onRemovePendingCapture(id: string): Promise<void>;
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

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function isBookmarkIndexManifest(manifest: ExportManifest): boolean {
  return manifest.type === 'bookmark-index' || (!manifest.type && manifest.bookmarkCount > 5);
}

export default function ExportPage({
  bookmarks,
  exportManifests,
  pendingCaptures,
  plan,
  selectedMoveIds,
  settings,
  surface = 'popup',
  onClearPendingCapture,
  onRemovePendingCapture,
  onRefresh,
}: ExportPageProps) {
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [scope, setScope] = useState<ExportScope>('all');
  const [directoryPrefix, setDirectoryPrefix] = useState(settings.exportDirectory);
  const [preview, setPreview] = useState<ExportPreview | undefined>();
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [exportingBookmarks, setExportingBookmarks] = useState(false);
  const [error, setError] = useState('');
  const [selectedCaptureId, setSelectedCaptureId] = useState('');
  const [captureTags, setCaptureTags] = useState('');
  const [previewCaptureOpen, setPreviewCaptureOpen] = useState(false);
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

  const selectedCapture = useMemo(
    () => pendingCaptures.find((capture) => capture.id === selectedCaptureId) ?? pendingCaptures[0],
    [pendingCaptures, selectedCaptureId],
  );

  useEffect(() => {
    if (!selectedCapture) {
      setSelectedCaptureId('');
      setCaptureTags('');
      return;
    }

    setSelectedCaptureId(selectedCapture.id);
    setCaptureTags(selectedCapture.tags.join(', '));
  }, [selectedCapture]);

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
    setExportingBookmarks(true);
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
      setExportingBookmarks(false);
      exportControllerRef.current = undefined;
    }
  };

  const cancelExport = () => {
    exportControllerRef.current?.abort();
    setStatus('正在取消导出...');
  };

  const exportCapture = async () => {
    if (!handle || !selectedCapture) {
      return;
    }

    setBusy(true);
    setError('');
    try {
      const allowed = await checkVaultPermission(handle);
      if (!allowed) {
        throw new Error('没有 Vault 写入权限，请重新选择目录');
      }

      const capture: CapturedContent = {
        ...selectedCapture,
        tags: captureTags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      };
      const result = await exportCaptureToVault(handle, capture, directoryPrefix, settings);
      setStatus(
        `内容保存完成：新增 ${result.exported}，跳过 ${result.skipped}，失败 ${result.errors.length}`,
      );
      setProgress(100);
      await onRemovePendingCapture(selectedCapture.id);
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : String(captureError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <TooltipProvider>
      <section className="flex h-full min-h-0 flex-col gap-3">
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        {status ? <Alert variant={error ? 'destructive' : 'success'}>{status}</Alert> : null}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              知识库管理
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
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              导出书签索引
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-3">
            <p className="text-xs text-muted-foreground">
              为每个书签生成一个 .md 索引文件：标题、链接、分类、标签。不抓取网页正文。
            </p>
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
                <TooltipContent>
                  把书签索引写成 Markdown 文件，不会抓取远程网页内容。
                </TooltipContent>
              </Tooltip>
              {exportingBookmarks ? (
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Save className="h-4 w-4 text-primary" />
              提取文章内容
              <Badge variant={pendingCaptures.length > 0 ? 'success' : 'secondary'}>
                {pendingCaptures.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              在任意网页右键“提取文章正文到 ShuHai”，正文会进入这里。确认后才写入 Vault。
            </p>
            {pendingCaptures.length === 0 ? (
              <Alert variant="warning">
                当前没有待保存文章。请到正在阅读的网页右键选择“提取文章正文到 ShuHai”。
              </Alert>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  {pendingCaptures.slice(0, surface === 'sidepanel' ? 8 : 4).map((capture) => (
                    <button
                      className={
                        capture.id === selectedCapture?.id
                          ? 'w-full rounded-md border border-primary bg-accent px-2 py-2 text-left'
                          : 'w-full rounded-md border border-border px-2 py-2 text-left hover:bg-muted'
                      }
                      key={capture.id}
                      onClick={() => setSelectedCaptureId(capture.id)}
                      type="button"
                    >
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className="min-w-0 flex-1 truncate">{capture.title}</span>
                        <Badge variant="outline">{capture.source}</Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{capture.siteName ?? hostFromUrl(capture.url)}</span>
                        {capture.wordCount ? <span>{capture.wordCount} 字</span> : null}
                        <span>{capture.media.length} 图</span>
                      </div>
                    </button>
                  ))}
                </div>

                {selectedCapture ? (
                  <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
                    <div className="rounded-md border border-primary/40 bg-primary/10 p-2">
                      <div className="text-xs font-medium">下一步：确认后写入 Vault</div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        会保存到 {directoryPrefix || 'Bookmarks'}/文章/。它和书签索引使用同一个
                        Vault，但只写入当前选中的正文内容。
                      </p>
                      <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                        <Button
                          disabled={busy || !handle}
                          loading={busy}
                          onClick={exportCapture}
                          size="sm"
                        >
                          <Save className="h-4 w-4" />
                          {handle ? '保存选中文章' : '先选择 Vault'}
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() => onRemovePendingCapture(selectedCapture.id)}
                          size="icon"
                          title="移除这篇待保存内容"
                          variant="outline"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1 truncate text-sm font-medium">
                        预览：{selectedCapture.title}
                      </div>
                      <Button
                        onClick={() => setPreviewCaptureOpen(true)}
                        size="sm"
                        variant="outline"
                      >
                        <Eye className="h-4 w-4" />
                        放大
                      </Button>
                    </div>
                    <div className="max-h-72 overflow-y-auto rounded-md bg-card p-3 text-xs leading-5 text-foreground">
                      <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                        {selectedCapture.text.slice(0, 2400)}
                        {selectedCapture.text.length > 2400 ? '\n\n...' : ''}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>标签</Label>
                      <Input
                        onChange={(event) => setCaptureTags(event.target.value)}
                        placeholder="article, security"
                        value={captureTags}
                      />
                    </div>
                  </div>
                ) : null}
                <Button disabled={busy} onClick={onClearPendingCapture} variant="ghost">
                  清空待保存队列
                </Button>
                <Dialog onOpenChange={setPreviewCaptureOpen} open={previewCaptureOpen}>
                  <DialogContent className="flex h-[calc(100vh-1rem)] max-w-[calc(100%-1rem)] flex-col gap-3">
                    <DialogHeader>
                      <DialogTitle className="line-clamp-2">{selectedCapture?.title}</DialogTitle>
                      <DialogDescription>
                        {selectedCapture
                          ? `${selectedCapture.siteName ?? hostFromUrl(selectedCapture.url)} · ${selectedCapture.wordCount ?? 0} 字 · ${selectedCapture.media.length} 图`
                          : ''}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-card p-3 text-sm leading-6">
                      <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                        {selectedCapture?.text}
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="min-h-0 flex-1 rounded-lg border border-border bg-card p-3">
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
          ) : (
            <div className="space-y-2 text-center text-sm text-muted-foreground">
              <FolderOpen className="mx-auto h-7 w-7" />
              <p>尚未生成导出预览。</p>
              <p className="text-xs">先选择 Vault 目录，再点击预览确认将写入哪些文件。</p>
            </div>
          )}

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
        </div>
      </section>
    </TooltipProvider>
  );
}
