import {
  adaptXBookmarksObservation,
  X_BOOKMARKS_ADAPTER_VERSION,
  X_BOOKMARKS_CEILINGS,
  type XBookmarksLimits,
  type XBookmarkDomEntryObservation,
  type XBookmarksDomObservation,
  type XBookmarksDomSignal,
} from '../social/adapters/x-bookmarks.js';
import {
  parseXSyncContentRequest,
  validateXSyncServiceWorkerSender,
  X_SYNC_BOOKMARKS_URL,
  X_SYNC_PROTOCOL,
  parseXSyncContentResponse,
  type XSyncContentRequest,
  type XSyncContentResponse,
} from '../social/x-sync-messages.js';

const X_STATUS_PATH_PATTERN = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,19})$/u;
const X_SOURCE_ITEM_ID_PATTERN = /^\d{1,19}$/u;
const CONTENT_MARKER = '__shuhaiXBookmarksContentReaderV1Installed';
const CARD_SELECTOR = 'article[data-testid="tweet"]';
const QUOTE_SELECTOR = '[data-testid="quoteTweet"]';
const textEncoder = new TextEncoder();

export const X_BOOKMARKS_CONTENT_PROTOCOL = X_SYNC_PROTOCOL;
export const X_BOOKMARKS_CONTENT_WAIT_MS = 350;
export const X_BOOKMARKS_LAYOUT_TRAVERSAL_CEILING = 10_000;

export interface XBookmarksContentLimits {
  readonly maxEntries: number;
  readonly maxObservedNodes: number;
  readonly maxTextBytes: number;
  readonly maxMedia: number;
}

export const X_BOOKMARKS_CONTENT_CEILINGS: Readonly<XBookmarksContentLimits> = Object.freeze({
  maxEntries: 50,
  maxObservedNodes: 200,
  maxTextBytes: 8 * 1024,
  maxMedia: 12,
});

export type XBookmarksContentRequest = XSyncContentRequest;
export type XBookmarksContentResponse = XSyncContentResponse;

interface ObservationBudget {
  count: number;
  readonly maximum: number;
}

interface LayoutTraversalBudget {
  count: number;
  readonly maximum: number;
}

interface BoundedQueryResult {
  readonly matches: readonly Element[];
  readonly truncated: boolean;
}

interface ParsedPermalink {
  readonly account: string;
  readonly sourceItemId: string;
  readonly canonicalUrl: string;
}

interface MainPermalinkIdentity {
  readonly permalink: ParsedPermalink;
  readonly time: Element;
}

export interface XBookmarksDomCursor {
  readonly candidateSourceItemIds?: readonly string[];
  readonly knownFrontierSourceItemIds?: readonly string[];
  readonly maxUnknownEntries?: number;
}

interface EntryResult {
  readonly ok: boolean;
  readonly entry?: XBookmarkDomEntryObservation;
}

interface ContentRuntime {
  readonly id?: string;
  readonly onMessage: {
    addListener(
      callback: (
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void,
      ) => boolean | void,
    ): void;
  };
}

export interface XBookmarksContentEnvironment {
  readonly document: Document;
  readonly location: Pick<Location, 'href'>;
  readonly window: Pick<Window, 'innerHeight' | 'scrollBy' | 'scrollTo'> & Record<string, unknown>;
  readonly runtime: ContentRuntime;
  readonly wait?: (milliseconds: number) => Promise<void>;
}

export function parseXBookmarksContentRequest(value: unknown): XBookmarksContentRequest | null {
  try {
    return parseXSyncContentRequest(value);
  } catch {
    return null;
  }
}

function observe(budget: ObservationBudget, amount = 1): boolean {
  budget.count = Math.min(Number.MAX_SAFE_INTEGER, budget.count + amount);
  return budget.count <= budget.maximum;
}

function traverseLayout(budget: LayoutTraversalBudget): boolean {
  budget.count = Math.min(Number.MAX_SAFE_INTEGER, budget.count + 1);
  return budget.count <= budget.maximum;
}

function failObservationBudget(budget: ObservationBudget): void {
  budget.count = Math.max(budget.count, budget.maximum + 1);
}

