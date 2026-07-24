import { Clock, FolderOpen, ShieldCheck } from 'lucide-react';

import type { ExportManifest } from '../../shared/bookmark-types.js';
import { Alert } from '../../components/ui/alert.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import InlineSavePanel, { type CurrentTabInfo } from './InlineSavePanel.js';

interface CollectionPageProps {
  readonly busy: boolean;
  readonly currentTab?: CurrentTabInfo;
  readonly exportManifests: ExportManifest[];
  onOpenSettings(): void;
  onSaveCurrentX(): Promise<void>;
}

function isContentManifest(manifest: ExportManifest): boolean {
  return manifest.type === 'capture' || (!manifest.type && manifest.bookmarkCount <= 5);
}

export default function CollectionPage({
  busy,
  currentTab,
  exportManifests,
  onOpenSettings,
  onSaveCurrentX,
}: CollectionPageProps) {
  const recent = exportManifests.filter(isContentManifest).slice(0, 5);

  return (
    <section className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <InlineSavePanel
        busy={busy}
        currentTab={currentTab}
        onSaveCurrentX={onSaveCurrentX}
        prominent
      />

      {!currentTab?.canSaveX ? (
        <Alert>
          打开一条精确的 <code>x.com/.../status/...</code>{' '}
          详情页后，可在这里把当前内容加入安全复核。
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            内容同步边界
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-[13px] leading-5 text-muted-foreground">
          <p>当前仅支持 X 单条详情页和 X 收藏页。提取结果先进入复核，不会直接写入 Vault。</p>
          <p>普通网页与微博的旧提取入口已停用；旧待保存数据可在设置中查看摘要并手动清除。</p>
          <Button onClick={onOpenSettings} size="sm" variant="outline">
            <FolderOpen className="h-4 w-4" />
            Vault 与维护设置
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            历史写入
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recent.length === 0 ? (
            <p className="text-xs text-muted-foreground">还没有可显示的历史写入记录。</p>
          ) : (
            recent.map((manifest) => (
              <div className="flex items-center gap-2 text-xs" key={manifest.id}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {manifest.fileLabels?.[0] ?? manifest.files[0] ?? '历史内容'}
                  </div>
                  <div className="mt-0.5 text-muted-foreground">
                    {new Date(manifest.exportedAt).toLocaleString()}
                  </div>
                </div>
                <Badge variant="secondary">{manifest.bookmarkCount} 条</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </section>
  );
}
