import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenCheck, BookmarkCheck, RefreshCw, Settings } from 'lucide-react';

import { Button } from '../components/ui/button.js';
import { ActionBar } from '../shell/ActionBar.js';
import { Brand } from '../shell/Brand.js';
import { SurfaceLoading } from '../shell/SurfaceLoading.js';
import { TaskHeader } from '../shell/TaskHeader.js';
import {
  SURFACE_PROTOCOL,
  SURFACE_REGISTRY_KEY,
  SURFACE_VERSION,
  parseSurfaceResponse,
  type SurfaceRequest,
  type SurfaceResponse,
  type SurfaceSummary,
} from '../shared/surface-contract.js';
import {
  SIDE_PANEL_RETRY_DELAYS_MS,
  canRefreshSidePanelRoute,
  createTrailingRefreshGate,
  selectSidePanelRoute,
  type SidePanelRoute,
} from './sidepanel-route.js';

const LazyXSyncPage = lazy(() => import('../popup/pages/XSyncPage.js'));
const LazyBookmarkTaskApp = lazy(() => import('../tasks/bookmarks/BookmarkTaskApp.js'));

type SidePanelState = 'loading' | 'error' | SidePanelRoute;

function requestId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) {
    throw new Error('request_id_unavailable');
  }
  return `${prefix}-${uuid}`;
}

function getCurrentWindowId(): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.windows.getCurrent((currentWindow) => {
      if (chrome.runtime.lastError || typeof currentWindow.id !== 'number') {
        reject(new Error('window_unavailable'));
        return;
      }
      resolve(currentWindow.id);
    });
  });
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
    ...surfaceRequestBase(windowId, 'sidepanel-summary'),
    type: 'summary',
  } satisfies SurfaceRequest;
  const response = await sendSurfaceRequest(request);
  if (!response.ok) {
    throw new Error(response.errorCode);
  }
  return response.data;
}

async function acknowledgeLaunch(windowId: number, intentId: string): Promise<void> {
  const request = {
    ...surfaceRequestBase(windowId, 'sidepanel-ack'),
    type: 'ackLaunch',
    intentId,
  } satisfies SurfaceRequest;
  const response = await sendSurfaceRequest(request);
  if (!response.ok) {
    throw new Error(response.errorCode);
  }
}

export function SidePanelIdle({
  onBookmarks,
  onX,
}: {
  readonly onBookmarks: () => void;
  readonly onX: () => void;
}) {
  return (
    <div className="flex min-h-[28rem] flex-col justify-center">
      <TaskHeader
        description="选择一个任务。ShuHai 只在你确认后修改书签或写入知识库。"
        eyebrow="任务工作区"
        title="现在要做什么？"
      />
      <div className="mt-7 divide-y divide-border border-y border-border">
        <button
          className="group flex w-full items-center gap-3 px-1 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onBookmarks}
          type="button"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <BookmarkCheck aria-hidden="true" className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">整理 Chrome 书签</span>
            <span className="mt-0.5 block text-[12.5px] leading-5 text-muted-foreground">
              查看建议、复核并应用
            </span>
          </span>
          <span aria-hidden="true" className="text-muted-foreground group-hover:text-foreground">
            →
          </span>
        </button>
        <button
          className="group flex w-full items-center gap-3 px-1 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onX}
          type="button"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            <BookOpenCheck aria-hidden="true" className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">查看 X 收藏同步</span>
            <span className="mt-0.5 block text-[12.5px] leading-5 text-muted-foreground">
              在 X 收藏页从工具栏启动新批次
            </span>
          </span>
          <span aria-hidden="true" className="text-muted-foreground group-hover:text-foreground">
            →
          </span>
        </button>
      </div>
    </div>
  );
}