function truncateUtf8(value: string, maximumBytes: number): string {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    return '';
  }
  // At least one UTF-8 byte is required per UTF-16 code unit. Text beyond this
  // window cannot fit, so never encode an attacker-controlled unbounded node.
  const boundedValue = value.slice(0, maximumBytes);
  if (textEncoder.encode(boundedValue).byteLength <= maximumBytes) {
    return boundedValue;
  }
  let low = 0;
  let high = boundedValue.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (textEncoder.encode(boundedValue.slice(0, middle)).byteLength <= maximumBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  if (low > 0) {
    const code = boundedValue.charCodeAt(low - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      low -= 1;
    }
  }
  return boundedValue.slice(0, low);
}

function pushBoundedChildren(parent: Node, stack: Node[], budget: ObservationBudget): boolean {
  const remaining = Math.max(0, budget.maximum - budget.count - stack.length);
  const childCount = parent.childNodes.length;
  if (childCount > remaining) {
    observe(budget, budget.maximum + 1);
    return false;
  }
  for (let index = childCount - 1; index >= 0; index -= 1) {
    const child = parent.childNodes[index];
    if (child) {
      stack.push(child);
    }
  }
  return true;
}

function readBoundedText(root: Element, maximumBytes: number, budget: ObservationBudget): string {
  const stack: Node[] = [];
  try {
    if (!pushBoundedChildren(root, stack, budget)) {
      return '';
    }
  } catch {
    observe(budget, budget.maximum + 1);
    return '';
  }

  let output = '';
  while (stack.length > 0 && budget.count <= budget.maximum) {
    const node = stack.pop();
    if (!node || !observe(budget)) {
      break;
    }
    try {
      if (node.nodeType === 3) {
        const value = node.nodeValue ?? '';
        const remaining = maximumBytes - textEncoder.encode(output).byteLength;
        if (remaining <= 0) {
          break;
        }
        output += truncateUtf8(value, remaining);
        continue;
      }
      if (node.nodeType !== 1) {
        continue;
      }
      const element = node as Element;
      const tagName = element.tagName.toLowerCase();
      if (tagName === 'script' || tagName === 'style' || tagName === 'noscript') {
        continue;
      }
      if (!pushBoundedChildren(element, stack, budget)) {
        break;
      }
    } catch {
      observe(budget, budget.maximum + 1);
      break;
    }
  }

  return output.replace(/\s+/gu, ' ').trim();
}

