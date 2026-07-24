import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookmarkCheck, BookOpenCheck, PanelRightOpen, RefreshCw, RotateCcw } from 'lucide-react';

import { Button } from '../components/ui/button.js';
import { ActionBar } from '../shell/ActionBar.js';
import { Brand } from '../shell/Brand.js';
import { SurfaceLoading } from '../shell/SurfaceLoading.js';
import { TaskHeader } from '../shell/TaskHeader.js';
import {
  SURFACE_PROTOCOL,
  SURFACE_VERSION,
  parseSurfaceResponse,
  type SurfaceRequest,
  type SurfaceResponse,
  type SurfaceSummary,
  type SurfaceTarget,
} from '../shared/surface-contract.js';
import {
  getPopupBrowserContext,
  type PopupBrowserContext,
  type PopupTabKind,
} from './popup-context.js';

export type PopupActionKind = 'continue' | 'x-sync' | 'x-single' | 'bookmarks';

export interface PopupAction {
  readonly kind: PopupActionKind;
  readonly title: string;
  readonly description: string;
  readonly label: string;
  readonly contextLabel: string;
}

type PopupState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly browser: PopupBrowserContext;
      readonly summary: SurfaceSummary;
    }
  | { readonly kind: 'error' };

function requestId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) {
    throw new Error('request_id_unavailable');
  }
  return `${prefix}-${uuid}`;
}

function sendRawMessage(message: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: unknown) => {
      if (chrome.runtime.lastError) {
        reject(new Error('runtime_unavailable'));
        return;
      }
      resolve(response);
    });
  });
}

async function sendSurfaceRequest<R extends SurfaceRequest>(
  request: R,
): Promise<SurfaceResponse<R>> {
  return parseSurfaceResponse(request, await sendRawMessage(request));
}

function surfaceRequestBase(windowId: number, prefix: string) {
  return {
    protocol: SURFACE_PROTOCOL,
    version: SURFACE_VERSION,
    requestId: requestId(prefix),
    windowId,
  } as const;
}

async function readSurfaceSummary(windowId: number): Promise<SurfaceSummary> {
  const request = {
    ...surfaceRequestBase(windowId, 'popup-summary'),
    type: 'summary',
  } satisfies SurfaceRequest;
  const response = await sendSurfaceRequest(request);
  if (!response.ok) {
    throw new Error(response.errorCode);
  }
  return response.data;
}

async function createSurfaceLaunch(windowId: number, target: SurfaceTarget): Promise<void> {
  const request = {
    ...surfaceRequestBase(windowId, 'popup-launch'),
    type: 'launch',
    target,
  } satisfies SurfaceRequest;
  const response = await sendSurfaceRequest(request);
  if (!response.ok) {
    throw new Error(response.errorCode);
  }
}

async function createXSyncLaunch(): Promise<void> {
  const { X_SYNC_PROTOCOL, parseXSyncUiResponse } = await import('../social/x-sync-messages.js');
  const request = {
    protocol: X_SYNC_PROTOCOL,
    type: 'launch',
    requestId: requestId('popup-x-sync'),
  } as const;
  const response = parseXSyncUiResponse(await sendRawMessage(request));
  if (!response.ok || response.result.kind !== 'launch-intent') {
    throw new Error('x_sync_launch_failed');
  }
}

async function createXSingleJob(): Promise<void> {
  const { parseLegacyResponse } = await import('../shared/extension-messages.js');
  const request = {
    type: 'xSingle:start',
    requestId: requestId('popup-x-single'),
  } as const;
  const response = parseLegacyResponse(request, await sendRawMessage(request));
  if (!response.ok) {
    throw new Error(response.errorCode);
  }
}

function openSidePanelFromGesture(windowId: number): Promise<void> {
  if (!chrome.sidePanel?.open) {
    throw new Error('side_panel_unavailable');
  }
  return chrome.sidePanel.open({ windowId });
}

export interface PopupActionOperations {
  readonly openSidePanel: (windowId: number) => Promise<void>;
  readonly launchSurface: (windowId: number, target: SurfaceTarget) => Promise<void>;
  readonly launchXSingle: () => Promise<void>;
  readonly launchXSync: () => Promise<void>;
}

const DEFAULT_ACTION_OPERATIONS: PopupActionOperations = {
  openSidePanel: openSidePanelFromGesture,
  launchSurface: createSurfaceLaunch,
  launchXSingle: createXSingleJob,
  launchXSync: createXSyncLaunch,
};

export function executePopupAction(
  action: PopupAction,
  browser: PopupBrowserContext,
  operations: PopupActionOperations = DEFAULT_ACTION_OPERATIONS,
): Promise<void> {
  // Keep this invocation before the Promise chain: Chrome consumes the click gesture here.
  const panelPromise = operations.openSidePanel(browser.windowId);
  return (async () => {
    await panelPromise;
    if (action.kind === 'x-sync') {
      await operations.launchSurface(browser.windowId, 'x-sync');
      await operations.launchXSync();
    } else if (action.kind === 'x-single') {
      await operations.launchXSingle();
      await operations.launchSurface(browser.windowId, 'x-single');
    } else if (action.kind === 'bookmarks') {
      await operations.launchSurface(browser.windowId, 'bookmarks-transition');
    }
  })();
}

