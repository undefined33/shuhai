import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  BookOpen,
  Loader2,
  PanelRightOpen,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react';
import type {
  AiProviderConfig,
  AiProviderTestResult,
  AppSettings,
  BackupRecord,
  BookmarkItem,
  BookmarkNode,
  CapturedContent,
  ClassificationPortMessage,
  ClassificationPortRequest,
  ClassificationMode,
  ClassificationPlan,
  ClassificationProgress,
  ExportManifest,
  ExtensionRequest,
  ExtensionResponse,
  ExtensionState,
  FolderItem,
  MovePlan,
  StateSummary,
  UrlHealthPortMessage,
  UrlHealthPortRequest,
  UrlHealthProgress,
  UrlHealthRecord,
} from '../shared/bookmark-types.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog.js';
import { Progress } from '../components/ui/progress.js';
import { Alert } from '../components/ui/alert.js';
import { Separator } from '../components/ui/separator.js';
import { ToastProvider, useToast } from '../components/ui/toast.js';
import { ErrorRecovery } from '../components/ErrorRecovery.js';
import { DEFAULT_SETTINGS, normalizeSettings, saveOnboardingProgress } from '../utils/storage.js';
import {
  computeOnboardingProgress,
  onboardingComplete,
  type OnboardingProgress,
} from '../utils/onboarding.js';
import { toStructuredError, type StructuredError } from '../utils/error-messages.js';
import { getVaultHandle } from '../utils/vault-writer.js';
import type { SyncJob } from '../social/sync-schema.js';
import { openSyncStore } from '../social/sync-store.js';
import {
  X_SYNC_BOOKMARKS_URL,
  X_SYNC_PROTOCOL,
  parseXSyncUiResponse,
  type XSyncUiRequest,
  type XSyncUiResponse,
} from '../social/x-sync-messages.js';
import {
  addActivityEntry,
  summarizeHealthDelete,
  summarizeHealthUpdate,
} from '../utils/activity-log.js';
import ActivityPage from './pages/ActivityPage.js';
import CollectionPage from './pages/CollectionPage.js';
import HealthPage from './pages/HealthPage.js';
import HomePage from './pages/HomePage.js';
import type { CurrentTabInfo, InlineSaveSource } from './pages/InlineSavePanel.js';
import { OnboardingChecklist } from './pages/OnboardingChecklist.js';
import OrganizePage, { type OrganizeMode } from './pages/OrganizePage.js';
import Settings from './pages/Settings.js';
import XSyncPage from './pages/XSyncPage.js';
import { formatXSyncShortStatus } from './pages/x-sync-ui-model.js';

type Surface = 'popup' | 'sidepanel';
type PageName = 'home' | 'organize' | 'health' | 'collection' | 'activity' | 'settings';
type BusyAction = 'load' | 'plan' | 'apply' | 'undo' | 'settings' | 'health' | undefined;
type Notice = { kind: 'success' | 'warning' | 'error'; message: string } | undefined;

const PREFERRED_VIEW_KEY = 'shuhaiPreferredView';
const EMPTY_ONBOARDING_PROGRESS: OnboardingProgress = {
  vaultConfigured: false,
  providerConfigured: false,
  firstClassifyDone: false,
  firstExportDone: false,
};

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function BrandMark() {
  return <span className="shuhai-logomark shrink-0">书</span>;
}

function TitleWithSerifTail({ children }: { children: string }) {
  if (children === 'ShuHai') {
    return (
      <>
        Shu<span className="font-serif font-bold">Hai</span>
      </>
    );
  }

  const chars = Array.from(children);
  let tailIndex = -1;
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    if (/\p{Script=Han}/u.test(chars[index])) {
      tailIndex = index;
      break;
    }
  }

  if (tailIndex === -1) {
    return <>{children}</>;
  }

  return (
    <>
      {chars.slice(0, tailIndex).join('')}
      <span className="font-serif font-bold">{chars[tailIndex]}</span>
      {chars.slice(tailIndex + 1).join('')}
    </>
  );
}

function MetricNumber({ children }: { children: number | string }) {
  return <span className="font-serif tabular-nums text-foreground">{children}</span>;
}

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function normalizeExtensionState(value: unknown): ExtensionState {
  const state = objectRecord(value);

  return {
    tree: arrayOrEmpty<BookmarkNode>(state.tree),
    bookmarks: arrayOrEmpty<BookmarkItem>(state.bookmarks),
    folders: arrayOrEmpty<FolderItem>(state.folders),
    backups: arrayOrEmpty<BackupRecord>(state.backups),
    exportManifests: arrayOrEmpty<ExportManifest>(state.exportManifests),
    pendingCaptures: arrayOrEmpty<CapturedContent>(state.pendingCaptures),
    urlHealthRecords: arrayOrEmpty<UrlHealthRecord>(state.urlHealthRecords),
    lastMoveRecordCount:
      typeof state.lastMoveRecordCount === 'number' && Number.isFinite(state.lastMoveRecordCount)
        ? state.lastMoveRecordCount
        : 0,
    onboarded: state.onboarded === true,
    settings: normalizeSettings(state.settings),
  };
}

function normalizeStateSummary(value: unknown): StateSummary {
  const summary = objectRecord(value);

  return {
    bookmarkCount:
      typeof summary.bookmarkCount === 'number' && Number.isFinite(summary.bookmarkCount)
        ? summary.bookmarkCount
        : 0,
    folderCount:
      typeof summary.folderCount === 'number' && Number.isFinite(summary.folderCount)
        ? summary.folderCount
        : 0,
    pendingCaptureCount:
      typeof summary.pendingCaptureCount === 'number' &&
      Number.isFinite(summary.pendingCaptureCount)
        ? summary.pendingCaptureCount
        : 0,
    onboarded: summary.onboarded === true,
    hasVaultHandle: summary.hasVaultHandle === true,
    hasAiProvider: summary.hasAiProvider === true,
    lastExportDate: typeof summary.lastExportDate === 'string' ? summary.lastExportDate : undefined,
  };
}

function sendMessage<T>(request: ExtensionRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(request, (response: ExtensionResponse | undefined) => {
      const error = chrome.runtime.lastError?.message;
      if (error) {
        reject(new Error(error));
        return;
      }

      if (!response) {
        reject(new Error('扩展后台没有响应'));
        return;
      }

      if (!response.ok) {
        const responseError = new Error(response.error) as Error & { errorCode?: string };
        responseError.errorCode = response.errorCode;
        reject(responseError);
        return;
      }

      resolve(response.data as T);
    });
  });
}

function selectedMoveIds(plan: ClassificationPlan): string[] {
  return plan.moves.filter((move) => move.selected).map((move) => move.id);
}

function replaceMove(plan: ClassificationPlan, nextMove: MovePlan): ClassificationPlan {
  const moves = plan.moves.map((move) => (move.id === nextMove.id ? nextMove : move));
  const targetFolders = new Set(moves.map((move) => move.targetFolder).filter(Boolean));

  return {
    ...plan,
    moves,
    newFolders: Array.from(targetFolders).sort((a, b) => a.localeCompare(b, 'zh-CN')),
  };
}