function safeQuery(root: ParentNode, selector: string): Element | null {
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

function safeQueryAll(
  root: ParentNode,
  selector: string,
  observationBudget: ObservationBudget,
  layoutBudget: LayoutTraversalBudget,
  maximumMatches = Math.max(0, observationBudget.maximum - observationBudget.count),
): BoundedQueryResult | null {
  if (!Number.isSafeInteger(maximumMatches) || maximumMatches < 0) {
    return null;
  }
  try {
    const node = root as ParentNode & Node;
    const documentRef = node.nodeType === 9 ? (node as Document) : node.ownerDocument;
    if (documentRef?.createTreeWalker && typeof node.nodeType === 'number') {
      const walker = documentRef.createTreeWalker(node, 1);
      const matches: Element[] = [];
      while (true) {
        const current = walker.nextNode();
        if (!current) {
          return { matches, truncated: false };
        }
        if (!traverseLayout(layoutBudget)) {
          failObservationBudget(observationBudget);
          return null;
        }
        if (!(current as Element).matches(selector)) {
          continue;
        }
        if (!observe(observationBudget)) {
          return null;
        }
        if (matches.length >= maximumMatches) {
          return { matches, truncated: true };
        }
        matches.push(current as Element);
      }
    }

    // Minimal test fixtures do not expose a browser TreeWalker.
    const candidates = root.querySelectorAll(selector);
    const matches: Element[] = [];
    const inspectedMatches = Math.min(candidates.length, maximumMatches + 1);
    for (let index = 0; index < inspectedMatches; index += 1) {
      if (!observe(observationBudget)) {
        return null;
      }
      if (matches.length >= maximumMatches) {
        return { matches, truncated: true };
      }
      const candidate = candidates[index];
      if (!candidate) {
        return null;
      }
      matches.push(candidate);
    }
    return { matches, truncated: false };
  } catch {
    return null;
  }
}

function safeBoundedQuery(
  root: ParentNode,
  selector: string,
  budget: ObservationBudget,
): Element | null {
  const match = safeQuery(root, selector);
  return match && observe(budget) ? match : null;
}

function isInsideTweet(element: Element): boolean {
  try {
    return element.closest(CARD_SELECTOR) !== null;
  } catch {
    return true;
  }
}

function pageLevelElement(documentRef: Document, selector: string): Element | null {
  const candidate = safeQuery(documentRef, selector);
  return candidate && !isInsideTweet(candidate) ? candidate : null;
}

function pageLevelText(
  documentRef: Document,
  selectors: readonly string[],
  maximumBytes = 1024,
): string {
  const budget: ObservationBudget = { count: 0, maximum: 32 };
  const fragments: string[] = [];
  for (const selector of selectors) {
    const element = pageLevelElement(documentRef, selector);
    if (!element) {
      continue;
    }
    fragments.push(readBoundedText(element, maximumBytes, budget));
    if (budget.count > budget.maximum) {
      return '';
    }
  }
  return fragments.join(' ').toLowerCase();
}

function readPageChallenge(documentRef: Document): XBookmarksDomSignal | null {
  if (
    pageLevelElement(documentRef, 'iframe[src*="captcha"]') ||
    pageLevelElement(documentRef, '[data-testid="captcha"]')
  ) {
    return { kind: 'challenge', challenge: 'captcha' };
  }
  if (
    pageLevelElement(documentRef, '[data-testid="loginButton"]') ||
    pageLevelElement(documentRef, 'form[action="/login"]')
  ) {
    return { kind: 'challenge', challenge: 'login_required' };
  }

  const text = pageLevelText(documentRef, [
    '[role="alert"]',
    '[data-testid="toast"]',
    '[data-testid="emptyState"]',
  ]);
  if (
    text.includes('rate limit') ||
    text.includes('too many requests') ||
    text.includes('try again later') ||
    text.includes('请求过于频繁') ||
    text.includes('请求次数过多')
  ) {
    return { kind: 'challenge', challenge: 'rate_limited' };
  }
  if (
    text.includes('account is locked') ||
    text.includes('account is suspended') ||
    text.includes('verify your identity') ||
    text.includes('账号已锁定') ||
    text.includes('账号已被冻结') ||
    text.includes('验证你的身份')
  ) {
    return { kind: 'challenge', challenge: 'login_required' };
  }
  return null;
}

function hasExplicitEmptyTerminal(documentRef: Document): boolean {
  const text = pageLevelText(documentRef, ['[data-testid="emptyState"]']);
  return (
    text.includes('save posts for later') ||
    text.includes("haven't added any posts") ||
    text.includes('no bookmarks yet') ||
    text.includes('保存帖子以便稍后查看') ||
    text.includes('还没有任何书签') ||
    text.includes('暂无书签')
  );
}

function parsePermalink(value: string | null, pageUrl: string): ParsedPermalink | null {
  if (!value || value.length > 2048 || value.includes('\\')) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(value, pageUrl);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'x.com' ||
    parsed.port !== '' ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    return null;
  }
  const match = X_STATUS_PATH_PATTERN.exec(parsed.pathname);
  const account = match?.[1];
  const sourceItemId = match?.[2];
  return account && sourceItemId
    ? {
        account,
        sourceItemId,
        canonicalUrl: `https://x.com/${account}/status/${sourceItemId}`,
      }
    : null;
}

function findMainPermalink(
  card: Element,
  pageUrl: string,
  observationBudget: ObservationBudget,
  layoutBudget: LayoutTraversalBudget,
): MainPermalinkIdentity | null {
  const result = safeQueryAll(card, 'time[datetime]', observationBudget, layoutBudget, 4);
  if (!result || result.truncated) {
    return null;
  }
  const matches = new Map<string, MainPermalinkIdentity>();
  for (const time of result.matches) {
    let anchor: Element | null;
    try {
      anchor = time.closest('a[href]');
      if (!anchor || anchor.closest(QUOTE_SELECTOR)) {
        continue;
      }
    } catch {
      return null;
    }
    const permalink = parsePermalink(anchor.getAttribute('href'), pageUrl);
    if (permalink) {
      matches.set(permalink.canonicalUrl, { permalink, time });
    }
  }
  return matches.size === 1 ? [...matches.values()][0]! : null;
}

