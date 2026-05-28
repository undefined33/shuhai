import { useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, HelpCircle, ShieldAlert } from 'lucide-react';
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
import { Command, CommandInput, CommandList } from '../../components/ui/command.js';
import { ScrollArea } from '../../components/ui/scroll-area.js';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../components/ui/tooltip.js';

interface ClassifyPreviewProps {
  plan: ClassificationPlan;
  folders: FolderItem[];
  busy: boolean;
  selectedCount: number;
  onMoveChange(move: MovePlan): void;
  onApply(): void;
  onCancel(): void;
  surface?: 'popup' | 'sidepanel';
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
    ? '安全模式下，已有文件夹中的书签不会被重新分类。返回书签页切换为全量模式可以重新审视全部书签。'
    : '全量模式没有发现需要调整的书签。可以回到书签页修改自定义规则后再生成。';
}

interface FolderComboboxProps {
  folders: FolderItem[];
  value: string;
  onChange(value: string): void;
}

function FolderCombobox({ folders, value, onChange }: FolderComboboxProps) {
  const [open, setOpen] = useState(false);
  const keyword = value.trim().toLowerCase();
  const filteredFolders = useMemo(
    () =>
      folders
        .filter((folder) => folder.path)
        .filter((folder) => !keyword || folder.path.toLowerCase().includes(keyword))
        .sort((a, b) => b.bookmarkCount - a.bookmarkCount || a.path.localeCompare(b.path))
        .slice(0, 8),
    [folders, keyword],
  );
  const hasExactMatch = filteredFolders.some((folder) => folder.path === value);

  return (
    <Command className="relative overflow-visible">
      <CommandInput
        className="text-xs"
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="搜索或输入新文件夹"
        value={value}
      />
      {open ? (
        <CommandList className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 rounded-lg border border-border bg-popover shadow-lg">
          {value.trim() && !hasExactMatch ? (
            <button
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-muted"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(value);
                setOpen(false);
              }}
              type="button"
            >
              <span className="min-w-0 flex-1 truncate">创建：{value}</span>
              <Badge variant="outline">新分类</Badge>
            </button>
          ) : null}
          {filteredFolders.map((folder) => (
            <button
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-muted"
              key={folder.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(folder.path);
                setOpen(false);
              }}
              type="button"
            >
              <span className="min-w-0 flex-1 truncate">{folder.path}</span>
              <Badge variant="secondary">{folder.bookmarkCount}</Badge>
            </button>
          ))}
          {filteredFolders.length === 0 && !value.trim() ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">输入文件夹路径开始创建。</div>
          ) : null}
        </CommandList>
      ) : null}
    </Command>
  );
}

export default function ClassifyPreview({
  plan,
  folders,
  busy,
  selectedCount,
  onMoveChange,
  onApply,
  onCancel,
  surface = 'popup',
}: ClassifyPreviewProps) {
  const moveGridClass =
    surface === 'sidepanel'
      ? 'grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1.25fr)] items-center gap-2'
      : 'grid grid-cols-[1fr_auto_1fr] items-center gap-2';

  return (
    <TooltipProvider>
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

                <div className={moveGridClass}>
                  <span className="truncate rounded-md bg-muted px-2 py-1 text-[11px]">
                    {move.currentFolder || '根目录'}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <FolderCombobox
                    folders={folders}
                    onChange={(targetFolder) =>
                      onMoveChange({
                        ...move,
                        targetFolder,
                      })
                    }
                    value={move.targetFolder}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={move.reason === 'ai' ? 'default' : 'outline'}>
                    {move.reason === 'ai' ? 'AI' : move.ruleName ?? '规则'}
                  </Badge>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Badge variant={confidenceVariant(move.confidence)}>
                          {confidenceLabel(move.confidence)}
                        </Badge>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>置信度越高，表示 AI 或规则越确定这个分类。</TooltipContent>
                  </Tooltip>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
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
    </section>
    </TooltipProvider>
  );
}
