import { useEffect, useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, FolderOpen, Save, X } from 'lucide-react';
import type { AppSettings, CapturedContent } from '../../shared/bookmark-types.js';
import { Alert } from '../../components/ui/alert.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { Label } from '../../components/ui/label.js';
import { useToast } from '../../components/ui/toast.js';
import {
  buildCaptureExportPath,
  checkVaultPermission,
  exportCaptureToVault,
  getVaultHandle,
} from '../../utils/vault-writer.js';
import { toStructuredError, type StructuredError } from '../../utils/error-messages.js';

export type InlineSaveSource = 'article' | 'twitter' | 'weibo';

export interface CurrentTabInfo {
  title?: string;
  url: string;
  source?: InlineSaveSource;
}

interface InlineSavePanelProps {
  currentTab?: CurrentTabInfo;
  initialCapture?: CapturedContent;
  pendingCaptures: CapturedContent[];
  settings: AppSettings;
  onCapture(source: InlineSaveSource): Promise<CapturedContent>;
  onOpenCollection(): void;
  onOpenSettings(): void;
  onRefresh(): Promise<void>;
  onRemovePendingCapture(id: string): Promise<void>;
}

function sourceLabel(source: CapturedContent['source'] | InlineSaveSource): string {
  if (source === 'twitter') {
    return 'Twitter/X';
  }

  if (source === 'weibo') {
    return '微博';
  }

  return '文章';
}

function sourceActionLabel(source: InlineSaveSource): string {
  if (source === 'twitter') {
    return '提取推文正文';
  }

  if (source === 'weibo') {
    return '提取微博正文';
  }

  return '提取文章正文';
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function captureAuthorLine(capture: CapturedContent): string {
  return [capture.author, capture.handle].filter(Boolean).join(' ');
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fallback for extension contexts where Clipboard API permission is unavailable.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.append(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

export default function InlineSavePanel({
  currentTab,
  initialCapture,
  pendingCaptures,
  settings,
  onCapture,
  onOpenCollection,
  onOpenSettings,
  onRefresh,
  onRemovePendingCapture,
}: InlineSavePanelProps) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(Boolean(initialCapture));
  const [capture, setCapture] = useState<CapturedContent | undefined>(initialCapture);
  const [tagsText, setTagsText] = useState(initialCapture?.tags.join(', ') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StructuredError | undefined>();
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!initialCapture) {
      return;
    }

    setCapture(initialCapture);
    setTagsText(initialCapture.tags.join(', '));
    setExpanded(true);
  }, [initialCapture]);

  const pendingCount = pendingCaptures.length;
  const source = currentTab?.source;
  const canExtract = Boolean(source);
  const pathPreview = useMemo(() => {
    if (!capture) {
      return '';
    }

    return buildCaptureExportPath(capture, settings.exportDirectory).join('/');
  }, [capture, settings.exportDirectory]);

  const extract = async () => {
    if (!source) {
      return;
    }

    setBusy(true);
    setError(undefined);
    setStatus('');
    try {
      const nextCapture = await onCapture(source);
      setCapture(nextCapture);
      setTagsText(nextCapture.tags.join(', '));
      setExpanded(true);
      setStatus(`${sourceLabel(nextCapture.source)}正文已提取，确认后写入 Vault。`);
    } catch (extractError) {
      setError(toStructuredError(extractError));
    } finally {
      setBusy(false);
    }
  };

  const saveToVault = async () => {
    if (!capture) {
      return;
    }

    setBusy(true);
    setError(undefined);
    setStatus('');
    try {
      const handle = await getVaultHandle();
      if (!handle) {
        throw new Error('请先选择 Obsidian Vault 目录');
      }

      const allowed = await checkVaultPermission(handle);
      if (!allowed) {
        throw new Error('没有 Vault 写入权限，请重新选择目录');
      }

      const tags = tagsText
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
      const result = await exportCaptureToVault(
        handle,
        {
          ...capture,
          tags,
        },
        settings.exportDirectory,
        settings,
      );
      const filePath = result.files[0] ?? pathPreview;
      await onRemovePendingCapture(capture.id);
      await onRefresh();
      setStatus(`已写入：${filePath}`);
      setCapture(undefined);
      setExpanded(false);
      toast({
        kind: 'success',
        message: `已写入：${filePath}`,
        action: {
          label: '复制路径',
          onClick: () => copyToClipboard(filePath),
        },
      });
    } catch (saveError) {
      setError(toStructuredError(saveError));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (capture) {
      await onRemovePendingCapture(capture.id).catch(() => undefined);
      await onRefresh().catch(() => undefined);
    }
    setCapture(undefined);
    setExpanded(false);
    setError(undefined);
    setStatus('');
  };

  if (!canExtract && !capture) {
    return null;
  }

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" />
          保存当前页面到 Obsidian
          {capture ? <Badge variant="success">已提取</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <Alert variant="destructive">
            <div className="space-y-1">
              <div>{error.message}</div>
              {error.suggestion ? (
                <div className="text-xs text-muted-foreground">{error.suggestion}</div>
              ) : null}
            </div>
          </Alert>
        ) : null}
        {status ? <Alert variant="success">{status}</Alert> : null}

        {!expanded ? (
          <div className="space-y-3">
            <div className="min-w-0 text-xs text-muted-foreground">
              <div className="truncate">
                {currentTab?.title || currentTab?.url || '当前页面可提取正文'}
              </div>
              {currentTab?.url ? (
                <div className="mt-1 truncate">{hostFromUrl(currentTab.url)}</div>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button disabled={!source || busy} loading={busy} onClick={extract}>
                {source ? sourceActionLabel(source) : '当前页面不可提取'}
              </Button>
              {pendingCount > 0 ? (
                <Button onClick={onOpenCollection} variant="outline">
                  查看待入库 {pendingCount}
                </Button>
              ) : (
                <Button onClick={onOpenSettings} variant="outline">
                  <FolderOpen className="h-4 w-4" />
                  设置 Vault
                </Button>
              )}
            </div>
          </div>
        ) : null}

        {expanded && capture ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate text-sm font-medium">{capture.title}</div>
                <Badge variant="outline">{sourceLabel(capture.source)}</Badge>
              </div>
              <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                <span>{capture.siteName ?? hostFromUrl(capture.url)}</span>
                {captureAuthorLine(capture) ? <span>{captureAuthorLine(capture)}</span> : null}
                <span>{capture.wordCount ?? 0} 字</span>
                <span>{capture.media.length} 媒体</span>
              </div>
            </div>

            <div className="max-h-28 overflow-y-auto rounded-md bg-card p-2 text-xs leading-5">
              <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {capture.text.slice(0, 480)}
                {capture.text.length > 480 ? '\n\n...' : ''}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>标签</Label>
              <Input
                onChange={(event) => setTagsText(event.target.value)}
                placeholder="twitter, security"
                value={tagsText}
              />
            </div>

            <div className="space-y-1.5">
              <Label>写入路径</Label>
              <div className="truncate rounded-md border border-border bg-muted px-2 py-2 text-xs">
                {pathPreview}
              </div>
            </div>

            <div className="grid grid-cols-[1fr_auto_auto] gap-2">
              <Button disabled={busy} loading={busy} onClick={saveToVault}>
                <Save className="h-4 w-4" />
                写入 Vault
              </Button>
              <Button onClick={onOpenCollection} variant="outline">
                <CheckCircle2 className="h-4 w-4" />
                加入队列
              </Button>
              <Button onClick={cancel} size="icon" title="取消" variant="ghost">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