function findMainTweetText(
  card: Element,
  observationBudget: ObservationBudget,
  layoutBudget: LayoutTraversalBudget,
): { readonly ok: boolean; readonly element?: Element } {
  const result = safeQueryAll(
    card,
    '[data-testid="tweetText"]',
    observationBudget,
    layoutBudget,
    8,
  );
  if (!result || result.truncated) {
    return { ok: false };
  }
  for (const candidate of result.matches) {
    try {
      if (!candidate.closest(QUOTE_SELECTOR) && candidate.closest(CARD_SELECTOR) === card) {
        return { ok: true, element: candidate };
      }
    } catch {
      return { ok: false };
    }
  }
  return { ok: true };
}

function readDisplayName(card: Element, budget: ObservationBudget): string | undefined {
  const authorRoot = safeBoundedQuery(card, '[data-testid="User-Name"]', budget);
  if (!authorRoot) {
    return undefined;
  }
  const displayName =
    safeBoundedQuery(authorRoot, '[dir="ltr"] span', budget) ??
    safeBoundedQuery(authorRoot, '[dir="ltr"]', budget);
  if (!displayName) {
    return undefined;
  }
  return readBoundedText(displayName, 512, budget) || undefined;
}

function collectMedia(
  card: Element,
  maximum: number,
  observationBudget: ObservationBudget,
  layoutBudget: LayoutTraversalBudget,
): readonly NonNullable<XBookmarkDomEntryObservation['media']>[number][] | null {
  if (maximum === 0) {
    return [];
  }
  const remainingObservationNodes = Math.max(
    0,
    observationBudget.maximum - observationBudget.count,
  );
  const result = safeQueryAll(
    card,
    'img[src]',
    observationBudget,
    layoutBudget,
    remainingObservationNodes,
  );
  if (!result || result.truncated) {
    return null;
  }
  const media: Array<NonNullable<XBookmarkDomEntryObservation['media']>[number]> = [];
  const seen = new Set<string>();
  for (const image of result.matches) {
    if (media.length >= maximum) {
      break;
    }
    try {
      if (image.closest(QUOTE_SELECTOR) || image.closest(CARD_SELECTOR) !== card) {
        continue;
      }
    } catch {
      return null;
    }
    const rawUrl = image.getAttribute('src');
    if (!rawUrl || rawUrl.length > 2048) {
      continue;
    }
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      continue;
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'pbs.twimg.com' ||
      !parsed.pathname.startsWith('/media/') ||
      parsed.port !== '' ||
      parsed.username !== '' ||
      parsed.password !== ''
    ) {
      continue;
    }
    parsed.hash = '';
    const url = parsed.href;
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);
    const alt = image.getAttribute('alt');
    media.push({
      type: 'image',
      url,
      ...(alt && alt.length <= 1024 ? { alt: truncateUtf8(alt, 512) } : {}),
    });
  }
  return media;
}

function readEntry(
  card: Element,
  pageUrl: string,
  limits: XBookmarksContentLimits,
  observationBudget: ObservationBudget,
  layoutBudget: LayoutTraversalBudget,
  knownIdentity?: MainPermalinkIdentity,
): EntryResult {
  const identity =
    knownIdentity ?? findMainPermalink(card, pageUrl, observationBudget, layoutBudget);
  if (!identity) {
    return { ok: false };
  }
  const textResult = findMainTweetText(card, observationBudget, layoutBudget);
  if (!textResult.ok) {
    return { ok: false };
  }
  const textRoot = textResult.element;
  const text = textRoot
    ? readBoundedText(textRoot, limits.maxTextBytes, observationBudget) || undefined
    : undefined;
  const displayName = readDisplayName(card, observationBudget);
  const media = collectMedia(card, limits.maxMedia, observationBudget, layoutBudget);
  if (!media) {
    return { ok: false };
  }
  const publishedAt = identity.time.getAttribute('datetime') ?? undefined;
  if (publishedAt !== undefined && publishedAt.length > 64) {
    return { ok: false };
  }
  const articleLink = safeBoundedQuery(card, 'a[href*="/i/article/"]', observationBudget);
  return {
    ok: true,
    entry: {
      permalink: identity.permalink.canonicalUrl,
      ...(text === undefined ? {} : { text }),
      author: {
        ...(displayName === undefined ? {} : { displayName }),
        handle: identity.permalink.account,
      },
      ...(publishedAt === undefined ? {} : { publishedAt }),
      contentKind: text === undefined && articleLink ? 'unsupported' : 'post',
      media,
    },
  };
}

