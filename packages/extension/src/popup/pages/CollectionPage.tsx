import { useEffect, useMemo, useState } from 'react';
import { Clock, Eye, FolderOpen, Inbox, MessageCircle, Save, Trash2 } from 'lucide-react';
import type { AppSettings, CapturedContent, ExportManifest } from '../../shared/bookmark-types.js';
import { Alert } from '../../components/ui/alert.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { ErrorRecovery } from '../../components/ErrorRecovery.js';
import { SearchInput } from '../../components/SearchInput.js';
import { useToast } from '../../components/ui/toast.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import { Label } from '../../components/ui/label.js';
import {
  checkVaultPermission,
  exportCaptureToVault,
  type ExportResult,
  getVaultHandle,
  requestVaultAccess,
} from '../../utils/vault-writer.js';
import { toStructuredError, type StructuredError } from '../../utils/error-messages.js';

interface CollectionPageProps {
  exportManifests: ExportManifest[];
  pendingCaptures: CapturedContent[];
  settings: AppSettings;
  onClearPendingCapture(): Promise<void>;
  onCaptureCurrentSocial(source: 'twitter' | 'weibo'): Promise<CapturedContent>;
  onOpenSettings?(): void;
  onRemovePendingCapture(id: string): Promise<void>;
  onRefresh(): Promise<void>;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function sourceLabel(source: CapturedContent['source']): string {
  if (source === 'article') {
    return '文章';
  }

  if (source === 'twitter') {
    return 'Twitter/X';
  }

  return '微博';
}

function captureAuthorLine(capture: CapturedContent): string {
  const parts = [capture.author, capture.handle].filter(Boolean);
  return parts.join(' ');
}

function formatCaptureTime(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function isCaptureManifest(manifest: ExportManifest): boolean {
  return manifest.type === 'capture' || (!manifest.type && manifest.bookmarkCount <= 5);
}

function manifestSourceLabel(manifest: ExportManifest): string {
  if (manifest.sourceLabel) {
    return manifest.sourceLabel;
  }

  if (manifest.type === 'capture' || (!manifest.type && manifest.bookmarkCount <= 5)) {
    return '内容';
  }

  return '未分类';
}

function manifestCountLabel(manifest: ExportManifest): string {
  return `${manifest.bookmarkCount} 篇`;
}

function activeSocialSource(url: string): 'twitter' | 'weibo' | undefined {
  try {
    const parsed = new URL(url);
    if (
      (parsed.hostname === 'x.com' ||
        parsed.hostname.endsWith('.x.com') ||
        parsed.hostname === 'twitter.com' ||
        parsed.hostname.endsWith('.twitter.com')) &&
      /\/[^/]+\/status\/\d+/.test(parsed.pathname)
    ) {
      return 'twitter';
    }

    if (
      (parsed.hostname === 'weibo.com' ||
        parsed.hostname.endsWith('.weibo.com') ||
        parsed.hostname === 'm.weibo.cn') &&
      (/\/detail\/[^/?#]+/.test(parsed.pathname) || /\/status\/[^/?#]+/.test(parsed.pathname))
    ) {
      return 'weibo';
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export default function CollectionPage({
  exportManifests,
  pendingCaptures,
  settings,
  onClearPendingCapture,
  onCaptureCurrentSocial,
  onOpenSettings,
  onRemovePendingCapture,
  onRefresh,
}: CollectionPageProps) {
  const { toast } = useToast();
  const [activeSource, setActiveSource] = useState<'twitter' | 'weibo' | undefined>();
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [directoryPrefix, setDirectoryPrefix] = useState(settings.exportDirectory);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<StructuredError | undefined>();
  const [busy, setBusy] = useState(false);
  const [selectedCaptureId, setSelectedCaptureId] = useState('');
  const [captureTags, setCaptureTags] = useState('');
  const [search, setSearch] = useState('');
  const [previewCaptureOpen, setPreviewCaptureOpen] = useState(false);

  useEffect(() => {
    setDirectoryPrefix(settings.exportDirectory);
  }, [settings.exportDirectory]);

  useEffect(() => {
    void getVaultHandle()
      .then(setHandle)
      .catch(() => setHandle(null));
  }, []);

  useEffect(() => {
    if (!chrome.tabs?.query) {
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabUrl = tabs[0]?.url ?? '';
      setActiveSource(activeSocialSource(tabUrl));
    });
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
  const filteredCaptures = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) {
      return pendingCaptures;
    }

    return pendingCaptures.filter((capture) =>
      [
        capture.title,
        capture.url,
        capture.author ?? '',
        capture.handle ?? '',
        capture.text.slice(0, 200),
      ]
        .join('\n')
        .toLowerCase()
        .includes(keyword),
    );
  }, [pendingCaptures, search]);
  const captureManifests = useMemo(
    () => exportManifests.filter(isCaptureManifest),
    [exportManifests],
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

  const chooseVault = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const nextHandle = await requestVaultAccess();
      setHandle(nextHandle);
      setStatus(`已选择 Vault：${nextHandle.name}`);
      toast({ kind: 'success', message: `已选择 Vault：${nextHandle.name}` });
    } catch (chooseError) {
      setError(toStructuredError(chooseError));
    } finally {
      setBusy(false);
    }
  };

  const ensureWritableVault = async () => {
    if (!handle) {
      throw new Error('请先选择 Obsidian Vault 目录');
    }

    const allowed = await checkVaultPermission(handle);
    if (!allowed) {
      throw new Error('没有 Vault 写入权限，请重新选择目录');
    }

    return handle;
  };

  const exportCapture = async (capture: CapturedContent, tags: string[]): Promise<ExportResult> => {
    const writableHandle = await ensureWritableVault();
    const result = await exportCaptureToVault(
      writableHandle,
      {
        ...capture,
        tags,
      },
      directoryPrefix,
      settings,
    );

    if (result.errors.length > 0) {
      throw new Error(result.errors.map((item) => item.error).join('；'));
    }

    return result;
  };

  const saveSelectedCapture = async () => {
    if (!selectedCapture) {
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const tags = captureTags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
      const result = await exportCapture(selectedCapture, tags);
      setStatus('内容保存完成，已从待保存队列移除。');
      toast({
        kind: 'success',
        message: result.files[0]
          ? `已写入「${selectedCapture.title}」到 ${directoryPrefix}/`
          : `「${selectedCapture.title}」已存在，未重复写入。`,
      });
      await onRemovePendingCapture(selectedCapture.id);
    } catch (captureError) {
      setError(toStructuredError(captureError));
    } finally {
      setBusy(false);
    }
  };

  const saveAllCaptures = async () => {
    if (pendingCaptures.length === 0) {
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      let exportedCount = 0;
      for (const capture of pendingCaptures) {
        const result = await exportCapture(capture, capture.tags);
        exportedCount += result.exported;
        await onRemovePendingCapture(capture.id);
      }
      setStatus(`已保存 ${pendingCaptures.length} 条内容。`);
      toast({
        kind: 'success',
        message: `已写入 ${exportedCount} 个文件到 ${directoryPrefix}/`,
      });
      await onRefresh();
    } catch (captureError) {
      setError(toStructuredError(captureError));
    } finally {
      setBusy(false);
    }
  };

  const captureCurrentSocial = async (source: 'twitter' | 'weibo') => {
    setBusy(true);
    setError(undefined);
    try {
      const capture = await onCaptureCurrentSocial(source);
      setSelectedCaptureId(capture.id);
      setStatus(`${sourceLabel(source)}已加入待保存队列。`);
      toast({ kind: 'success', message: `${sourceLabel(source)}已加入待保存队列。` });
      await onRefresh();
    } catch (captureError) {
      setError(toStructuredError(captureError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      {error ? (
        <ErrorRecovery
          error={error}
          onDismiss={() => setError(undefined)}
          onOpenSettings={onOpenSettings}
          onRetry={() => void onRefresh()}
          onSelectVault={chooseVault}
        />
      ) : null}
      {status ? <Alert variant="success">{status}</Alert> : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-primary" />
            Obsidian Vault
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-2 text-xs">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{handle?.name ?? '未选择 Vault'}</span>
            <Button disabled={busy} onClick={chooseVault} size="sm" variant="outline">
              {handle ? '更换' : '选择目录'}
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label>保存目录</Label>
            <Input
              onChange={(event) => setDirectoryPrefix(event.target.value)}
              placeholder="Bookmarks"
              value={directoryPrefix}
            />
          </div>
          {!handle ? (
            <Alert variant="warning">
              请先选择 Obsidian Vault 目录。保存的文章和社交内容会写入该目录。
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-primary" />
            待保存内容
            <Badge variant={pendingCaptures.length > 0 ? 'success' : 'secondary'}>
              {pendingCaptures.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            在网页右键保存文章、推文或微博后，内容会先进入这里。确认后才写入 Vault。
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              disabled={busy || activeSource !== 'twitter'}
              onClick={() => captureCurrentSocial('twitter')}
              size="sm"
              title={activeSource === 'twitter' ? '保存当前推文' : '请先打开一条推文详情页'}
              variant="outline"
            >
              <MessageCircle className="h-4 w-4" />
              保存当前推文
            </Button>
            <Button
              disabled={busy || activeSource !== 'weibo'}
              onClick={() => captureCurrentSocial('weibo')}
              size="sm"
              title={activeSource === 'weibo' ? '保存当前微博' : '请先打开一条微博详情页'}
              variant="outline"
            >
              <MessageCircle className="h-4 w-4" />
              保存当前微博
            </Button>
          </div>

          {pendingCaptures.length > 0 ? (
            <div className="space-y-1.5">
              <SearchInput
                onChange={setSearch}
                placeholder="搜索标题、URL、作者或正文"
                value={search}
              />
              <div className="text-[11px] text-muted-foreground">
                显示 {filteredCaptures.length} / {pendingCaptures.length} 条
              </div>
            </div>
          ) : null}

          {pendingCaptures.length === 0 ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-muted/30 p-6 text-center">
                <Inbox className="h-7 w-7 text-muted-foreground" />
                <p className="text-sm font-medium">还没有待保存的内容</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  在任意网页右键选择“保存此文章到知识库”，或在 Twitter/X、微博页面保存当前内容。
                </p>
              </div>
            </div>
          ) : filteredCaptures.length === 0 ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-muted/30 p-6 text-center">
                <Inbox className="h-7 w-7 text-muted-foreground" />
                <p className="text-sm font-medium">未找到匹配「{search}」的内容</p>
                <Button onClick={() => setSearch('')} size="sm" variant="outline">
                  清除搜索
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="space-y-3">
                  <div className="space-y-2">
                    {filteredCaptures.map((capture) => (
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
                          <Badge variant="outline">{sourceLabel(capture.source)}</Badge>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{capture.siteName ?? hostFromUrl(capture.url)}</span>
                          {captureAuthorLine(capture) ? (
                            <span className="truncate">{captureAuthorLine(capture)}</span>
                          ) : null}
                          {capture.wordCount ? <span>{capture.wordCount} 字</span> : null}
                          <span>{capture.media.length} 媒体</span>
                        </div>
                      </button>
                    ))}
                  </div>

                  {selectedCapture ? (
                    <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <Button
                          disabled={busy || !handle}
                          loading={busy}
                          onClick={saveSelectedCapture}
                          size="sm"
                        >
                          <Save className="h-4 w-4" />
                          {handle ? '保存选中内容' : '先选择 Vault'}
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() => onRemovePendingCapture(selectedCapture.id)}
                          size="icon"
                          title="移除这条待保存内容"
                          variant="outline"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1 truncate text-sm font-medium">
                          预览：{selectedCapture.title}
                        </div>
                        <Badge variant="outline">{sourceLabel(selectedCapture.source)}</Badge>
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
                        <div className="mb-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                          {captureAuthorLine(selectedCapture) ? (
                            <span>{captureAuthorLine(selectedCapture)}</span>
                          ) : null}
                          {selectedCapture.created ? (
                            <span>发布：{selectedCapture.created}</span>
                          ) : null}
                          <span>收藏：{formatCaptureTime(selectedCapture.capturedAt)}</span>
                        </div>
                        <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                          {selectedCapture.text.slice(0, 2400)}
                          {selectedCapture.text.length > 2400 ? '\n\n...' : ''}
                        </div>
                      </div>

                      {selectedCapture.media.length > 0 ? (
                        <div className="space-y-1.5">
                          <Label>媒体链接</Label>
                          <div className="space-y-1 rounded-md bg-card p-2 text-[11px] text-muted-foreground">
                            {selectedCapture.media.slice(0, 4).map((item, index) => (
                              <div className="truncate" key={`${item.url}-${index}`}>
                                {item.type === 'video' ? '视频' : '图片'}：{item.url}
                              </div>
                            ))}
                            {selectedCapture.media.length > 4 ? (
                              <div>还有 {selectedCapture.media.length - 4} 条，点击放大查看。</div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

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
                </div>
              </div>

              <div className="grid shrink-0 grid-cols-2 gap-2">
                <Button disabled={busy || !handle} loading={busy} onClick={saveAllCaptures}>
                  <Save className="h-4 w-4" />
                  全部保存到 Vault
                </Button>
                <Button disabled={busy} onClick={onClearPendingCapture} variant="outline">
                  清空队列
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            最近写入 Vault
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {captureManifests.length === 0 ? (
            <p className="text-xs text-muted-foreground">尚未写入过收藏内容。</p>
          ) : (
            captureManifests.slice(0, 5).map((manifest) => (
              <div className="flex items-center gap-2 text-xs" key={manifest.id}>
                <span className="min-w-0 flex-1 truncate">
                  写入：{new Date(manifest.exportedAt).toLocaleString()}
                </span>
                <Badge variant="outline">{manifestSourceLabel(manifest)}</Badge>
                <Badge variant="secondary">{manifestCountLabel(manifest)}</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog onOpenChange={setPreviewCaptureOpen} open={previewCaptureOpen}>
        <DialogContent className="flex h-[calc(100vh-1rem)] max-w-[calc(100%-1rem)] flex-col gap-3">
          <DialogHeader>
            <DialogTitle className="line-clamp-2">{selectedCapture?.title}</DialogTitle>
            <DialogDescription>
              {selectedCapture
                ? `${selectedCapture.siteName ?? hostFromUrl(selectedCapture.url)} · ${
                    selectedCapture.wordCount ?? 0
                  } 字 · ${selectedCapture.media.length} 媒体`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-card p-3 text-sm leading-6">
            {selectedCapture ? (
              <div className="mb-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{sourceLabel(selectedCapture.source)}</Badge>
                {captureAuthorLine(selectedCapture) ? (
                  <span>{captureAuthorLine(selectedCapture)}</span>
                ) : null}
                {selectedCapture.created ? <span>发布：{selectedCapture.created}</span> : null}
                <span>收藏：{formatCaptureTime(selectedCapture.capturedAt)}</span>
              </div>
            ) : null}
            <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {selectedCapture?.text}
            </div>
            {selectedCapture && selectedCapture.media.length > 0 ? (
              <div className="mt-4 space-y-2 border-t border-border pt-3">
                <div className="text-xs font-medium">媒体链接</div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {selectedCapture.media.map((item, index) => (
                    <div className="break-all" key={`${item.url}-${index}`}>
                      {item.type === 'video' ? '视频' : '图片'}：{item.url}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