function downloadBackup(backup: BackupRecord): void {
  const blob = new Blob([JSON.stringify(backup.tree, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `shuhai-bookmarks-${backup.createdAt.replace(/[:.]/g, '-')}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function applyPlanFolders(bookmarks: BookmarkItem[], plan: ClassificationPlan): BookmarkItem[] {
  const movesByBookmarkId = new Map(plan.moves.map((move) => [move.bookmarkId, move]));

  return bookmarks.map((bookmark) => {
    const move = movesByBookmarkId.get(bookmark.id);
    return move
      ? {
          ...bookmark,
          parentPath: move.targetFolder,
          parentTitle: move.targetFolder.split('/').at(-1) ?? move.targetFolder,
        }
      : bookmark;
  });
}

function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) {
    return '估算中';
  }

  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) {
    return `${seconds} 秒`;
  }

  return `${Math.ceil(seconds / 60)} 分钟`;
}

function healthStatusLabel(status: UrlHealthRecord['status']): string {
  switch (status) {
    case 'alive':
      return '正常';
    case 'redirected':
      return '重定向';
    case 'dead':
      return '死链';
    case 'error':
      return '检查失败';
    case 'skipped':
      return '已跳过';
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

function getCurrentWindowId(): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.windows.getCurrent((currentWindow) => {
      const error = chrome.runtime.lastError?.message;
      if (error) {
        reject(new Error(error));
        return;
      }

      if (typeof currentWindow.id !== 'number') {
        reject(new Error('无法识别当前 Chrome 窗口'));
        return;
      }

      resolve(currentWindow.id);
    });
  });
}

async function openSidePanel(): Promise<void> {
  if (!chrome.sidePanel?.open) {
    throw new Error('当前 Chrome 版本不支持侧边栏，请先使用弹窗模式。');
  }

  const windowId = await getCurrentWindowId();
  await chrome.sidePanel.open({ windowId });
}

function isExactXBookmarksPage(tab: CurrentTabInfo | undefined): boolean {
  return tab?.url === X_SYNC_BOOKMARKS_URL;
}

function isActiveXSyncJob(job: SyncJob | undefined): boolean {
  return Boolean(
    job &&
      ['prepared', 'scanning', 'paused', 'ready_for_review', 'writing', 'partial'].includes(
        job.status,
      ),
  );
}

async function readXSyncJob(activeOnly: boolean): Promise<SyncJob | undefined> {
  const store = await openSyncStore();
  try {
    if (activeOnly) {
      return await store.getActiveJob('x');
    }
    return (await store.listJobs({ source: 'x', limit: 1 }))[0];
  } finally {
    store.close();
  }
}

function sendXSyncPopupMessage(request: XSyncUiRequest): Promise<XSyncUiResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(request, (rawResponse: unknown) => {
      const runtimeError = chrome.runtime.lastError?.message;
      if (runtimeError) {
        reject(new Error('无法建立 X 同步任务'));
        return;
      }
      try {
        const response = parseXSyncUiResponse(rawResponse);
        if (!response.ok) {
          reject(new Error('当前 X 收藏页无法启动同步'));
          return;
        }
        resolve(response);
      } catch {
        reject(new Error('X 同步后台返回了无法验证的响应'));
      }
    });
  });
}

function requestHealthCheckPermission(): Promise<boolean> {
  if (!chrome.permissions?.request) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    chrome.permissions.request(
      {
        origins: ['http://*/*', 'https://*/*'],
      },
      (granted) => resolve(Boolean(granted)),
    );
  });
}

function normalizePreferredPage(value: unknown): PageName | undefined {
  if (value === 'collect') {
    return 'collection';
  }

  if (
    value === 'home' ||
    value === 'organize' ||
    value === 'health' ||
    value === 'collection' ||
    value === 'activity' ||
    value === 'settings'
  ) {
    return value;
  }

  return undefined;
}

function storePreferredPage(page: PageName): Promise<void> {
  if (!chrome.storage?.local) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    chrome.storage.local.set({ [PREFERRED_VIEW_KEY]: page }, () => resolve());
  });
}

function takePreferredPage(): Promise<PageName | undefined> {
  if (!chrome.storage?.local) {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve) => {
    chrome.storage.local.get(PREFERRED_VIEW_KEY, (items) => {
      const preferredPage = normalizePreferredPage(items[PREFERRED_VIEW_KEY]);
      if (preferredPage) {
        void chrome.storage.local.remove(PREFERRED_VIEW_KEY);
        resolve(preferredPage);
        return;
      }

      resolve(undefined);
    });
  });
}

function detectInlineSaveSource(url: string): InlineSaveSource | undefined {
  try {
    const parsed = new URL(url);
    if (
      (parsed.hostname === 'x.com' ||
        parsed.hostname.endsWith('.x.com') ||
        parsed.hostname === 'twitter.com' ||
        parsed.hostname.endsWith('.twitter.com')) &&
      /\/[^/]+\/status\/\d+/.test(parsed.pathname)
    ) {
      return 'twitter';
    }

    if (
      (parsed.hostname === 'weibo.com' ||
        parsed.hostname.endsWith('.weibo.com') ||
        parsed.hostname === 'm.weibo.cn') &&
      (/\/detail\/[^/?#]+/.test(parsed.pathname) || /\/status\/[^/?#]+/.test(parsed.pathname))
    ) {
      return 'weibo';
    }

    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return 'article';
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function getActiveTabInfo(): Promise<CurrentTabInfo | undefined> {
  if (!chrome.tabs?.query) {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      const url = tab?.url ?? '';
      if (!url) {
        resolve(undefined);
        return;
      }

      resolve({
        title: tab.title,
        url,
        source: detectInlineSaveSource(url),
      });
    });
  });
}

interface PopupLauncherProps {
  busy: boolean;
  onboardingProgress: OnboardingProgress;
  summary?: StateSummary;
  state?: ExtensionState;
  onOpenSidePanel(page: PageName): void;
  onQuickClassify(): void;
  onQuickHealth(): void;
  onSkipOnboarding(): void;
  onUsePopup(page: PageName): void;
}

function PopupLauncher({
  busy,
  onboardingProgress,
  summary,
  state,
  onOpenSidePanel,
  onQuickClassify,
  onQuickHealth,
  onSkipOnboarding,
  onUsePopup,
}: PopupLauncherProps) {
  const bookmarkCount = summary?.bookmarkCount ?? state?.bookmarks?.length ?? 0;
  const folderCount = summary?.folderCount ?? state?.folders?.length ?? 0;
  const pendingCaptureCount = summary?.pendingCaptureCount ?? state?.pendingCaptures?.length ?? 0;
  const setupReady = Boolean(summary?.hasVaultHandle && summary?.hasAiProvider);
  const lastSavedLabel = summary?.lastExportDate
    ? new Date(summary.lastExportDate).toLocaleDateString()
    : undefined;

  if (!state) {
    return (
      <main className="flex h-[600px] flex-col gap-4 bg-background p-4 text-foreground">
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <BrandMark />
            <div className="min-w-0">
              <h1 className="text-base font-semibold tracking-tight">
                <TitleWithSerifTail>ShuHai</TitleWithSerifTail>
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                <MetricNumber>{bookmarkCount}</MetricNumber> 个书签 ·{' '}
                <MetricNumber>{folderCount}</MetricNumber> 个文件夹
              </p>
            </div>
          </div>
          {pendingCaptureCount > 0 ? (
            <Badge variant="accent">待入库 {pendingCaptureCount}</Badge>
          ) : null}
        </header>

        <Separator />

        <Card className="bg-primary/5" variant="soft">
          <CardContent className="space-y-4 p-4">
            <div className="space-y-2">
              <div className="inline-flex rounded-md bg-primary/10 p-2 text-primary">
                <PanelRightOpen className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold">打开 ShuHai 工作区</h2>
                <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                  在侧边栏里整理书签、检查失效链接、确认内容入库。
                </p>
              </div>
            </div>
            <Button className="h-10 w-full" disabled={busy} onClick={() => onOpenSidePanel('home')}>
              <PanelRightOpen className="h-4 w-4" />
              打开工作区
            </Button>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-2">
          <Button
            disabled={busy || bookmarkCount === 0}
            onClick={onQuickClassify}
            variant="outline"
          >
            <Sparkles className="h-4 w-4" />
            整理我的书签
          </Button>
          <Button disabled={busy || bookmarkCount === 0} onClick={onQuickHealth} variant="outline">
            <Activity className="h-4 w-4" />
            找出坏链接
          </Button>
        </div>

        <div className="rounded-lg bg-card/70 p-3 text-[13px]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">准备状态</span>
            <Badge variant={setupReady ? 'success' : 'warning'}>
              {setupReady ? '已配置' : '需配置'}
            </Badge>
          </div>
          <div className="mt-2 grid gap-1.5 text-xs text-muted-foreground">
            <span>Vault：{summary?.hasVaultHandle ? '已选择' : '未选择'}</span>
            <span>AI：{summary?.hasAiProvider ? '已配置' : '未配置'}</span>
            {lastSavedLabel ? <span>上次保存：{lastSavedLabel}</span> : null}
          </div>
        </div>

        <div className="mt-auto grid gap-2">
          {pendingCaptureCount > 0 ? (
            <Button disabled={busy} onClick={() => onUsePopup('collection')} variant="secondary">
              <BookOpen className="h-4 w-4" />
              处理待入库 {pendingCaptureCount}
            </Button>
          ) : null}
          <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
            <button
              className="hover:text-foreground"
              disabled={busy}
              onClick={() => onUsePopup('home')}
              type="button"
            >
              继续用弹窗
            </button>
            <button
              className="inline-flex items-center gap-1 hover:text-foreground"
              disabled={busy}
              onClick={() => onUsePopup('settings')}
              type="button"
            >
              <SettingsIcon className="h-3.5 w-3.5" />
              设置
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-[600px] flex-col gap-3 bg-background p-3 text-foreground">
      <header className="flex items-start gap-2">
        <BrandMark />
        <div className="min-w-0 space-y-1">
          <h1 className="text-base font-semibold tracking-tight">
            <TitleWithSerifTail>ShuHai</TitleWithSerifTail>
          </h1>
          <p className="text-xs text-muted-foreground">
            <MetricNumber>{bookmarkCount}</MetricNumber> 书签 ·{' '}
            <MetricNumber>{folderCount}</MetricNumber> 文件夹
          </p>
        </div>
      </header>

      <Separator />

      {state && !state.onboarded ? (
        <OnboardingChecklist
          compact
          onOpenCollect={() => onUsePopup('collection')}
          onOpenOrganize={() => onUsePopup('organize')}
          onOpenSettings={() => onUsePopup('settings')}
          onSkip={onSkipOnboarding}
          progress={onboardingProgress}
        />
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <PanelRightOpen className="h-4 w-4 text-primary" />
            打开工作区
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <Button disabled={busy} onClick={() => onOpenSidePanel('home')} variant="outline">
            <PanelRightOpen className="h-4 w-4" />
            打开任务首页
          </Button>
          <Button disabled={busy} onClick={() => onOpenSidePanel('organize')} variant="outline">
            <Sparkles className="h-4 w-4" />
            整理书签
          </Button>
          <Button disabled={busy} onClick={() => onOpenSidePanel('collection')} variant="outline">
            <BookOpen className="h-4 w-4" />
            待入库
            {pendingCaptureCount > 0 ? <Badge variant="accent">{pendingCaptureCount}</Badge> : null}
          </Button>
          <Button disabled={busy} onClick={() => onOpenSidePanel('settings')} variant="outline">
            <SettingsIcon className="h-4 w-4" />
            设置
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>快捷操作</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2">
          <Button
            disabled={busy || bookmarkCount === 0}
            onClick={onQuickClassify}
            variant="secondary"
          >
            <Sparkles className="h-4 w-4" />
            AI 整理
          </Button>
          <Button
            disabled={busy || bookmarkCount === 0}
            onClick={onQuickHealth}
            variant="secondary"
          >
            <Activity className="h-4 w-4" />
            检查链接
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">AI 整理</span>
            <Badge variant={state?.settings?.useAi ? 'success' : 'warning'}>
              {state?.settings?.useAi ? '已启用' : '规则模式'}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">待入库</span>
            <Badge variant={pendingCaptureCount > 0 ? 'accent' : 'outline'}>
              {pendingCaptureCount}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="mt-auto">
        <Button
          className="w-full"
          disabled={busy}
          onClick={() => onUsePopup('home')}
          variant="ghost"
        >
          继续用弹窗
        </Button>
      </div>
    </main>
  );
}

interface XSyncPopupLauncherProps {
  lastJob?: SyncJob;
  opening: boolean;
  ready: boolean;
  onOpen(): void;
  onOpenSettings(): void;
}

function XSyncPopupLauncher({
  lastJob,
  opening,
  ready,
  onOpen,
  onOpenSettings,
}: XSyncPopupLauncherProps) {
  const continuing = isActiveXSyncJob(lastJob);

  return (
    <main className="flex min-h-[380px] flex-col bg-background p-4 text-foreground">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <BrandMark />
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight">
              <TitleWithSerifTail>ShuHai</TitleWithSerifTail>
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">X 收藏同步</p>
          </div>
        </div>
        <Button
          aria-label="打开设置"
          onClick={onOpenSettings}
          size="icon"
          title="设置"
          variant="ghost"
        >
          <SettingsIcon className="h-4 w-4" />
        </Button>
      </header>

      <Separator className="my-4" />

      <div className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">
            {continuing ? '继续上次 X 同步任务' : '同步新增收藏'}
          </h2>
          <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
            打开侧边栏后检查新增收藏。扫描受固定预算限制，复核前不会写入 Vault。
          </p>
        </div>

        <div className="rounded-md border border-border bg-muted/40 p-3 text-[13px]">
          <span className="text-muted-foreground">上次任务</span>
          <p className="mt-1 font-medium">{formatXSyncShortStatus(lastJob)}</p>
        </div>

        <Button className="h-10 w-full" disabled={!ready} loading={opening} onClick={onOpen}>
          <PanelRightOpen className="h-4 w-4" />
          {continuing ? '打开同步任务' : '同步新增收藏'}
        </Button>
      </div>

      <p className="mt-auto pt-5 text-xs leading-5 text-muted-foreground">
        只处理当前 X 收藏页；不会读取 Cookie、token、其它标签页，也不会自动重试平台限制。
      </p>
    </main>
  );
}

interface ProgressPanelProps {
  progress?: ClassificationProgress;
  onCancel(): void;
}

function ProgressPanel({ progress, onCancel }: ProgressPanelProps) {
  const total = progress?.total ?? 0;
  const done = progress?.done ?? 0;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="mt-3 rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium">AI 正在分析你的书签</p>
          <p className="text-[11px] text-muted-foreground">
            <MetricNumber>{done}</MetricNumber>/<MetricNumber>{total}</MetricNumber> (
            <MetricNumber>{percent}</MetricNumber>%) · 批次{' '}
            <MetricNumber>{progress?.batch ?? 0}</MetricNumber>/
            <MetricNumber>{progress?.totalBatches ?? 0}</MetricNumber> · 预计剩余{' '}
            {formatDuration(progress?.remainingMs)}
          </p>
        </div>
        <Button onClick={onCancel} size="sm" variant="outline">
          取消
        </Button>
      </div>
      <Progress value={percent} />
    </div>
  );
}

interface AppProps {
  surface?: Surface;
}

function AppContent({ surface = 'popup' }: AppProps) {
  const { toast } = useToast();
  const [page, setPage] = useState<PageName>('home');
  const [organizeMode, setOrganizeMode] = useState<OrganizeMode>('browse');
  const [state, setState] = useState<ExtensionState | undefined>();
  const [summary, setSummary] = useState<StateSummary | undefined>();
  const [onboardingProgress, setOnboardingProgress] =
    useState<OnboardingProgress>(EMPTY_ONBOARDING_PROGRESS);
  const [plan, setPlan] = useState<ClassificationPlan | undefined>();
  const [classifyMode, setClassifyMode] = useState<ClassificationMode>('safe');
  const [busyAction, setBusyAction] = useState<BusyAction>('load');
  const [status, setStatus] = useState('正在读取书签...');
  const [notice, setNotice] = useState<Notice>();
  const [recoveryError, setRecoveryError] = useState<StructuredError | undefined>();
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);
  const [classificationProgress, setClassificationProgress] = useState<ClassificationProgress>();
  const [urlHealthProgress, setUrlHealthProgress] = useState<UrlHealthProgress>();
  const [healthChecking, setHealthChecking] = useState(false);
  const [forcePopupWorkspace, setForcePopupWorkspace] = useState(false);
  const [currentTabInfo, setCurrentTabInfo] = useState<CurrentTabInfo | undefined>();
  const [focusedCaptureId, setFocusedCaptureId] = useState('');
  const [lastAppliedMoveCount, setLastAppliedMoveCount] = useState(0);
  const [contextResolved, setContextResolved] = useState(false);
  const [xSyncRoute, setXSyncRoute] = useState(false);
  const [xSyncWindowId, setXSyncWindowId] = useState<number>();
  const [xSyncLastJob, setXSyncLastJob] = useState<SyncJob>();
  const [xSyncOpening, setXSyncOpening] = useState(false);
  const classificationPortRef = useRef<chrome.runtime.Port | undefined>(undefined);
  const healthPortRef = useRef<chrome.runtime.Port | undefined>(undefined);
  const previousPendingCaptureCountRef = useRef<number | undefined>(undefined);

  const busy = Boolean(busyAction) || healthChecking;

  useEffect(() => {
    if (notice?.kind !== 'success') {
      return undefined;
    }

    const timer = window.setTimeout(() => setNotice(undefined), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const showError = (error: unknown) => {
    const structured = toStructuredError(
      error,
      error && typeof error === 'object' ? (error as { errorCode?: string }).errorCode : undefined,
    );
    setRecoveryError(structured);
    toast({
      kind: 'error',
      message: structured.message,
      description: structured.suggestion,
    });
  };

  const setHealthRecords = (records: UrlHealthRecord[]) => {
    setState((current) => (current ? { ...current, urlHealthRecords: records } : current));
  };

  const loadState = async () => {
    setBusyAction('load');
    setNotice(undefined);
    try {
      let nextState = normalizeExtensionState(await sendMessage<unknown>({ type: 'state:get' }));
      const vaultHandle = await getVaultHandle().catch(() => null);
      const progress = computeOnboardingProgress({
        hasVaultHandle: Boolean(vaultHandle),
        settings: nextState.settings,
        lastMoveRecordCount: nextState.lastMoveRecordCount,
        exportManifests: nextState.exportManifests,
      });
      setOnboardingProgress(progress);
      await saveOnboardingProgress(progress).catch(() => undefined);
      if (!nextState.onboarded && onboardingComplete(progress)) {
        await sendMessage<{ onboarded: boolean }>({ type: 'onboarding:set', onboarded: true });
        nextState = { ...nextState, onboarded: true };
      }
      setState(nextState);
      setSummary({
        bookmarkCount: nextState.bookmarks.length,
        folderCount: nextState.folders.length,
        pendingCaptureCount: nextState.pendingCaptures.length,
        onboarded: nextState.onboarded,
        hasVaultHandle: Boolean(vaultHandle),
        hasAiProvider: nextState.settings.aiProviders.some(
          (provider) => provider.enabled && provider.apiKey.trim().length > 0,
        ),
        lastExportDate: nextState.exportManifests[0]?.exportedAt,
      });
      setClassifyMode(nextState.settings.defaultClassifyMode);
      setStatus(`已读取 ${nextState.bookmarks.length} 个书签`);
      setRecoveryError(undefined);
    } catch (loadError) {
      showError(loadError);
    } finally {
      setBusyAction(undefined);
    }
  };

  const loadSummary = async () => {
    setBusyAction('load');
    setNotice(undefined);
    try {
      const nextSummary = normalizeStateSummary(
        await sendMessage<unknown>({ type: 'state:summary' }),
      );
      setSummary(nextSummary);
      setOnboardingProgress({
        vaultConfigured: nextSummary.hasVaultHandle,
        providerConfigured: nextSummary.hasAiProvider,
        firstClassifyDone: false,
        firstExportDone: Boolean(nextSummary.lastExportDate),
      });
      setStatus(`已读取 ${nextSummary.bookmarkCount} 个书签`);
      setRecoveryError(undefined);
    } catch (loadError) {
      showError(loadError);
    } finally {
      setBusyAction(undefined);
    }
  };

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const tab = await getActiveTabInfo();
      if (disposed) return;
      setCurrentTabInfo(tab);
      const exactXBookmarks = isExactXBookmarksPage(tab);

      if (surface === 'popup' && exactXBookmarks) {
        const [windowId, lastJob] = await Promise.all([
          getCurrentWindowId().catch(() => undefined),
          readXSyncJob(false).catch(() => undefined),
        ]);
        if (disposed) return;
        setXSyncWindowId(windowId);
        setXSyncLastJob(lastJob);
        setXSyncRoute(true);
        setBusyAction(undefined);
        setContextResolved(true);
        return;
      }

      if (surface === 'sidepanel') {
        const activeJob = await readXSyncJob(true).catch(() => undefined);
        if (disposed) return;
        if (activeJob || exactXBookmarks) {
          setXSyncLastJob(activeJob);
          setXSyncRoute(true);
          setBusyAction(undefined);
          setContextResolved(true);
          return;
        }
        const preferredPage = await takePreferredPage();
        if (disposed) return;
        if (preferredPage) setPage(preferredPage);
        await loadState();
      } else {
        await loadSummary();
      }
      if (!disposed) setContextResolved(true);
    })().catch((error) => {
      if (disposed) return;
      showError(error);
      setBusyAction(undefined);
      setContextResolved(true);
    });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!chrome.storage?.onChanged || xSyncRoute) {
      return undefined;
    }

    const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local') {
        return;
      }

      const relevantKeys = new Set([
        'exportManifests',
        'lastMoveRecords',
        'onboarded',
        'pendingCapture',
        'settings',
        'urlHealthRecords',
      ]);

      if (Object.keys(changes).some((key) => relevantKeys.has(key))) {
        if (surface === 'popup' && !forcePopupWorkspace) {
          void loadSummary();
          return;
        }

        void loadState();
      }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [forcePopupWorkspace, surface, xSyncRoute]);

  useEffect(() => {
    const pendingCount = state?.pendingCaptures?.length ?? 0;
    const previousCount = previousPendingCaptureCountRef.current;
    if (previousCount !== undefined && pendingCount > previousCount) {
      const latestCapture = [...(state?.pendingCaptures ?? [])].sort(
        (a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt),
      )[0];
      setFocusedCaptureId(latestCapture?.id ?? '');
      setPage('home');
      setForcePopupWorkspace(true);
      toast({ kind: 'success', message: '内容已提取到 ShuHai，确认后写入 Vault。' });
    }
    previousPendingCaptureCountRef.current = pendingCount;
  }, [state?.pendingCaptures?.length, toast]);

  const createPlan = async (mode: ClassificationMode) => {
    setBusyAction('plan');
    setNotice(undefined);
    setPage('organize');
    setOrganizeMode('plan');
    setClassifyMode(mode);
    setClassificationProgress({
      done: 0,
      total: bookmarks.length,
      batch: 0,
      totalBatches: 0,
      elapsedMs: 0,
    });
    setStatus(mode === 'full' ? '正在重新审视全部书签...' : '正在生成整理建议...');
    try {
      const nextPlan = await createPlanWithProgress(mode);
      setPlan(nextPlan);
      setOrganizeMode('plan');
      setStatus(`生成 ${nextPlan.moves.length} 条移动建议`);
      toast({
        kind: nextPlan.moves.length > 0 ? 'success' : 'info',
        message:
          nextPlan.moves.length > 0
            ? `已生成 ${nextPlan.moves.length} 条建议，应用前不会修改真实书签。`
            : '没有生成移动建议，可以切换整理模式后重试。',
      });
    } catch (planError) {
      showError(planError);
    } finally {
      classificationPortRef.current?.disconnect();
      classificationPortRef.current = undefined;
      setClassificationProgress(undefined);
      setBusyAction(undefined);
    }
  };

  const createPlanWithProgress = (mode: ClassificationMode): Promise<ClassificationPlan> =>
    new Promise((resolve, reject) => {
      if (!chrome.runtime.connect) {
        void sendMessage<ClassificationPlan>({ type: 'plan:create', mode }).then(resolve, reject);
        return;
      }

      const port = chrome.runtime.connect({ name: 'classify' });
      let settled = false;
      classificationPortRef.current = port;

      port.onMessage.addListener((message: ClassificationPortMessage) => {
        if (message.type === 'progress') {
          setClassificationProgress(message.progress);
          setStatus(
            `已分析 ${message.progress.done}/${message.progress.total}，批次 ${message.progress.batch}/${message.progress.totalBatches}`,
          );
          return;
        }

        if (message.type === 'complete') {
          settled = true;
          if (message.cancelled) {
            setNotice({
              kind: 'warning',
              message: `已取消，基于已分析的 ${message.progress.done} 个书签生成部分建议。`,
            });
          }
          resolve(message.plan);
          return;
        }

        if (message.type === 'error') {
          settled = true;
          const error = new Error(message.error) as Error & { errorCode?: string };
          error.errorCode = message.errorCode;
          reject(error);
        }
      });

      port.onDisconnect.addListener(() => {
        if (!settled && chrome.runtime.lastError?.message) {
          reject(new Error(chrome.runtime.lastError.message));
        }
      });

      port.postMessage({ type: 'plan:create', mode } satisfies ClassificationPortRequest);
    });

  const cancelClassification = () => {
    classificationPortRef.current?.postMessage({
      type: 'cancel',
    } satisfies ClassificationPortRequest);
    setStatus('正在取消，本批次结束后会生成部分建议...');
  };

  const startHealthCheck = async () => {
    setNotice(undefined);
    setUrlHealthProgress(undefined);
    setPage('health');

    try {
      const granted = await requestHealthCheckPermission();
      if (!granted) {
        setNotice({
          kind: 'warning',
          message: '检查失效链接需要临时访问书签中的 http/https 地址，未授权时不会发起检测。',
        });
        return;
      }

      if (!chrome.runtime.connect) {
        throw new Error('当前扩展环境不支持长任务连接');
      }

      healthPortRef.current?.disconnect();
      const port = chrome.runtime.connect({ name: 'health' });
      let settled = false;
      healthPortRef.current = port;
      setHealthChecking(true);
      setStatus('正在检查链接...');

      port.onMessage.addListener((message: UrlHealthPortMessage) => {
        if (message.type === 'progress') {
          setUrlHealthProgress(message.progress);
          setHealthRecords(message.records);
          setStatus(`链接检查 ${message.progress.done}/${message.progress.total}`);
          return;
        }

        if (message.type === 'complete') {
          settled = true;
          setUrlHealthProgress(message.progress);
          setHealthRecords(message.records);
          setHealthChecking(false);
          healthPortRef.current = undefined;
          void loadState();
          setNotice({
            kind:
              message.progress.summary.dead + message.progress.summary.error > 0
                ? 'warning'
                : 'success',
            message: message.cancelled
              ? `已暂停：本次已保留 ${message.progress.done} 条检查结果。`
              : `检查完成：死链 ${message.progress.summary.dead}，错误 ${message.progress.summary.error}，重定向 ${message.progress.summary.redirected}`,
          });
          setStatus(message.cancelled ? '链接检查已暂停' : '链接检查完成');
          return;
        }

        if (message.type === 'error') {
          settled = true;
          setHealthChecking(false);
          healthPortRef.current = undefined;
          const error = new Error(message.error) as Error & { errorCode?: string };
          error.errorCode = message.errorCode;
          showError(error);
        }
      });

      port.onDisconnect.addListener(() => {
        if (!settled) {
          setHealthChecking(false);
          healthPortRef.current = undefined;
        }
      });

      port.postMessage({ type: 'health:check' } satisfies UrlHealthPortRequest);
    } catch (healthError) {
      setHealthChecking(false);
      showError(healthError);
    }
  };

  const cancelHealthCheck = () => {
    healthPortRef.current?.postMessage({ type: 'pause' } satisfies UrlHealthPortRequest);
    setStatus('正在暂停链接检查，已完成结果会保留...');
  };

  const applyPlan = async () => {
    if (!plan) {
      return;
    }

    setBusyAction('apply');
    setNotice(undefined);
    setStatus('正在备份并移动书签...');
    try {
      const result = await sendMessage<{ moved: number; failed: unknown[] }>({
        type: 'plan:apply',
        plan,
        selectedMoveIds: selectedMoveIds(plan),
      });
      setStatus(`已移动 ${result.moved} 个书签，失败 ${result.failed.length} 个`);
      toast({
        kind: result.failed.length > 0 ? 'info' : 'success',
        message: `已移动 ${result.moved} 个书签，失败 ${result.failed.length} 个。`,
      });
      setLastAppliedMoveCount(result.moved);
      setPlan(undefined);
      setPage('organize');
      setOrganizeMode('browse');
      await loadState();
    } catch (applyError) {
      showError(applyError);
    } finally {
      setConfirmApplyOpen(false);
      setBusyAction(undefined);
    }
  };

  const undoLast = async () => {
    setBusyAction('undo');
    setNotice(undefined);
    setStatus('正在撤销上次整理...');
    try {
      const result = await sendMessage<{ undone: number }>({ type: 'plan:undoLast' });
      setStatus(`已撤销 ${result.undone} 个移动操作`);
      toast({ kind: 'success', message: `已撤销 ${result.undone} 个移动操作。` });
      await loadState();
    } catch (undoError) {
      showError(undoError);
    } finally {
      setBusyAction(undefined);
    }
  };

  const saveSettings = async (settings: AppSettings) => {
    setBusyAction('settings');
    setNotice(undefined);
    try {
      const saved = await sendMessage<AppSettings>({ type: 'settings:set', settings });
      setState((current) =>
        current
          ? {
              ...current,
              settings: saved,
            }
          : current,
      );
      setClassifyMode(saved.defaultClassifyMode);
      setStatus('设置已保存');
      toast({ kind: 'success', message: '设置已保存。' });
    } catch (settingsError) {
      showError(settingsError);
    } finally {
      setBusyAction(undefined);
    }
  };

  const testAiProvider = async (provider: AiProviderConfig): Promise<AiProviderTestResult> =>
    sendMessage<AiProviderTestResult>({ type: 'ai:testConnection', provider });

  const clearPendingCapture = async () => {
    await sendMessage<{ cleared: boolean }>({ type: 'capture:clearPending' });
    await loadState();
  };

  const captureCurrentContent = async (source: InlineSaveSource) => {
    const request: ExtensionRequest =
      source === 'article'
        ? { type: 'capture:currentArticle' }
        : { type: 'capture:currentSocial', source };
    const result = await sendMessage<{ capture: CapturedContent }>(request);
    setFocusedCaptureId(result.capture.id);
    await loadState();

    return result.capture;
  };

  const captureCurrentSocial = async (source: 'twitter' | 'weibo') => captureCurrentContent(source);

  const removePendingCapture = async (id: string) => {
    await sendMessage<{ removed: boolean }>({ type: 'capture:removePending', id });
    await loadState();
  };

  const clearHealthRecords = async () => {
    await sendMessage<{ cleared: boolean }>({ type: 'health:clearRecords' });
    setUrlHealthProgress(undefined);
    await loadState();
  };

  const deleteBookmarksFromHealth = async (records: UrlHealthRecord[]) => {
    if (records.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `确定批量删除 ${records.length} 个 Chrome 书签吗？\n\n删除前会逐条创建备份。`,
    );

    if (!confirmed) {
      return;
    }

    try {
      for (const record of records) {
        await sendMessage<{ deleted: boolean; backupKey: string }>({
          type: 'bookmark:delete',
          id: record.bookmarkId,
        });
      }
      await addActivityEntry({
        type: 'health_delete',
        summary: summarizeHealthDelete(records.length),
        details: records.map((record) => ({
          label: record.bookmarkTitle,
          meta: record.bookmarkUrl,
        })),
      });
      toast({ kind: 'success', message: `已删除 ${records.length} 个书签，并已创建备份。` });
      await loadState();
    } catch (deleteError) {
      showError(deleteError);
    }
  };

  const retryHealthRecord = async (record: UrlHealthRecord) => {
    setNotice(undefined);
    try {
      const granted = await requestHealthCheckPermission();
      if (!granted) {
        setNotice({
          kind: 'warning',
          message: '重试检查需要临时访问该书签地址，未授权时不会发起检测。',
        });
        return;
      }

      setBusyAction('health');
      setStatus(`正在重新检查：${record.bookmarkTitle}`);
      const result = await sendMessage<{ record: UrlHealthRecord; records: UrlHealthRecord[] }>({
        type: 'health:retryOne',
        bookmarkId: record.bookmarkId,
      });
      setHealthRecords(result.records);
      toast({
        kind: result.record.status === 'alive' ? 'success' : 'info',
        message: `已重新检查：${healthStatusLabel(result.record.status)}。`,
      });
      setStatus(`已重新检查：${record.bookmarkTitle}`);
    } catch (retryError) {
      showError(retryError);
    } finally {
      setBusyAction(undefined);
    }
  };

  const updateBookmarkUrlFromHealth = async (record: UrlHealthRecord, url: string) => {
    const confirmed = window.confirm(
      `确定替换这个 Chrome 书签的 URL 吗？\n\n${record.bookmarkTitle}\n${url}`,
    );

    if (!confirmed) {
      return;
    }

    try {
      await sendMessage<{ updated: boolean; backupKey: string }>({
        type: 'bookmark:updateUrl',
        id: record.bookmarkId,
        url,
      });
      await addActivityEntry({
        type: 'health_update',
        summary: summarizeHealthUpdate(1),
        details: [{ label: record.bookmarkTitle, meta: `${record.bookmarkUrl} → ${url}` }],
      });
      toast({ kind: 'success', message: '已更新书签链接，并已创建备份。' });
      await loadState();
    } catch (updateError) {
      showError(updateError);
    }
  };

  const updateBookmarkUrlsFromHealth = async (records: UrlHealthRecord[]) => {
    const updatableRecords = records.filter(
      (record) => record.status === 'redirected' && record.finalUrl,
    );
    if (updatableRecords.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `确定批量更新 ${updatableRecords.length} 个重定向书签吗？\n\n会把它们替换为检测到的跳转目标，更新前会逐条创建备份。`,
    );

    if (!confirmed) {
      return;
    }

    setBusyAction('health');
    setNotice(undefined);
    try {
      for (const [index, record] of updatableRecords.entries()) {
        setStatus(`正在更新重定向 ${index + 1}/${updatableRecords.length}`);
        await sendMessage<{ updated: boolean; backupKey: string }>({
          type: 'bookmark:updateUrl',
          id: record.bookmarkId,
          url: record.finalUrl ?? record.bookmarkUrl,
        });
      }
      await addActivityEntry({
        type: 'health_update',
        summary: summarizeHealthUpdate(updatableRecords.length),
        details: updatableRecords.map((record) => ({
          label: record.bookmarkTitle,
          meta: `${record.bookmarkUrl} → ${record.finalUrl ?? record.bookmarkUrl}`,
        })),
      });
      toast({
        kind: 'success',
        message: `已更新 ${updatableRecords.length} 个重定向书签，并已创建备份。`,
      });
      await loadState();
    } catch (updateError) {
      showError(updateError);
    } finally {
      setBusyAction(undefined);
    }
  };

  const completeOnboarding = async () => {
    try {
      await sendMessage<{ onboarded: boolean }>({ type: 'onboarding:set', onboarded: true });
      setState((current) => (current ? { ...current, onboarded: true } : current));
      toast({ kind: 'success', message: '已跳过首次引导。' });
    } catch (onboardingError) {
      showError(onboardingError);
    }
  };

  const openSettingsFromOnboarding = () => {
    setForcePopupWorkspace(true);
    setPage('settings');
  };

  const handleOpenSidePanel = (nextPage: PageName) => {
    void storePreferredPage(nextPage)
      .then(openSidePanel)
      .then(() => {
        toast({ kind: 'success', message: '侧边栏已打开。' });
      })
      .catch((error) => {
        showError(error);
      });
  };

  const usePopupWorkspace = (nextPage: PageName) => {
    setPage(nextPage);
    setForcePopupWorkspace(true);
    if (!state) {
      void loadState();
    }
  };

  const handleOpenXSync = () => {
    if (!chrome.sidePanel?.open || xSyncWindowId === undefined) {
      showError(new Error('当前窗口无法打开 X 同步侧边栏'));
      return;
    }

    let panelPromise: Promise<void>;
    try {
      // This call must stay first in the click handler so Chrome preserves the user gesture.
      panelPromise = chrome.sidePanel.open({ windowId: xSyncWindowId });
    } catch (error) {
      showError(error);
      return;
    }

    setXSyncOpening(true);
    const launchPromise = isActiveXSyncJob(xSyncLastJob)
      ? Promise.resolve()
      : (() => {
          const randomId = globalThis.crypto?.randomUUID?.();
          if (!randomId) return Promise.reject(new Error('无法创建安全的同步请求'));
          return sendXSyncPopupMessage({
            protocol: X_SYNC_PROTOCOL,
            type: 'launch',
            requestId: `popup-${randomId}`,
          }).then(() => undefined);
        })();

    void Promise.all([panelPromise, launchPromise])
      .catch(showError)
      .finally(() => setXSyncOpening(false));
  };

  const handleOpenSettingsFromX = () => {
    setXSyncRoute(false);
    usePopupWorkspace('settings');
  };

  const handleReturnFromXSync = () => {
    setXSyncRoute(false);
    usePopupWorkspace('home');
  };

  const quickClassifyFromPopup = () => {
    usePopupWorkspace('organize');
    setOrganizeMode('plan');
    void createPlan(classifyMode);
  };

  const quickHealthFromPopup = () => {
    usePopupWorkspace('health');
    void startHealthCheck();
  };

  const useRuleClassification = () => {
    const nextSettings = { ...settings, useAi: false };
    void saveSettings(nextSettings)
      .then(() => {
        toast({ kind: 'info', message: '已切换为规则整理。' });
        setRecoveryError(undefined);
        setPage('organize');
        setOrganizeMode('plan');
        void createPlan('safe');
      })
      .catch(showError);
  };

  const folders = state?.folders ?? [];
  const backups = state?.backups ?? [];
  const settings = state?.settings ?? DEFAULT_SETTINGS;
  const bookmarks = state?.bookmarks ?? [];
  const exportBookmarks = plan ? applyPlanFolders(bookmarks, plan) : bookmarks;
  const canUndo = (state?.lastMoveRecordCount ?? 0) > 0;
  const selectedCount = useMemo(
    () => plan?.moves.filter((move) => move.selected).length ?? 0,
    [plan],
  );
  const alertVariant =
    notice?.kind === 'error' ? 'destructive' : notice?.kind === 'warning' ? 'warning' : 'success';
  const workspaceClass = surface === 'sidepanel' ? 'h-screen' : 'h-[600px]';
  const showWorkspace = surface === 'sidepanel' || forcePopupWorkspace;

  useEffect(() => {
    if (!showWorkspace) {
      return undefined;
    }

    const listener = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        if (page === 'organize' && organizeMode === 'plan' && plan && selectedCount > 0 && !busy) {
          event.preventDefault();
          setConfirmApplyOpen(true);
        }
        return;
      }

      if (event.key === 'Escape') {
        if (busyAction === 'plan') {
          event.preventDefault();
          cancelClassification();
          return;
        }

        if (confirmApplyOpen) {
          event.preventDefault();
          setConfirmApplyOpen(false);
          return;
        }

        if (page !== 'home') {
          event.preventDefault();
          setPage('home');
        }
        return;
      }

      if (event.key === '/') {
        event.preventDefault();
        setPage('organize');
        setOrganizeMode('browse');
        window.setTimeout(() => {
          const search = document.querySelector<HTMLInputElement>('[data-shuhai-search]');
          search?.focus();
        }, 0);
      }
    };

    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [busy, busyAction, confirmApplyOpen, organizeMode, page, plan, selectedCount, showWorkspace]);

  if (!contextResolved) {
    return (
      <main
        className={`flex ${workspaceClass} items-center justify-center bg-background text-foreground`}
      >
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在识别当前任务
        </div>
      </main>
    );
  }

  if (xSyncRoute && surface === 'popup') {
    return (
      <XSyncPopupLauncher
        lastJob={xSyncLastJob}
        onOpen={handleOpenXSync}
        onOpenSettings={handleOpenSettingsFromX}
        opening={xSyncOpening}
        ready={xSyncWindowId !== undefined && !xSyncOpening}
      />
    );
  }

  if (xSyncRoute && surface === 'sidepanel') {
    return (
      <main className="flex h-screen flex-col bg-background text-foreground">
        <header className="px-3 py-3">
          <div className="flex items-center gap-2">
            <BrandMark />
            <div>
              <h1 className="text-base font-semibold tracking-tight">X 收藏同步</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">当前任务工作台</p>
            </div>
          </div>
          <Separator className="mt-3" />
        </header>
        <div className="min-h-0 flex-1 px-3 pt-2">
          <XSyncPage onReturnToWorkspace={handleReturnFromXSync} />
        </div>
      </main>
    );
  }

  if (!showWorkspace) {
    return (
      <>
        <PopupLauncher
          busy={busy}
          onboardingProgress={onboardingProgress}
          onOpenSidePanel={handleOpenSidePanel}
          onQuickClassify={quickClassifyFromPopup}
          onQuickHealth={quickHealthFromPopup}
          onSkipOnboarding={completeOnboarding}
          onUsePopup={usePopupWorkspace}
          summary={summary}
          state={state}
        />
      </>
    );
  }

  const pendingCaptures = state?.pendingCaptures ?? [];
  const focusedCapture = focusedCaptureId
    ? pendingCaptures.find((capture) => capture.id === focusedCaptureId)
    : undefined;
  const pageTitle: Record<PageName, string> = {
    home: 'ShuHai',
    organize: '整理书签',
    health: '检查失效链接',
    collection: '待入库',
    activity: '历史记录',
    settings: '设置',
  };
  const pageContent =
    page === 'home' ? (
      <HomePage
        bookmarkCount={bookmarks.length}
        busy={busy}
        currentTab={currentTabInfo}
        exportManifests={state?.exportManifests ?? []}
        folderCount={folders.length}
        initialCapture={focusedCapture}
        onboarded={state?.onboarded ?? false}
        onboardingProgress={onboardingProgress}
        onCapture={captureCurrentContent}
        onCreatePlan={() => void createPlan(classifyMode)}
        onOpenActivity={() => setPage('activity')}
        onOpenCollection={() => setPage('collection')}
        onOpenHealth={() => void startHealthCheck()}
        onOpenOrganize={() => {
          setPage('organize');
          setOrganizeMode('browse');
        }}
        onOpenSettings={() => setPage('settings')}
        onRefresh={loadState}
        onRemovePendingCapture={removePendingCapture}
        onSkipOnboarding={completeOnboarding}
        pendingCaptures={pendingCaptures}
        settings={settings}
      />
    ) : page === 'organize' ? (
      <OrganizePage
        backups={backups}
        bookmarks={bookmarks}
        busy={busy}
        canUndo={canUndo}
        classifying={busyAction === 'plan'}
        classifyMode={classifyMode}
        exportBookmarks={exportBookmarks}
        exportManifests={state?.exportManifests ?? []}
        folders={folders}
        lastAppliedCount={lastAppliedMoveCount}
        mode={organizeMode}
        onApplyPlan={() => setConfirmApplyOpen(true)}
        onCancelPlan={() => setOrganizeMode('browse')}
        onClassifyModeChange={setClassifyMode}
        onCreatePlan={createPlan}
        onDownloadBackup={downloadBackup}
        onModeChange={setOrganizeMode}
        onMoveChange={(move) =>
          setPlan((current) => (current ? replaceMove(current, move) : current))
        }
        onOpenHealth={() => setPage('health')}
        onOpenHome={() => setPage('home')}
        onRefresh={loadState}
        onUndo={undoLast}
        plan={plan}
        selectedCount={selectedCount}
        selectedMoveIds={plan ? selectedMoveIds(plan) : []}
        settings={settings}
        surface={surface}
      />
    ) : page === 'health' ? (
      <HealthPage
        bookmarks={bookmarks}
        checking={healthChecking}
        onCancel={cancelHealthCheck}
        onClear={clearHealthRecords}
        onDeleteMany={deleteBookmarksFromHealth}
        onRetry={retryHealthRecord}
        onStart={startHealthCheck}
        onUpdateManyUrls={updateBookmarkUrlsFromHealth}
        onUpdateUrl={updateBookmarkUrlFromHealth}
        progress={urlHealthProgress}
        records={state?.urlHealthRecords ?? []}
      />
    ) : page === 'collection' ? (
      <CollectionPage
        exportManifests={state?.exportManifests ?? []}
        onCaptureCurrentSocial={captureCurrentSocial}
        onClearPendingCapture={clearPendingCapture}
        onOpenSettings={openSettingsFromOnboarding}
        onRefresh={loadState}
        onRemovePendingCapture={removePendingCapture}
        pendingCaptures={pendingCaptures}
        settings={settings}
      />
    ) : page === 'activity' ? (
      <ActivityPage onBack={() => setPage('home')} settings={settings} />
    ) : (
      <Settings
        backups={backups}
        busy={busy}
        exportManifests={state?.exportManifests ?? []}
        onDownloadBackup={downloadBackup}
        onOpenActivity={() => setPage('activity')}
        onSave={saveSettings}
        onTestProvider={testAiProvider}
        settings={settings}
      />
    );

  return (
    <main className={`flex ${workspaceClass} flex-col bg-background text-foreground`}>
      <header className="px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {page !== 'home' ? (
              <Button onClick={() => setPage('home')} size="icon" title="返回首页" variant="ghost">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            ) : null}
            <BrandMark />
            <div className="min-w-0">
              <h1 className="text-base font-semibold tracking-tight">
                <TitleWithSerifTail>{pageTitle[page]}</TitleWithSerifTail>
              </h1>
              <p className="truncate text-xs text-muted-foreground">{status}</p>
            </div>
          </div>
          {busy ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              处理中
            </div>
          ) : null}
        </div>
        {busyAction === 'plan' ? (
          <ProgressPanel onCancel={cancelClassification} progress={classificationProgress} />
        ) : null}
        <Separator className="mt-3" />
      </header>

      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-2">
        {recoveryError ? (
          <div className="mt-3">
            <ErrorRecovery
              error={recoveryError}
              onDismiss={() => setRecoveryError(undefined)}
              onOpenSettings={openSettingsFromOnboarding}
              onRetry={loadState}
              onSelectVault={openSettingsFromOnboarding}
              onUseRules={useRuleClassification}
            />
          </div>
        ) : null}

        {notice ? (
          <Alert
            className="mt-3"
            onClose={notice.kind === 'success' ? undefined : () => setNotice(undefined)}
            variant={alertVariant}
          >
            {notice.message}
          </Alert>
        ) : null}

        <div className="min-h-0 flex-1 overflow-hidden">{pageContent}</div>
      </div>

      <Dialog onOpenChange={setConfirmApplyOpen} open={confirmApplyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认移动真实 Chrome 书签？</DialogTitle>
            <DialogDescription>
              将移动 <MetricNumber>{selectedCount}</MetricNumber> 个书签。ShuHai
              会先备份并支持撤销，但这一步会实际修改当前浏览器书签。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirmApplyOpen(false)} variant="ghost">
              取消
            </Button>
            <Button loading={busyAction === 'apply'} onClick={applyPlan}>
              确认应用
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

export default function App(props: AppProps) {
  return (
    <ToastProvider>
      <AppContent {...props} />
    </ToastProvider>
  );
}
