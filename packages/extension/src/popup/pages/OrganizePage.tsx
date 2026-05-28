import { useMemo, useState } from 'react';
import {
  Activity,
  Bookmark,
  CheckCircle2,
  Download,
  FolderTree,
  GitBranch,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import type {
  AppSettings,
  BackupRecord,
  BookmarkItem,
  ClassificationMode,
  ClassificationPlan,
  ExportManifest,
  FolderItem,
  MovePlan,
  UrlHealthProgress,
  UrlHealthRecord,
} from '../../shared/bookmark-types.js';
import { Alert } from '../../components/ui/alert.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import { summarizeHealthRecords } from '../../utils/url-health.js';
import BookmarkIndexExportPanel from './BookmarkIndexExportPanel.js';
import BookmarkTree from './BookmarkTree.js';
import ClassifyPreview from './ClassifyPreview.js';
import HealthPage from './HealthPage.js';

export type OrganizeMode = 'browse' | 'plan' | 'health';

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
  healthChecking: boolean;
  healthProgress?: UrlHealthProgress;
  healthRecords: UrlHealthRecord[];
  mode: OrganizeMode;
  plan?: ClassificationPlan;
  selectedCount: number;
  selectedMoveIds: string[];
  settings: AppSettings;
  surface?: 'popup' | 'sidepanel';
  onApplyPlan(): void;
  onCancelHealth(): void;
  onCancelPlan(): void;
  onClassifyModeChange(mode: ClassificationMode): void;
  onClearHealthRecords(): void;
  onCreatePlan(mode: ClassificationMode): void;
  onDeleteManyHealthRecords(records: UrlHealthRecord[]): void;
  onDownloadBackup(backup: BackupRecord): void;
  onModeChange(mode: OrganizeMode): void;
  onMoveChange(move: MovePlan): void;
  onRefresh(): Promise<void>;
  onRetryHealthRecord(record: UrlHealthRecord): void;
  onStartHealthCheck(): void;
  onUndo(): void;
  onUpdateManyHealthUrls(records: UrlHealthRecord[]): void;
  onUpdateHealthUrl(record: UrlHealthRecord, url: string): void;
}

function localDateKey(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
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
  healthChecking,
  healthProgress,
  healthRecords,
  mode,
  plan,
  selectedCount,
  selectedMoveIds,
  settings,
  surface = 'popup',
  onApplyPlan,
  onCancelHealth,
  onCancelPlan,
  onClassifyModeChange,
  onClearHealthRecords,
  onCreatePlan,
  onDeleteManyHealthRecords,
  onDownloadBackup,
  onModeChange,
  onMoveChange,
  onRefresh,
  onRetryHealthRecord,
  onStartHealthCheck,
  onUndo,
  onUpdateManyHealthUrls,
  onUpdateHealthUrl,
}: OrganizePageProps) {
  const [showIndexTool, setShowIndexTool] = useState(false);
  const bookmarkById = useMemo(
    () => new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark])),
    [bookmarks],
  );
  const todayHealthRecords = useMemo(() => {
    const today = localDateKey(new Date());
    return healthRecords.filter((record) => {
      const bookmark = bookmarkById.get(record.bookmarkId);
      return (
        Boolean(bookmark) &&
        bookmark?.url === record.bookmarkUrl &&
        localDateKey(record.checkedAt) === today
      );
    });
  }, [bookmarkById, healthRecords]);
  const healthSummary = useMemo(
    () => summarizeHealthRecords(todayHealthRecords),
    [todayHealthRecords],
  );
  const issueCount = healthSummary.dead + healthSummary.error + healthSummary.redirected;

  const createPlan = (modeToCreate = classifyMode) => {
    onModeChange('plan');
    onCreatePlan(modeToCreate);
  };

  const startHealth = () => {
    onModeChange('health');
    onStartHealthCheck();
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <Card>
        <CardContent className="space-y-3 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">整理书签</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                浏览、分类、体检和处理问题都在这个工作台完成。
              </p>
            </div>
            <Badge variant={issueCount > 0 ? 'warning' : 'success'}>
              {issueCount > 0 ? `${issueCount} 个待处理` : '暂无待处理'}
            </Badge>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md border border-border p-2">
              <div className="text-lg font-semibold">{bookmarks.length}</div>
              <div className="text-[11px] text-muted-foreground">书签</div>
            </div>
            <div className="rounded-md border border-border p-2">
              <div className="text-lg font-semibold">{folders.length}</div>
              <div className="text-[11px] text-muted-foreground">文件夹</div>
            </div>
            <div className="rounded-md border border-border p-2">
              <div className="text-lg font-semibold">{plan?.moves.length ?? 0}</div>
              <div className="text-[11px] text-muted-foreground">分类建议</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button disabled={busy || bookmarks.length === 0} onClick={() => createPlan()}>
              <Sparkles className="h-4 w-4" />
              整理书签
            </Button>
            <Button disabled={healthChecking || bookmarks.length === 0} onClick={startHealth}>
              <Activity className="h-4 w-4" />
              体检链接
            </Button>
            <Button
              disabled={busy || !canUndo}
              onClick={onUndo}
              variant="outline"
            >
              撤销上次整理
            </Button>
            <Button
              onClick={() => setShowIndexTool((current) => !current)}
              variant="outline"
            >
              <Download className="h-4 w-4" />
              {showIndexTool ? '收起索引导出' : '导出书签索引'}
            </Button>
          </div>
        </CardContent>
      </Card>

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
        <TabsList className="grid-cols-3">
          <TabsTrigger value="browse">
            <Bookmark className="h-3.5 w-3.5" />
            浏览
          </TabsTrigger>
          <TabsTrigger value="plan">
            <GitBranch className="h-3.5 w-3.5" />
            分类方案
          </TabsTrigger>
          <TabsTrigger value="health">
            <Activity className="h-3.5 w-3.5" />
            链接体检
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
            <Card>
              <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
                {classifying ? (
                  <>
                    <GitBranch className="h-7 w-7 text-primary" />
                    <div>
                      <p className="text-sm font-medium">正在生成分类方案</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        进度会显示在页面顶部，完成后这里会出现可确认的移动建议。
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <FolderTree className="h-7 w-7 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">还没有分类方案</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        点击“整理书签”生成 AI 或规则分类方案，确认前不会修改真实书签。
                      </p>
                    </div>
                    <Button disabled={busy || bookmarks.length === 0} onClick={() => createPlan()}>
                      <Sparkles className="h-4 w-4" />
                      生成分类方案
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent className="min-h-0 flex-1" forceMount value="health">
          <HealthPage
            bookmarks={bookmarks}
            checking={healthChecking}
            onCancel={onCancelHealth}
            onClear={onClearHealthRecords}
            onDeleteMany={onDeleteManyHealthRecords}
            onRetry={onRetryHealthRecord}
            onStart={startHealth}
            onUpdateManyUrls={onUpdateManyHealthUrls}
            onUpdateUrl={onUpdateHealthUrl}
            progress={healthProgress}
            records={healthRecords}
          />
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

      {issueCount === 0 && todayHealthRecords.length > 0 ? (
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          今天的链接体检没有发现需要处理的死链或重定向。
        </Alert>
      ) : null}
    </section>
  );
}
