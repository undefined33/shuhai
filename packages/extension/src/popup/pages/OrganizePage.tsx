import { useMemo, useState } from 'react';
import { Bookmark, CheckCircle2, Download, FolderTree, GitBranch, Sparkles } from 'lucide-react';
import type {
  AppSettings,
  BackupRecord,
  BookmarkItem,
  ClassificationMode,
  ClassificationPlan,
  ExportManifest,
  FolderItem,
  MovePlan,
} from '../../shared/bookmark-types.js';
import { Alert } from '../../components/ui/alert.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import BookmarkIndexExportPanel from './BookmarkIndexExportPanel.js';
import BookmarkTree from './BookmarkTree.js';
import ClassifyPreview from './ClassifyPreview.js';

export type OrganizeMode = 'browse' | 'plan';

function MetricNumber({ children }: { children: number | string }) {
  return <span className="font-serif tabular-nums text-foreground">{children}</span>;
}

interface OrganizePageProps {
  backups: BackupRecord[];
  bookmarks: BookmarkItem[];
  busy: boolean;
  canUndo: boolean;
  classifying: boolean;
  classifyMode: ClassificationMode;
  exportBookmarks: BookmarkItem[];
  exportManifests: ExportManifest[];
  folders: FolderItem[];
  lastAppliedCount: number;
  mode: OrganizeMode;
  plan?: ClassificationPlan;
  selectedCount: number;
  selectedMoveIds: string[];
  settings: AppSettings;
  surface?: 'popup' | 'sidepanel';
  onApplyPlan(): void;
  onCancelPlan(): void;
  onClassifyModeChange(mode: ClassificationMode): void;
  onCreatePlan(mode: ClassificationMode): void;
  onDownloadBackup(backup: BackupRecord): void;
  onModeChange(mode: OrganizeMode): void;
  onMoveChange(move: MovePlan): void;
  onOpenHealth(): void;
  onOpenHome(): void;
  onRefresh(): Promise<void>;
  onUndo(): void;
}

