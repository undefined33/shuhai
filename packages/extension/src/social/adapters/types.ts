import type { SocialItem } from '../sync-schema.js';

export type AdapterCapability =
  | {
      readonly kind: 'collection_scan';
      readonly source: 'x';
      readonly adapterVersion: number;
    }
  | { readonly kind: 'unsupported' };

export type AdapterChallenge = 'login_required' | 'captcha' | 'rate_limited';

export type AdapterBudget =
  | 'candidate_items'
  | 'accepted_bytes'
  | 'elapsed_time'
  | 'observed_nodes'
  | 'scroll_actions';

export type AdapterSignal =
  | { readonly kind: 'items' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'terminal' }
  | { readonly kind: 'no_progress'; readonly stopReason: 'no_progress' }
  | {
      readonly kind: 'challenge';
      readonly challenge: AdapterChallenge;
      readonly stopReason: 'login_required' | 'rate_limited';
    }
  | {
      readonly kind: 'budget_exceeded';
      readonly budget: AdapterBudget;
      readonly stopReason: 'budget_exceeded';
    }
  | {
      readonly kind: 'structure_changed';
      readonly stopReason: 'structure_changed';
    }
  | { readonly kind: 'unsupported' };

export interface AdapterBatchMetrics {
  readonly observedNodes: number;
  readonly acceptedItems: number;
  readonly acceptedBytes: number;
  readonly elapsedMs: number;
}

export interface AdapterBatchResult {
  readonly capability: AdapterCapability;
  readonly signal: AdapterSignal;
  readonly items: readonly SocialItem[];
  /** Stable identities observed after the per-card content budget was exhausted. */
  readonly identityOnlySourceItemIds?: readonly string[];
  readonly metrics: AdapterBatchMetrics;
}