export function readXBookmarksDom(
  documentRef: Document,
  pageUrl: string,
  requestedLimits: Partial<XBookmarksContentLimits> = X_BOOKMARKS_CONTENT_CEILINGS,
  cursor: XBookmarksDomCursor = {},
): XBookmarksDomObservation {
  const limits: XBookmarksContentLimits = {
    maxEntries: Math.min(
      Math.max(1, requestedLimits.maxEntries ?? X_BOOKMARKS_CONTENT_CEILINGS.maxEntries),
      X_BOOKMARKS_CONTENT_CEILINGS.maxEntries,
    ),
    maxObservedNodes: Math.min(
      Math.max(
        1,
        requestedLimits.maxObservedNodes ?? X_BOOKMARKS_CONTENT_CEILINGS.maxObservedNodes,
      ),
      X_BOOKMARKS_CONTENT_CEILINGS.maxObservedNodes,
    ),
    maxTextBytes: Math.min(
      Math.max(1, requestedLimits.maxTextBytes ?? X_BOOKMARKS_CONTENT_CEILINGS.maxTextBytes),
      X_BOOKMARKS_CONTENT_CEILINGS.maxTextBytes,
    ),
    maxMedia: Math.min(
      Math.max(0, requestedLimits.maxMedia ?? X_BOOKMARKS_CONTENT_CEILINGS.maxMedia),
      X_BOOKMARKS_CONTENT_CEILINGS.maxMedia,
    ),
  };
  if (pageUrl !== X_SYNC_BOOKMARKS_URL) {
    return {
      pageUrl,
      signal: { kind: 'structure_changed' },
      observedNodeCount: 0,
      entries: [],
    };
  }

  const candidateSourceItemIds = cursor.candidateSourceItemIds ?? [];
  const knownFrontierSourceItemIds = cursor.knownFrontierSourceItemIds ?? [];
  const knownSourceItemIds = [...candidateSourceItemIds, ...knownFrontierSourceItemIds];
  const maxUnknownEntries = Math.min(
    limits.maxEntries,
    Math.max(1, cursor.maxUnknownEntries ?? limits.maxEntries),
  );
  if (
    knownSourceItemIds.some((sourceItemId) => !X_SOURCE_ITEM_ID_PATTERN.test(sourceItemId)) ||
    new Set(knownSourceItemIds).size !== knownSourceItemIds.length
  ) {
    return {
      pageUrl,
      signal: { kind: 'structure_changed' },
      observedNodeCount: 0,
      entries: [],
    };
  }
  const candidateSourceItemIdSet = new Set(candidateSourceItemIds);
  const knownFrontierSourceItemIdSet = new Set(knownFrontierSourceItemIds);

  const challenge = readPageChallenge(documentRef);
  if (challenge) {
    return { pageUrl, signal: challenge, observedNodeCount: 0, entries: [] };
  }
  const primaryColumn = safeQuery(documentRef, '[data-testid="primaryColumn"]');
  if (!primaryColumn) {
    return {
      pageUrl,
      signal: { kind: 'structure_changed' },
      observedNodeCount: 0,
      entries: [],
    };
  }

  const observationBudget: ObservationBudget = { count: 0, maximum: limits.maxObservedNodes };
  const layoutBudget: LayoutTraversalBudget = {
    count: 0,
    maximum: X_BOOKMARKS_LAYOUT_TRAVERSAL_CEILING,
  };
  const cardResult = safeQueryAll(
    primaryColumn,
    CARD_SELECTOR,
    observationBudget,
    layoutBudget,
    Math.min(limits.maxObservedNodes, limits.maxEntries + knownSourceItemIds.length + 1),
  );
  if (!cardResult) {
    return {
      pageUrl,
      signal: { kind: 'structure_changed' },
      observedNodeCount: Math.min(observationBudget.count, limits.maxObservedNodes),
      entries: [],
    };
  }
  if (observationBudget.count > observationBudget.maximum) {
    return {
      pageUrl,
      signal: { kind: 'structure_changed' },
      observedNodeCount: limits.maxObservedNodes,
      entries: [],
    };
  }
  const cards = cardResult.matches;
  if (cards.length === 0) {
    return {
      pageUrl,
      signal: hasExplicitEmptyTerminal(documentRef) ? { kind: 'terminal' } : { kind: 'empty' },
      observedNodeCount: 0,
      entries: [],
    };
  }

  const selectedCards: Array<{ readonly card: Element; readonly identity: MainPermalinkIdentity }> =
    [];
  let pendingCandidateReplay:
    | { readonly card: Element; readonly identity: MainPermalinkIdentity }
    | undefined;
  let fallbackKnownCard:
    | { readonly card: Element; readonly identity: MainPermalinkIdentity }
    | undefined;
  let unknownEntries = 0;
  for (const card of cards) {
    const identity = findMainPermalink(card, pageUrl, observationBudget, layoutBudget);
    if (!identity || observationBudget.count > observationBudget.maximum) {
      return {
        pageUrl,
        signal: { kind: 'structure_changed' },
        observedNodeCount: Math.min(observationBudget.count, limits.maxObservedNodes),
        entries: [],
      };
    }
    const sourceItemId = identity.permalink.sourceItemId;
    if (candidateSourceItemIdSet.has(sourceItemId)) {
      pendingCandidateReplay = { card, identity };
      fallbackKnownCard = { card, identity };
      continue;
    }
    if (knownFrontierSourceItemIdSet.has(sourceItemId)) {
      fallbackKnownCard = { card, identity };
      continue;
    }
    const requiredOutputSlots = pendingCandidateReplay ? 2 : 1;
    if (
      unknownEntries >= maxUnknownEntries ||
      selectedCards.length + requiredOutputSlots > limits.maxEntries
    ) {
      break;
    }
    if (pendingCandidateReplay) {
      selectedCards.push(pendingCandidateReplay);
      pendingCandidateReplay = undefined;
    }
    selectedCards.push({ card, identity });
    unknownEntries += 1;
  }
  if (selectedCards.length === 0 && (pendingCandidateReplay ?? fallbackKnownCard)) {
    selectedCards.push((pendingCandidateReplay ?? fallbackKnownCard)!);
  } else if (pendingCandidateReplay && selectedCards.length < limits.maxEntries) {
    selectedCards.push(pendingCandidateReplay);
  }

  const entries: XBookmarkDomEntryObservation[] = [];
  for (const { card, identity } of selectedCards) {
    const result = readEntry(card, pageUrl, limits, observationBudget, layoutBudget, identity);
    if (!result.ok || !result.entry || observationBudget.count > observationBudget.maximum) {
      return {
        pageUrl,
        signal: { kind: 'structure_changed' },
        observedNodeCount: Math.min(observationBudget.count, limits.maxObservedNodes),
        entries: [],
      };
    }
    entries.push(result.entry);
    if (observationBudget.count > observationBudget.maximum) {
      break;
    }
  }
  return {
    pageUrl,
    signal: { kind: 'items' },
    observedNodeCount: observationBudget.count,
    entries,
  };
}