export default function OrganizePage({
  backups,
  bookmarks,
  busy,
  canUndo,
  classifying,
  classifyMode,
  exportBookmarks,
  exportManifests,
  folders,
  lastAppliedCount,
  mode,
  plan,
  selectedCount,
  selectedMoveIds,
  settings,
  surface = 'popup',
  onApplyPlan,
  onCancelPlan,
  onClassifyModeChange,
  onCreatePlan,
  onDownloadBackup,
  onModeChange,
  onMoveChange,
  onOpenHealth,
  onOpenHome,
  onRefresh,
  onUndo,
}: OrganizePageProps) {
  const [showIndexTool, setShowIndexTool] = useState(false);
  const selectedPlanCount = useMemo(() => plan?.moves.length ?? 0, [plan]);

  const createPlan = (modeToCreate = classifyMode) => {
    onModeChange('plan');
    onCreatePlan(modeToCreate);
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <Card>
        <CardContent className="space-y-3 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">整理书签</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                浏览书签、生成整理建议，确认后再移动真实 Chrome 书签。
              </p>
            </div>
            <Badge variant={selectedPlanCount > 0 ? 'accent' : 'outline'}>
              {selectedPlanCount > 0 ? `${selectedPlanCount} 条建议` : '待生成建议'}
            </Badge>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md bg-muted/50 p-2">
              <div className="text-lg font-semibold">
                <MetricNumber>{bookmarks.length}</MetricNumber>
              </div>
              <div className="text-[11px] text-muted-foreground">书签</div>
            </div>
            <div className="rounded-md bg-muted/50 p-2">
              <div className="text-lg font-semibold">
                <MetricNumber>{folders.length}</MetricNumber>
              </div>
              <div className="text-[11px] text-muted-foreground">文件夹</div>
            </div>
            <div className="rounded-md bg-muted/50 p-2">
              <div className="text-lg font-semibold">
                <MetricNumber>{plan?.moves.length ?? 0}</MetricNumber>
              </div>
              <div className="text-[11px] text-muted-foreground">整理建议</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button disabled={busy || bookmarks.length === 0} onClick={() => createPlan()}>
              <Sparkles className="h-4 w-4" />
              整理书签
            </Button>
            <Button disabled={busy || !canUndo} onClick={onUndo} variant="outline">
              撤销上次整理
            </Button>
          </div>
        </CardContent>
      </Card>

      {lastAppliedCount > 0 ? (
        <Alert variant="success">
          <div className="space-y-2">
            <CheckCircle2 className="animate-check-pop h-5 w-5 text-primary" />
            <p>
              已整理 <MetricNumber>{lastAppliedCount}</MetricNumber> 个书签。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => setShowIndexTool((current) => !current)}
                size="sm"
                variant="outline"
              >
                <Download className="h-3.5 w-3.5" />
                {showIndexTool ? '收起书签目录' : '生成书签目录'}
              </Button>
              <Button onClick={onOpenHealth} size="sm" variant="outline">
                查看链接历史
              </Button>
              <Button onClick={onOpenHome} size="sm" variant="ghost">
                返回首页
              </Button>
            </div>
          </div>
        </Alert>
      ) : null}

      {showIndexTool ? (
        <BookmarkIndexExportPanel
          bookmarks={exportBookmarks}
          exportManifests={exportManifests}
          onRefresh={onRefresh}
          plan={plan}
          selectedMoveIds={selectedMoveIds}
          settings={settings}
          surface={surface}
        />
      ) : null}

      <Tabs
        className="flex min-h-0 flex-1 flex-col"
        onValueChange={(next) => onModeChange(next as OrganizeMode)}
        value={mode}
      >
        <TabsList className="grid-cols-2">
          <TabsTrigger value="browse">
            <Bookmark className="h-3.5 w-3.5" />
            浏览
          </TabsTrigger>
          <TabsTrigger value="plan">
            <GitBranch className="h-3.5 w-3.5" />
            整理建议
          </TabsTrigger>
        </TabsList>

        <TabsContent className="min-h-0 flex-1" forceMount value="browse">
          <BookmarkTree
            bookmarks={bookmarks}
            busy={busy}
            canUndo={canUndo}
            classifyMode={classifyMode}
            folders={folders}
            onClassifyModeChange={onClassifyModeChange}
            onCreatePlan={createPlan}
            onRefresh={onRefresh}
            onUndo={onUndo}
            showSummary={false}
            surface={surface}
          />
        </TabsContent>

        <TabsContent className="min-h-0 flex-1" forceMount value="plan">
          {plan ? (
            <ClassifyPreview
              busy={busy}
              folders={folders}
              onApply={onApplyPlan}
              onCancel={onCancelPlan}
              onMoveChange={onMoveChange}
              plan={plan}
              selectedCount={selectedCount}
              surface={surface}
            />
          ) : (
            <Card variant="outline">
              <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
                {classifying ? (
                  <>
                    <GitBranch className="h-7 w-7 text-primary" />
                    <div>
                      <p className="text-sm font-medium">正在生成整理建议</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        进度会显示在页面顶部，完成后这里会出现可确认的移动建议。
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <FolderTree className="h-7 w-7 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">还没有整理建议</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        点击“整理书签”生成 AI 或规则整理建议，确认前不会修改真实书签。
                      </p>
                    </div>
                    <Button disabled={busy || bookmarks.length === 0} onClick={() => createPlan()}>
                      <Sparkles className="h-4 w-4" />
                      生成整理建议
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {backups.length > 0 ? (
        <Alert>
          最近整理前已自动创建备份。需要留档时，可在设置页下载；最近一次也可直接下载：
          <Button
            className="ml-2 h-7"
            onClick={() => onDownloadBackup(backups[0])}
            size="sm"
            variant="outline"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            下载备份
          </Button>
        </Alert>
      ) : null}
    </section>
  );
}
