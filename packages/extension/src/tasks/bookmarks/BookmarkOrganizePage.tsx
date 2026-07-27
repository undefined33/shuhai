import { CircleStop, Sparkles } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { Progress } from '../../components/ui/progress.js';
import { Alert } from '../../components/ui/alert.js';
import type {
  BookmarkItem,
  ClassificationMode,
  ClassificationPlan,
  ClassificationProgress,
  FolderItem,
  MovePlan,
} from '../../shared/bookmark-types.js';
import BookmarkTree from '../../popup/pages/BookmarkTree.js';
import ClassifyPreview from '../../popup/pages/ClassifyPreview.js';

interface BookmarkOrganizePageProps {
  readonly bookmarks: BookmarkItem[];
  readonly busy: boolean;
  readonly classificationProgress?: ClassificationProgress;
  readonly classifyMode: ClassificationMode;
  readonly folders: FolderItem[];
  readonly mutationBlocked: boolean;
  readonly plan?: ClassificationPlan;
  readonly onApplyPlan: () => void;
  readonly onCancelClassification: () => void;
  readonly onClassifyModeChange: (mode: ClassificationMode) => void;
  readonly onCreatePlan: () => void;
  readonly onDiscardPlan: () => void;
  readonly onMoveChange: (move: MovePlan) => void;
  readonly onRefresh: () => void;
}

function progressPercent(progress: ClassificationProgress): number {
  if (progress.total <= 0) return 0;
  return Math.min(100, Math.round((progress.done / progress.total) * 100));
}

export default function BookmarkOrganizePage({
  bookmarks,
  busy,
  classificationProgress,
  classifyMode,
  folders,
  mutationBlocked,
  plan,
  onApplyPlan,
  onCancelClassification,
  onClassifyModeChange,
  onCreatePlan,
  onDiscardPlan,
  onMoveChange,
  onRefresh,
}: BookmarkOrganizePageProps) {
  if (classificationProgress) {
    const percent = progressPercent(classificationProgress);
    return (
      <section
        aria-label="整理建议生成进度"
        aria-live="polite"
        className="mx-auto flex min-h-[26rem] w-full max-w-xl flex-col justify-center"
        role="status"
      >
        <p className="text-[12.5px] font-medium text-primary">正在分析</p>
        <h2 className="mt-1 text-lg font-semibold">生成整理建议</h2>
        <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
          当前只生成建议，不会移动或删除任何 Chrome 书签。
        </p>
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between gap-3 text-[13px]">
            <span>
              已分析 {classificationProgress.done.toLocaleString()} /{' '}
              {classificationProgress.total.toLocaleString()}
            </span>
            <span className="font-medium tabular-nums">{percent}%</span>
          </div>
          <Progress max={100} value={percent} />
          {classificationProgress.totalBatches > 0 ? (
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              批次 {classificationProgress.batch} / {classificationProgress.totalBatches}
            </p>
          ) : null}
        </div>
        <Button className="mt-6 self-start" onClick={onCancelClassification} variant="outline">
          <CircleStop aria-hidden="true" className="h-4 w-4" />
          取消本次分析
        </Button>
      </section>
    );
  }

  if (plan) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        {mutationBlocked ? (
          <Alert variant="warning">
            当前无法读取操作日志。可以继续复核建议，但恢复记录可用前不能应用更改。
          </Alert>
        ) : null}
        <ClassifyPreview
          applyDisabled={mutationBlocked}
          busy={busy}
          folders={folders}
          onApply={onApplyPlan}
          onCancel={onDiscardPlan}
          onMoveChange={onMoveChange}
          plan={plan}
          selectedCount={plan.moves.filter((move) => move.selected).length}
          surface="sidepanel"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <section
        aria-labelledby="classification-mode-title"
        className="shrink-0 border-b border-border pb-4"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold" id="classification-mode-title">
              整理范围
            </h2>
            <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
              先生成建议，逐项复核后才会进入确认。
            </p>
          </div>
          <Button disabled={busy || bookmarks.length === 0} loading={busy} onClick={onCreatePlan}>
            <Sparkles aria-hidden="true" className="h-4 w-4" />
            生成整理建议
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-2 rounded-md border border-border p-1">
          <button
            aria-pressed={classifyMode === 'safe'}
            className={
              classifyMode === 'safe'
                ? 'min-h-9 rounded bg-muted px-3 text-[13px] font-medium text-foreground'
                : 'min-h-9 rounded px-3 text-[13px] text-muted-foreground hover:bg-muted'
            }
            disabled={busy}
            onClick={() => onClassifyModeChange('safe')}
            type="button"
          >
            规则优先
          </button>
          <button
            aria-pressed={classifyMode === 'full'}
            className={
              classifyMode === 'full'
                ? 'min-h-9 rounded bg-muted px-3 text-[13px] font-medium text-foreground'
                : 'min-h-9 rounded px-3 text-[13px] text-muted-foreground hover:bg-muted'
            }
            disabled={busy}
            onClick={() => onClassifyModeChange('full')}
            type="button"
          >
            重新审视全部
          </button>
        </div>
      </section>

      {mutationBlocked ? (
        <Alert variant="warning">
          当前无法读取操作日志。可以继续浏览和生成建议，但恢复记录可用前不能应用更改。
        </Alert>
      ) : null}

      <BookmarkTree
        bookmarks={bookmarks}
        busy={busy}
        folders={folders}
        onRefresh={onRefresh}
        surface="sidepanel"
      />
    </div>
  );
}
