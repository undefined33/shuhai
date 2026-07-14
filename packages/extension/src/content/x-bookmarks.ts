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
const CONTENT_MARKER = '__shuhaiXBookmarksContentReaderV1Installed';
const CARD_SELECTOR = 'article[data-testid="tweet"]';
const QUOTE_SELECTOR = '[data-testid="quoteTweet"]';
const textEncoder = new TextEncoder();

export const X_BOOKMARKS_CONTENT_PROTOCOL = X_SYNC_PROTOCOL;
export const X_BOOKMARKS_CONTENT_WAIT_MS = 350;

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

interface ParsedPermalink {
  readonly account: string;
  readonly canonicalUrl: string;
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
  budget: ObservationBudget,
  maximumMatches = budget.maximum + 1,
): readonly Element[] | null {
  try {
    const node = root as ParentNode & Node;
    const documentRef = node.nodeType === 9 ? (node as Document) : node.ownerDocument;
    if (documentRef?.createTreeWalker && typeof node.nodeType === 'number') {
      const walker = documentRef.createTreeWalker(node, 1);
      const matches: Element[] = [];
      let current = walker.nextNode();
      while (current && matches.length < maximumMatches) {
        if (!observe(budget)) {
          break;
        }
        if ((current as Element).matches(selector)) {
          matches.push(current as Element);
        }
        current = walker.nextNode();
      }
      return matches;
    }

    // Test fixtures use a minimal ParentNode without browser TreeWalker support.
    const candidates = root.querySelectorAll(selector);
    const matches: Element[] = [];
    for (let index = 0; index < candidates.length && index < maximumMatches; index += 1) {
      if (!observe(budget)) {
        break;
      }
      matches.push(candidates[index]!);
    }
    return matches;
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
    ? { account, canonicalUrl: `https://x.com/${account}/status/${sourceItemId}` }
    : null;
}

function findMainPermalink(
  card: Element,
  pageUrl: string,
  budget: ObservationBudget,
): { permalink: ParsedPermalink; time: Element } | null {
  const timeElements = safeQueryAll(card, 'time[datetime]', budget, 4);
  if (!timeElements) {
    return null;
  }
  const matches = new Map<string, { permalink: ParsedPermalink; time: Element }>();
  for (const time of timeElements) {
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

function findMainTweetText(card: Element, budget: ObservationBudget): Element | null {
  const candidates = safeQueryAll(card, '[data-testid="tweetText"]', budget, 8);
  if (!candidates) {
    return null;
  }
  for (const candidate of candidates) {
    try {
      if (!candidate.closest(QUOTE_SELECTOR) && candidate.closest(CARD_SELECTOR) === card) {
        return candidate;
      }
    } catch {
      return null;
    }
  }
  return null;
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
  budget: ObservationBudget,
): readonly NonNullable<XBookmarkDomEntryObservation['media']>[number][] | null {
  const images = safeQueryAll(card, 'img[src]', budget);
  if (!images) {
    return null;
  }
  const media: Array<NonNullable<XBookmarkDomEntryObservation['media']>[number]> = [];
  const seen = new Set<string>();
  for (const image of images) {
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
  budget: ObservationBudget,
): EntryResult {
  const identity = findMainPermalink(card, pageUrl, budget);
  if (!identity) {
    return { ok: false };
  }
  const textRoot = findMainTweetText(card, budget);
  const text = textRoot
    ? readBoundedText(textRoot, limits.maxTextBytes, budget) || undefined
    : undefined;
  const displayName = readDisplayName(card, budget);
  const media = collectMedia(card, limits.maxMedia, budget);
  if (!media) {
    return { ok: false };
  }
  const publishedAt = identity.time.getAttribute('datetime') ?? undefined;
  if (publishedAt !== undefined && publishedAt.length > 64) {
    return { ok: false };
  }
  const articleLink = safeBoundedQuery(card, 'a[href*="/i/article/"]', budget);
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

  const budget: ObservationBudget = { count: 0, maximum: limits.maxObservedNodes };
  const cards = safeQueryAll(primaryColumn, CARD_SELECTOR, budget, limits.maxEntries + 1);
  if (!cards) {
    return {
      pageUrl,
      signal: { kind: 'structure_changed' },
      observedNodeCount: 0,
      entries: [],
    };
  }
  if (budget.count > budget.maximum) {
    return {
      pageUrl,
      signal: { kind: 'structure_changed' },
      observedNodeCount: limits.maxObservedNodes,
      entries: [],
    };
  }
  if (cards.length === 0) {
    return {
      pageUrl,
      signal: hasExplicitEmptyTerminal(documentRef) ? { kind: 'terminal' } : { kind: 'empty' },
      observedNodeCount: 0,
      entries: [],
    };
  }

  const entries: XBookmarkDomEntryObservation[] = [];
  for (const card of cards.slice(0, limits.maxEntries)) {
    const result = readEntry(card, pageUrl, limits, budget);
    if (!result.ok || !result.entry || budget.count > budget.maximum) {
      return {
        pageUrl,
        signal: { kind: 'structure_changed' },
        observedNodeCount: Math.min(budget.count, limits.maxObservedNodes),
        entries: [],
      };
    }
    entries.push(result.entry);
    if (budget.count > budget.maximum) {
      break;
    }
  }
  return {
    pageUrl,
    signal: { kind: 'items' },
    observedNodeCount: budget.count,
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
  const observation = readXBookmarksDom(environment.document, environment.location.href, {
    maxEntries: Math.max(1, request.limits.remainingCandidateSlots),
    maxObservedNodes: request.limits.maxObservedNodes,
    maxTextBytes: request.limits.maxTextBytes,
    maxMedia: request.limits.maxMedia,
  });
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
