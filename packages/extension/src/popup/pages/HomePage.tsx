import { Activity, CheckCircle2, History, Settings, Sparkles } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { Separator } from '../../components/ui/separator.js';
import type { OnboardingProgress } from '../../utils/onboarding.js';
import InlineSavePanel, { type CurrentTabInfo } from './InlineSavePanel.js';
import { OnboardingChecklist } from './OnboardingChecklist.js';

interface HomePageProps {
  readonly bookmarkCount: number;
  readonly busy: boolean;
  readonly currentTab?: CurrentTabInfo;
  readonly folderCount: number;
  readonly onboarded: boolean;
  readonly onboardingProgress: OnboardingProgress;
  onCreatePlan(): void;
  onOpenActivity(): void;
  onOpenCollection(): void;
  onOpenHealth(): void;
  onOpenOrganize(): void;
  onOpenSettings(): void;
  onSaveCurrentX(): Promise<void>;
  onSkipOnboarding(): void;
}

function MetricNumber({ children }: { children: number | string }) {
  return <span className="font-serif tabular-nums text-foreground">{children}</span>;
}

export default function HomePage({
  bookmarkCount,
  busy,
  currentTab,
  folderCount,
  onboarded,
  onboardingProgress,
  onCreatePlan,
  onOpenActivity,
  onOpenCollection,
  onOpenHealth,
  onOpenOrganize,
  onOpenSettings,
  onSaveCurrentX,
  onSkipOnboarding,
}: HomePageProps) {
  const saveIsPrimary = Boolean(currentTab?.canSaveX);

  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight">当前任务</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            <MetricNumber>{bookmarkCount}</MetricNumber> 个书签 ·{' '}
            <MetricNumber>{folderCount}</MetricNumber> 个文件夹
          </p>
        </div>
        <Button onClick={onOpenSettings} size="icon" title="设置" variant="ghost">
          <Settings className="h-4 w-4" />
        </Button>
      </header>

      {!onboarded ? (
        <OnboardingChecklist
          compact
          onOpenCollect={onOpenCollection}
          onOpenOrganize={onOpenOrganize}
          onOpenSettings={onOpenSettings}
          onSkip={onSkipOnboarding}
          progress={onboardingProgress}
        />
      ) : null}

      {saveIsPrimary ? (
        <InlineSavePanel
          busy={busy}
          currentTab={currentTab}
          onSaveCurrentX={onSaveCurrentX}
          prominent
        />
      ) : (
        <Card className="bg-primary/5" variant="soft">
          <CardContent className="space-y-4 p-4">
            <div>
              <h2 className="text-base font-semibold">整理 Chrome 书签</h2>
              <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                先生成本地建议。只有你确认后才会移动真实书签。
              </p>
            </div>
            <Button
              className="h-10 w-full"
              disabled={busy || bookmarkCount === 0}
              onClick={onCreatePlan}
            >
              <Sparkles className="h-4 w-4" />
              开始整理
            </Button>
          </CardContent>
        </Card>
      )}

      <Separator />

      <div className="grid grid-cols-2 gap-2">
        {saveIsPrimary ? (
          <Button disabled={busy || bookmarkCount === 0} onClick={onCreatePlan} variant="outline">
            <Sparkles className="h-4 w-4" />
            整理书签
          </Button>
        ) : (
          <Button onClick={onOpenCollection} variant="outline">
            查看内容同步
          </Button>
        )}
        <Button disabled={busy || bookmarkCount === 0} onClick={onOpenHealth} variant="outline">
          <Activity className="h-4 w-4" />
          检查历史
        </Button>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
        <button className="hover:text-foreground" onClick={onOpenOrganize} type="button">
          浏览书签
        </button>
        <button className="hover:text-foreground" onClick={onOpenActivity} type="button">
          <History className="mr-1 inline h-3.5 w-3.5" />
          历史记录
        </button>
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
          写入前必须复核
        </span>
      </div>
    </section>
  );
}
