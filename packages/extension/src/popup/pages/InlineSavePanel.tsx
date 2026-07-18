import { BookmarkPlus } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';

export interface CurrentTabInfo {
  readonly title?: string;
  readonly url: string;
  readonly canSaveX: boolean;
}

interface InlineSavePanelProps {
  readonly busy: boolean;
  readonly currentTab?: CurrentTabInfo;
  readonly prominent?: boolean;
  onSaveCurrentX(): Promise<void>;
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'x.com';
  }
}

export default function InlineSavePanel({
  busy,
  currentTab,
  prominent = false,
  onSaveCurrentX,
}: InlineSavePanelProps) {
  if (!currentTab?.canSaveX) {
    return null;
  }

  return (
    <Card className={prominent ? 'bg-primary/5' : 'bg-transparent'} variant="soft">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <BookmarkPlus className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">保存当前 X 内容</h2>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
              只读取当前详情页。提取结果先进入复核，不会直接写入 Vault。
            </p>
          </div>
        </div>

        <div className="min-w-0 rounded-md bg-background/70 px-3 py-2 text-[13px]">
          <div className="truncate font-medium">{currentTab.title || '当前 X 帖子'}</div>
          <div className="mt-1 text-xs text-muted-foreground">{hostFromUrl(currentTab.url)}</div>
        </div>

        <Button
          className="h-10 w-full"
          disabled={busy}
          loading={busy}
          onClick={() => void onSaveCurrentX()}
        >
          <BookmarkPlus className="h-4 w-4" />
          加入安全复核
        </Button>
      </CardContent>
    </Card>
  );
}
