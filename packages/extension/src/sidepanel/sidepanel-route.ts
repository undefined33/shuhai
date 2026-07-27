import type { SurfaceSummary } from '../shared/surface-contract.js';

export const SIDE_PANEL_RETRY_DELAYS_MS = [100, 300, 700, 1_300, 2_000] as const;

export type SidePanelRoute =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'x-task';
      readonly intentId?: string;
      readonly target: 'x-sync' | 'x-single';
    }
  | {
      readonly kind: 'bookmarks-transition';
      readonly intentId: string;
    };

export function selectSidePanelRoute(summary: SurfaceSummary): SidePanelRoute {
  if (summary.activeTask) {
    return {
      kind: 'x-task',
      target: summary.activeTask.kind,
    };
  }

  if (summary.pendingLaunch?.target === 'x-sync' || summary.pendingLaunch?.target === 'x-single') {
    return {
      kind: 'x-task',
      intentId: summary.pendingLaunch.intentId,
      target: summary.pendingLaunch.target,
    };
  }

  if (summary.pendingLaunch?.target === 'bookmarks-transition') {
    return {
      kind: 'bookmarks-transition',
      intentId: summary.pendingLaunch.intentId,
    };
  }

  return { kind: 'idle' };
}

export function canRefreshSidePanelRoute(route: SidePanelRoute | 'loading' | 'error'): boolean {
  return route === 'loading' || (typeof route !== 'string' && route.kind === 'idle');
}

export interface TrailingRefreshGate {
  refresh(): Promise<void>;
}

export function createTrailingRefreshGate(
  run: () => Promise<void>,
  shouldRunTrailing: () => boolean,
): TrailingRefreshGate {
  let inFlight: Promise<void> | undefined;
  let trailingRequested = false;

  const refresh = (): Promise<void> => {
    if (inFlight) {
      trailingRequested = true;
      return inFlight;
    }

    const operation = Promise.resolve().then(run);
    const settled = operation.finally(() => {
      if (inFlight !== settled) {
        return;
      }
      inFlight = undefined;
      if (!trailingRequested) {
        return;
      }
      trailingRequested = false;
      if (shouldRunTrailing()) {
        void refresh().catch(() => undefined);
      }
    });
    inFlight = settled;
    return settled;
  };

  return { refresh };
}
