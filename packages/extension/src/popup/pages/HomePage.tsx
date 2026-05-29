import {
  Activity,
  BookOpen,
  CheckCircle2,
  FolderOpen,
  History,
  Settings,
  Sparkles,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { AppSettings, CapturedContent, ExportManifest } from '../../shared/bookmark-types.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
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

interface TaskCardProps {
  action: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  meta?: string;
  title: string;
  disabled?: boolean;
  badge?: string;
  onClick(): void;
}

function TaskCard({
  action,
  description,
  icon: Icon,
  meta,
  title,
  disabled,
  badge,
  onClick,
}: TaskCardProps) {
  return (
    <Card>
      <CardContent className="space-y-3 p-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">{title}</h2>
              {badge ? <Badge variant="success">{badge}</Badge> : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            {meta ? <p className="mt-1 text-[11px] text-muted-foreground">{meta}</p> : null}
          </div>
        </div>
        <Button className="w-full" disabled={disabled} onClick={onClick}>
          {action}
        </Button>
      </CardContent>
    </Card>
  );
}

function lastSavedLabel(manifests: ExportManifest[]): string | undefined {
  const last = manifests[0];
  if (!last) {
    return undefined;
  }

  return `上次保存 ${new Date(last.exportedAt).toLocaleDateString()}`;
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

  return (
    <section className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-semibold tracking-tight">ShuHai</h1>
            <p className="text-xs text-muted-foreground">
              {bookmarkCount} 书签 · {folderCount} 文件夹
            </p>
          </div>
          <Button onClick={onOpenSettings} size="sm" variant="ghost">
            <Settings className="h-4 w-4" />
            设置
          </Button>
        </div>
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

      <InlineSavePanel
        currentTab={currentTab}
        initialCapture={initialCapture}
        onCapture={onCapture}
        onOpenCollection={onOpenCollection}
        onOpenSettings={onOpenSettings}
        onRefresh={onRefresh}
        onRemovePendingCapture={onRemovePendingCapture}
        pendingCaptures={pendingCaptures}
        settings={settings}
      />

      <TaskCard
        action="开始整理"
        description="分析你的 Chrome 书签，生成移动建议，确认后再改真实书签。"
        disabled={busy || bookmarkCount === 0}
        icon={Sparkles}
        meta={`${bookmarkCount} 个书签`}
        onClick={onCreatePlan}
        title="AI 整理书签"
      />

      <TaskCard
        action="开始检查"
        description="找出死链、检查失败和重定向链接，再由你决定删除或替换。"
        disabled={busy || bookmarkCount === 0}
        icon={Activity}
        onClick={onOpenHealth}
        title="检查失效链接"
      />

      {pendingCount > 0 ? (
        <TaskCard
          action="查看待入库"
          badge={String(pendingCount)}
          description="这些内容已经提取到 ShuHai，等待确认后写入 Obsidian。"
          icon={BookOpen}
          meta={savedLabel}
          onClick={onOpenCollection}
          title="待入库"
        />
      ) : null}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <Button onClick={onOpenOrganize} size="sm" variant="outline">
            <FolderOpen className="h-4 w-4" />
            浏览书签
          </Button>
          <Button onClick={onOpenActivity} size="sm" variant="outline">
            <History className="h-4 w-4" />
            历史记录
          </Button>
          <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5" />
            需要确认才会写入或移动
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