type ContentScrollAction = 'none' | 'reset_to_top' | 'advance';

async function applyScroll(
  environment: XBookmarksContentEnvironment,
  action: ContentScrollAction,
): Promise<void> {
  if (action === 'none') {
    return;
  }
  if (action === 'reset_to_top') {
    environment.window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  } else {
    const viewport = Number.isFinite(environment.window.innerHeight)
      ? environment.window.innerHeight
      : 800;
    environment.window.scrollBy({
      top: Math.max(320, Math.min(960, Math.floor(viewport * 0.8))),
      left: 0,
      behavior: 'auto',
    });
  }
  await (
    environment.wait ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  )(X_BOOKMARKS_CONTENT_WAIT_MS);
}

export async function handleXBookmarksContentRequest(
  environment: XBookmarksContentEnvironment,
  request: XBookmarksContentRequest,
): Promise<XBookmarksContentResponse> {
  const pageUrl = environment.location.href;
  if (pageUrl !== X_SYNC_BOOKMARKS_URL || request.adapterVersion !== X_BOOKMARKS_ADAPTER_VERSION) {
    throw new Error('X bookmarks document binding changed');
  }
  if (request.type === 'ping') {
    return {
      protocol: X_SYNC_PROTOCOL,
      type: 'pong',
      jobId: request.jobId,
      scanRevision: request.scanRevision,
      adapterVersion: request.adapterVersion,
      step: request.step,
      nonce: request.nonce,
      locationHref: X_SYNC_BOOKMARKS_URL,
    };
  }

  const preScrollChallenge = readPageChallenge(environment.document);
  let scrollAction: ContentScrollAction = 'none';
  if (!preScrollChallenge) {
    if (request.limits.allowScroll) {
      scrollAction =
        request.step === 0 ? (request.mode === 'incremental' ? 'reset_to_top' : 'none') : 'advance';
      if (scrollAction !== 'none' && request.limits.maxScrollActionsRemaining < 1) {
        throw new Error('X bookmarks scroll budget is exhausted');
      }
    }
    await applyScroll(environment, scrollAction);
  }
  if (environment.location.href !== X_SYNC_BOOKMARKS_URL) {
    throw new Error('X bookmarks document binding changed');
  }
  const observation = readXBookmarksDom(
    environment.document,
    environment.location.href,
    {
      maxEntries: X_BOOKMARKS_CONTENT_CEILINGS.maxEntries,
      maxObservedNodes: request.limits.maxObservedNodes,
      maxTextBytes: request.limits.maxTextBytes,
      maxMedia: request.limits.maxMedia,
    },
    {
      candidateSourceItemIds: request.candidateSourceItemIds,
      knownFrontierSourceItemIds: request.knownFrontierSourceItemIds,
      maxUnknownEntries: request.limits.remainingCandidateSlots,
    },
  );
  const limits: Partial<XBookmarksLimits> = {
    maxItems: X_BOOKMARKS_CEILINGS.maxItems,
    maxBatches: 1,
    maxScrollActions: 1,
    maxObservedNodes: request.limits.maxObservedNodes,
    maxElapsedMs: request.limits.maxElapsedMs,
    maxTextBytes: request.limits.maxTextBytes,
    maxMedia: request.limits.maxMedia,
    maxTotalBytes: X_BOOKMARKS_CEILINGS.maxTotalBytes,
    maxCheckpointBytes: X_BOOKMARKS_CEILINGS.maxCheckpointBytes,
    maxConsecutiveStructureErrors: 1,
  };
  const result = await adaptXBookmarksObservation(observation, {
    remainingCandidateSlots: request.limits.remainingCandidateSlots,
    knownSourceItemIds: [...request.candidateSourceItemIds, ...request.knownFrontierSourceItemIds],
    acceptedBytesBefore: X_BOOKMARKS_CEILINGS.maxTotalBytes - request.limits.maxTotalBytes,
    limits,
  });
  return parseXSyncContentResponse({
    protocol: X_SYNC_PROTOCOL,
    type: 'batch-result',
    jobId: request.jobId,
    scanRevision: request.scanRevision,
    adapterVersion: request.adapterVersion,
    step: request.step,
    nonce: request.nonce,
    locationHref: X_SYNC_BOOKMARKS_URL,
    result: { ...result, items: [...result.items] },
  });
}

