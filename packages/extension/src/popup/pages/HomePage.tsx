import { Activity, BookOpen, CheckCircle2, History, Settings, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AppSettings, CapturedContent, ExportManifest } from '../../shared/bookmark-types.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { Separator } from '../../components/ui/separator.js';
import type { OnboardingProgress } from '../../utils/onboarding.js';
import { OnboardingChecklist } from './OnboardingChecklist.js';
import InlineSavePanel, { type CurrentTabInfo, type InlineSaveSource } from './InlineSavePanel.js';

interface HomePageProps {
  bookmarkCount: number;
  busy: boolean;
  currentTab?: CurrentTabInfo;
  exportManifests: ExportManifest[];
  folderCount: number;
  initialCapture?: CapturedContent;
  onboarded: boolean;
  onboardingProgress: OnboardingProgress;
  pendingCaptures: CapturedContent[];
  settings: AppSettings;
  onCapture(source: InlineSaveSource): Promise<CapturedContent>;
  onCreatePlan(): void;
  onOpenCollection(): void;
  onOpenHealth(): void;
  onOpenSettings(): void;
  onOpenOrganize(): void;
  onOpenActivity(): void;
  onRefresh(): Promise<void>;
  onRemovePendingCapture(id: string): Promise<void>;
  onSkipOnboarding(): void;
}

interface SecondaryActionProps {
  title: string;
  description: string;
  action: string;
  disabled?: boolean;
  badge?: string;
  icon: LucideIcon;
  onClick(): void;
}

function lastSavedLabel(manifests: ExportManifest[]): string | undefined {
  const last = manifests[0];
  if (!last) {
    return undefined;
  }

  return `上次保存 ${new Date(last.exportedAt).toLocaleDateString()}`;
}

function MetricNumber({ children }: { children: number | string }) {
  return <span className="font-serif tabular-nums text-foreground">{children}</span>;
}

function SecondaryAction({
  title,
  description,
  action,
  disabled,
  badge,
  icon: Icon,
  onClick,
}: SecondaryActionProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/60">
      <div className="rounded-md bg-muted p-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-medium">{title}</h3>
          {badge ? <Badge variant="accent">{badge}</Badge> : null}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>
      </div>
      <Button disabled={disabled} onClick={onClick} size="sm" variant="outline">
        {action}
      </Button>
    </div>
  );
}

export default function HomePage({
  bookmarkCount,
  busy,
  currentTab,
  exportManifests,
  folderCount,
  initialCapture,
  onboarded,
  onboardingProgress,
  pendingCaptures,
  settings,
  onCapture,
  onCreatePlan,
  onOpenActivity,
  onOpenCollection,
  onOpenHealth,
  onOpenOrganize,
  onOpenSettings,
  onRefresh,
  onRemovePendingCapture,
  onSkipOnboarding,
}: HomePageProps) {
  const pendingCount = pendingCaptures.length;
  const savedLabel = lastSavedLabel(exportManifests);
  const saveIsPrimary = Boolean(currentTab?.source || initialCapture);

  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight">
            今天要做什<span className="font-serif font-bold">么</span>？
          </h1>
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
          currentTab={currentTab}
          initialCapture={initialCapture}
          onCapture={onCapture}
          onOpenCollection={onOpenCollection}
          onOpenSettings={onOpenSettings}
          onRefresh={onRefresh}
          onRemovePendingCapture={onRemovePendingCapture}
          pendingCaptures={pendingCaptures}
          prominent
          settings={settings}
        />
      ) : (
        <Card className="bg-primary/5" variant="soft">
          <CardContent className="space-y-4 p-4">
            <div className="space-y-2">
              <div className="inline-flex rounded-md bg-primary/10 p-2 text-primary">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold">整理我的书签</h2>
                <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                  生成分类建议，确认后才移动真实 Chrome 书签。
                </p>
              </div>
            </div>
            <Button
              className="h-10 w-full"
              disabled={busy || bookmarkCount === 0}
              onClick={onCreatePlan}
            >
              <Sparkles className="h-4 w-4" />
              整理我的书签
            </Button>
          </CardContent>
        </Card>
      )}

      <Separator />

      <div className="space-y-1">
        {saveIsPrimary ? (
          <SecondaryAction
            action="整理"
            description={`${bookmarkCount} 个书签，确认后才移动`}
            disabled={busy || bookmarkCount === 0}
            icon={Sparkles}
            onClick={onCreatePlan}
            title="AI 整理书签"
          />
        ) : null}
        <SecondaryAction
          action="检查"
          description="找出死链、错误和重定向"
          disabled={busy || bookmarkCount === 0}
          icon={Activity}
          onClick={onOpenHealth}
          title="检查失效链接"
        />
        {pendingCount > 0 ? (
          <SecondaryAction
            action="处理"
            badge={String(pendingCount)}
            description={savedLabel ?? '确认后写入 Vault'}
            icon={BookOpen}
            onClick={onOpenCollection}
            title="待入库内容"
          />
        ) : null}
      </div>

      <Separator />

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
          关键操作都会先确认
        </span>
      </div>
    </section>
  );
}
