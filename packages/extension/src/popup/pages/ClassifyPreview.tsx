import { ArrowRight, CheckCircle2, ShieldAlert } from 'lucide-react';
import type {
  ClassificationPlan,
  FolderItem,
  MovePlan,
} from '../../shared/bookmark-types.js';
import { Alert } from '../../components/ui/alert.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { Checkbox } from '../../components/ui/checkbox.js';
import { Input } from '../../components/ui/input.js';
import { ScrollArea } from '../../components/ui/scroll-area.js';

interface ClassifyPreviewProps {
  plan: ClassificationPlan;
  folders: FolderItem[];
  busy: boolean;
  selectedCount: number;
  onMoveChange(move: MovePlan): void;
  onApply(): void;
  onCancel(): void;
}

function confidenceLabel(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function confidenceVariant(confidence: number): 'success' | 'warning' | 'danger' {
  if (confidence > 0.8) {
    return 'success';
  }

  if (confidence >= 0.6) {
    return 'warning';
  }

  return 'danger';
}

function emptyReason(plan: ClassificationPlan): string {
  return plan.mode === 'safe'
    ? '安全模式下，已有文件夹中的书签不会被重新分类。'
    : '全量模式没有发现需要调整的书签。';
}

export default function ClassifyPreview({
  plan,
  folders,
  busy,
  selectedCount,
  onMoveChange,
  onApply,
  onCancel,
}: ClassifyPreviewProps) {
  const folderPaths = folders.map((folder) => folder.path).filter(Boolean);

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        <Card>
          <CardContent className="p-3">
            <div className="text-xl font-semibold">{plan.moves.length}</div>
            <div className="text-[11px] text-muted-foreground">建议</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xl font-semibold">{selectedCount}</div>
            <div className="text-[11px] text-muted-foreground">选中</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xl font-semibold">{plan.unchanged}</div>
            <div className="text-[11px] text-muted-foreground">不动</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={onCancel} disabled={busy} variant="ghost">
          返回
        </Button>
        <Button
          className="flex-1"
          disabled={busy || selectedCount === 0}
          loading={busy}
          onClick={onApply}
        >
          <CheckCircle2 className="h-4 w-4" />
          应用选中
        </Button>
      </div>

      <Alert variant="warning">
        当前为{plan.mode === 'safe' ? '仅整理未分类' : '重新分类全部'}模式；应用前不会修改 Chrome 书签。
      </Alert>

      {plan.moves.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
            <ShieldAlert className="h-7 w-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{emptyReason(plan)}</p>
          </CardContent>
        </Card>
      ) : null}

      {plan.newFolders.length > 0 ? (
        <Alert>
          将创建 {plan.newFolders.length} 个新文件夹：{plan.newFolders.slice(0, 8).join('、')}
          {plan.newFolders.length > 8 ? '…' : ''}
        </Alert>
      ) : null}

      <ScrollArea className="min-h-0 flex-1 rounded-lg">
        <div className="space-y-2 pr-2">
          {plan.moves.map((move, index) => (
            <Card
              className="transition hover:border-primary/40"
              key={move.id}
              style={{ animationDelay: `${Math.min(index, 12) * 18}ms` }}
            >
              <CardContent className="space-y-2 p-3">
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={move.selected}
                    onCheckedChange={(checked) =>
                      onMoveChange({
                        ...move,
                        selected: checked === true,
                      })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{move.bookmarkTitle}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {move.bookmarkUrl}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <span className="truncate rounded-md bg-muted px-2 py-1 text-[11px]">
                    {move.currentFolder || '根目录'}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    className="h-8 text-xs"
                    list="folder-paths"
                    onChange={(event) =>
                      onMoveChange({
                        ...move,
                        targetFolder: event.target.value,
                      })
                    }
                    value={move.targetFolder}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={move.reason === 'ai' ? 'default' : 'outline'}>
                    {move.reason === 'ai' ? 'AI' : move.ruleName ?? '规则'}
                  </Badge>
                  <Badge variant={confidenceVariant(move.confidence)}>
                    {confidenceLabel(move.confidence)}
                  </Badge>
                  {move.confidence < 0.6 ? <Badge variant="danger">需确认</Badge> : null}
                  {plan.mode === 'full' && !move.selected ? (
                    <Badge variant="warning">默认未选</Badge>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>

      <datalist id="folder-paths">
        {folderPaths.map((path) => (
          <option key={path} value={path} />
        ))}
      </datalist>
    </section>
  );
}