export default function SidePanelApp() {
  const [state, setState] = useState<SidePanelState>('loading');
  const stateRef = useRef<SidePanelState>('loading');
  const windowIdRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);

  const commitState = useCallback((next: SidePanelState) => {
    stateRef.current = next;
    if (mountedRef.current) {
      setState(next);
    }
  }, []);

  const performRefresh = useCallback(async (): Promise<void> => {
    const windowId = windowIdRef.current;
    if (windowId === undefined) {
      commitState('error');
      return;
    }

    try {
      const summary = await readSurfaceSummary(windowId);
      const next = selectSidePanelRoute(summary);
      if ('intentId' in next && next.intentId) {
        await acknowledgeLaunch(windowId, next.intentId);
      }
      commitState(next);
    } catch {
      commitState('error');
    }
  }, [commitState]);

  const refreshGate = useMemo(
    () =>
      createTrailingRefreshGate(
        performRefresh,
        () => mountedRef.current && canRefreshSidePanelRoute(stateRef.current),
      ),
    [performRefresh],
  );
  const refresh = useCallback(() => refreshGate.refresh(), [refreshGate]);

  useEffect(() => {
    mountedRef.current = true;
    const timers: Array<ReturnType<typeof globalThis.setTimeout>> = [];
    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (
        areaName === 'session' &&
        Object.prototype.hasOwnProperty.call(changes, SURFACE_REGISTRY_KEY) &&
        canRefreshSidePanelRoute(stateRef.current)
      ) {
        void refresh();
      }
    };
    chrome.storage.onChanged.addListener(onStorageChanged);

    void getCurrentWindowId()
      .then((windowId) => {
        if (!mountedRef.current) return;
        windowIdRef.current = windowId;
        void refresh();
        for (const delay of SIDE_PANEL_RETRY_DELAYS_MS) {
          timers.push(
            globalThis.setTimeout(() => {
              if (canRefreshSidePanelRoute(stateRef.current)) {
                void refresh();
              }
            }, delay),
          );
        }
      })
      .catch(() => commitState('error'));

    return () => {
      mountedRef.current = false;
      chrome.storage.onChanged.removeListener(onStorageChanged);
      for (const timer of timers) {
        globalThis.clearTimeout(timer);
      }
    };
  }, [commitState, refresh]);

  const openBookmarks = () => {
    commitState({ kind: 'bookmarks-transition', intentId: 'local-transition' });
  };

  if (typeof state !== 'string' && state.kind === 'bookmarks-transition') {
    return (
      <main className="flex h-screen min-h-0 flex-col px-4 pb-4 pt-4 sm:px-5">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border pb-3">
          <Brand subtitle="当前任务工作区" />
          <Button
            aria-label="打开设置"
            onClick={() => void chrome.runtime.openOptionsPage()}
            size="icon"
            title="打开设置"
            variant="ghost"
          >
            <Settings aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 pt-4">
          <Suspense fallback={<SurfaceLoading label="正在打开书签工作区" />}>
            <LazyBookmarkTaskApp onExit={() => commitState({ kind: 'idle' })} />
          </Suspense>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-screen min-h-0 flex-col px-4 pb-4 pt-4 sm:px-5">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border pb-3">
        <Brand subtitle="当前任务工作区" />
        <Button
          aria-label="打开设置"
          onClick={() => void chrome.runtime.openOptionsPage()}
          size="icon"
          title="打开设置"
          variant="ghost"
        >
          <Settings aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pt-4">
        {state === 'loading' ? <SurfaceLoading /> : null}

        {state === 'error' ? (
          <div className="flex min-h-[28rem] flex-col justify-center">
            <TaskHeader
              description="无法安全读取当前任务。没有取消任务、修改书签或写入 Vault。"
              eyebrow="暂时不可用"
              title="无法打开工作区"
            />
            <ActionBar>
              <Button className="w-full" onClick={() => void refresh()}>
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
                重新加载
              </Button>
            </ActionBar>
          </div>
        ) : null}

        {typeof state !== 'string' && state.kind === 'idle' ? (
          <SidePanelIdle
            onBookmarks={openBookmarks}
            onX={() => commitState({ kind: 'x-task', target: 'x-sync' })}
          />
        ) : null}

        {typeof state !== 'string' && state.kind === 'x-task' ? (
          <div className="min-h-full">
            <TaskHeader
              description="只处理当前 X 收藏任务；写入前仍需复核和确认。"
              eyebrow="X 收藏"
              title="同步与复核"
            />
            <div className="mt-4 min-h-72">
              <Suspense fallback={<SurfaceLoading label="正在加载 X 同步任务" />}>
                <LazyXSyncPage onExit={() => void refresh()} />
              </Suspense>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