export function resolvePopupAction(summary: SurfaceSummary, tabKind: PopupTabKind): PopupAction {
  if (summary.activeTask) {
    return {
      kind: 'continue',
      title: summary.activeTask.kind === 'x-single' ? '继续保存当前内容' : '继续同步 X 收藏',
      description: '已有任务正在进行，打开工作区可继续复核或写入。',
      label: '继续当前任务',
      contextLabel: '进行中的任务',
    };
  }

  if (tabKind === 'x-bookmarks') {
    return {
      kind: 'x-sync',
      title: '同步 X 收藏',
      description: '检查当前收藏页中的新增内容，复核后再写入 Obsidian。',
      label: '同步 X 收藏',
      contextLabel: '当前页面可同步',
    };
  }

  if (tabKind === 'x-status') {
    return {
      kind: 'x-single',
      title: '保存当前 X 内容',
      description: '提取当前帖子并进入复核；确认前不会写入 Vault。',
      label: '保存当前内容',
      contextLabel: '当前帖子可保存',
    };
  }

  return {
    kind: 'bookmarks',
    title: '整理 Chrome 书签',
    description: '打开书签工作区，先查看建议，再决定是否应用更改。',
    label: '整理 Chrome 书签',
    contextLabel: 'Chrome 书签',
  };
}

function ActionIcon({ kind }: { readonly kind: PopupActionKind }) {
  if (kind === 'x-sync') return <BookmarkCheck aria-hidden="true" className="h-4 w-4" />;
  if (kind === 'x-single') return <BookOpenCheck aria-hidden="true" className="h-4 w-4" />;
  if (kind === 'continue') return <RotateCcw aria-hidden="true" className="h-4 w-4" />;
  return <PanelRightOpen aria-hidden="true" className="h-4 w-4" />;
}

export function PopupReadyView({
  action,
  busy,
  onAction,
  summary,
}: {
  readonly action: PopupAction;
  readonly busy: boolean;
  readonly onAction: () => void;
  readonly summary: SurfaceSummary;
}) {
  const summaryText =
    action.kind === 'bookmarks'
      ? summary.bookmarkCount !== null && summary.folderCount !== null
        ? `${summary.bookmarkCount.toLocaleString()} 个书签 · ${summary.folderCount.toLocaleString()} 个文件夹`
        : '打开工作区后读取书签概况'
      : summary.vaultConfigured === true
        ? 'Obsidian Vault 已就绪'
        : summary.vaultConfigured === false
          ? '保存前需要在设置中选择 Vault'
          : '保存时会检查 Vault 设置';

  return (
    <>
      <div className="flex flex-1 flex-col justify-center py-8">
        <TaskHeader
          description={action.description}
          eyebrow={action.contextLabel}
          title={action.title}
        />
        <p className="mt-5 border-l-2 border-primary pl-3 text-[13px] leading-5 text-muted-foreground">
          {summaryText}
        </p>
      </div>
      <ActionBar>
        <Button className="h-11 w-full" loading={busy} onClick={onAction}>
          <ActionIcon kind={action.kind} />
          {action.label}
        </Button>
      </ActionBar>
    </>
  );
}

export default function PopupApp() {
  const [state, setState] = useState<PopupState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    setActionFailed(false);
    try {
      const browser = await getPopupBrowserContext();
      const summary = await readSurfaceSummary(browser.windowId);
      setState({ kind: 'ready', browser, summary });
    } catch {
      setState({ kind: 'error' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const action = useMemo(
    () =>
      state.kind === 'ready' ? resolvePopupAction(state.summary, state.browser.tabKind) : undefined,
    [state],
  );

  const runAction = () => {
    if (state.kind !== 'ready' || !action || busy) {
      return;
    }

    let operation: Promise<void>;
    try {
      operation = executePopupAction(action, state.browser);
    } catch {
      setActionFailed(true);
      return;
    }

    setBusy(true);
    setActionFailed(false);
    void operation
      .catch(() => {
        setActionFailed(true);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <main className="flex h-[600px] flex-col px-5 pb-4 pt-5">
      <div className="border-b border-border pb-4">
        <Brand subtitle="当前页面的下一步" />
      </div>

      {state.kind === 'loading' ? <SurfaceLoading label="正在识别当前页面" /> : null}

      {state.kind === 'error' ? (
        <>
          <div className="flex flex-1 flex-col justify-center py-8">
            <TaskHeader
              description="无法安全读取当前页面和任务摘要。没有执行任何书签、同步或写入操作。"
              eyebrow="暂时不可用"
              title="无法准备 ShuHai"
            />
          </div>
          <ActionBar>
            <Button className="h-11 w-full" onClick={() => void load()}>
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              重新加载
            </Button>
          </ActionBar>
        </>
      ) : null}

      {state.kind === 'ready' && action ? (
        <PopupReadyView action={action} busy={busy} onAction={runAction} summary={state.summary} />
      ) : null}

      {actionFailed ? (
        <p className="mt-2 text-[12.5px] leading-5 text-destructive" role="alert">
          任务没有成功启动。请确认当前页面未切换，然后重试。
        </p>
      ) : null}
    </main>
  );
}