export function installXBookmarksContentReader(environment: XBookmarksContentEnvironment): boolean {
  const runtimeId = environment.runtime.id;
  if (!runtimeId) {
    return false;
  }
  let marker: PropertyDescriptor | undefined;
  try {
    marker = Object.getOwnPropertyDescriptor(environment.window, CONTENT_MARKER);
  } catch {
    return false;
  }
  if (marker) {
    return false;
  }
  try {
    Object.defineProperty(environment.window, CONTENT_MARKER, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
  } catch {
    return false;
  }

  environment.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const extensionOrigin = `chrome-extension://${runtimeId}`;
    if (!validateXSyncServiceWorkerSender(sender, runtimeId, extensionOrigin).ok) {
      return false;
    }
    const request = parseXBookmarksContentRequest(message);
    if (!request) {
      return false;
    }
    void handleXBookmarksContentRequest(environment, request).then(
      (response) => sendResponse(response),
      () => sendResponse(undefined),
    );
    return true;
  });
  return true;
}

const contentWindow =
  typeof window === 'undefined'
    ? undefined
    : (window as unknown as Window & Record<string, unknown>);

if (contentWindow && typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  installXBookmarksContentReader({
    document,
    location,
    window: contentWindow,
    runtime: chrome.runtime,
  });
}
