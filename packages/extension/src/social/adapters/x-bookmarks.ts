import {
  IsoTimestampSchema,
  SocialItemSchema,
  SYNC_KNOWN_FRONTIER_LIMIT,
  SYNC_LIMITS,
  SYNC_SCHEMA_VERSION,
  XSourceItemIdSchema,
  type RemoteMedia,
  type SocialItem,
} from '../sync-schema.js';
import type {
  AdapterBatchMetrics,
  AdapterBatchResult,
  AdapterBudget,
  AdapterCapability,
  AdapterChallenge,
  AdapterSignal,
} from './types.js';

const X_BOOKMARKS_PAGE_URL = 'https://x.com/i/bookmarks';
const X_STATUS_PATH_PATTERN = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,19})$/u;
const X_ACCOUNT_PATTERN = /^[A-Za-z0-9_]{1,15}$/u;
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const textEncoder = new TextEncoder();

export const X_BOOKMARKS_ADAPTER_VERSION = 1 as const;

export interface XBookmarksLimits {
  readonly maxItems: number;
  readonly maxBatches: number;
  readonly maxScrollActions: number;
  readonly maxObservedNodes: number;
  readonly maxElapsedMs: number;
  readonly maxTextBytes: number;
  readonly maxMedia: number;
  readonly maxTotalBytes: number;
  readonly maxCheckpointBytes: number;
  readonly maxConsecutiveStructureErrors: number;
}

export const X_BOOKMARKS_CEILINGS: Readonly<XBookmarksLimits> = Object.freeze({
  maxItems: 50,
  maxBatches: 20,
  maxScrollActions: 20,
  maxObservedNodes: 200,
  maxElapsedMs: 15_000,
  maxTextBytes: 8 * 1_024,
  maxMedia: 12,
  maxTotalBytes: 16 * 1_024 * 1_024,
  maxCheckpointBytes: 64 * 1_024,
  maxConsecutiveStructureErrors: 1,
});

export type XBookmarksDomSignal =
  | { readonly kind: 'items' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'terminal' }
  | { readonly kind: 'challenge'; readonly challenge: AdapterChallenge }
  | { readonly kind: 'structure_changed' };

export interface XBookmarkDomMediaObservation {
  readonly type: 'image' | 'video' | 'link';
  readonly url: string;
  readonly alt?: string;
}

export interface XBookmarkDomAuthorObservation {
  readonly displayName?: string;
  readonly handle?: string;
}

export interface XBookmarkDomEntryObservation {
  readonly permalink: string;
  readonly title?: string;
  readonly text?: string;
  readonly author?: XBookmarkDomAuthorObservation;
  readonly publishedAt?: string;
  readonly contentKind?: 'post' | 'unsupported';
  readonly media?: readonly XBookmarkDomMediaObservation[];
}

/**
 * A future isolated-world content script implements this narrow reader. The adapter never receives
 * Document, Element, HTML, page functions, credentials, storage, or arbitrary network capability.
 */
export interface XBookmarksDomReadPort {
  readPageUrl(): unknown;
  readSignal(): unknown;
  readObservedNodeCount(): unknown;
  readEntryCount(): unknown;
  readEntry(index: number): unknown;
}

export interface XBookmarksDomObservation {
  readonly pageUrl: string;
  readonly signal: XBookmarksDomSignal;
  readonly observedNodeCount: number;
  readonly entries: readonly XBookmarkDomEntryObservation[];
}

export interface XBookmarksAdapterOptions {
  readonly capturedAt?: string;
  readonly remainingCandidateSlots?: number;
  readonly knownSourceItemIds?: readonly string[];
  readonly acceptedBytesBefore?: number;
  readonly limits?: Partial<XBookmarksLimits>;
  readonly now?: () => number;
}

type PlainRecord = Record<string, unknown>;

interface BoundedText {
  readonly value?: string;
  readonly truncated: boolean;
}

interface ParsedPermalink {
  readonly account: string;
  readonly sourceItemId: string;
  readonly canonicalUrl: string;
}

interface ParsedEntry {
  readonly item: SocialItem;
  readonly acceptedBytes: number;
}

interface Clock {
  readonly startedAt: number;
  readonly now: () => number | null;
  readonly elapsed: () => number | null;
}

const LIMIT_KEYS = Object.freeze(
  Object.keys(X_BOOKMARKS_CEILINGS) as Array<keyof XBookmarksLimits>,
);

function isControlCharacter(code: number): boolean {
  return code <= 31 || (code >= 127 && code <= 159);
}

function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (isControlCharacter(value.charCodeAt(index))) {
      return true;
    }
  }
  return false;
}

function inspectPlainRecord(value: unknown, allowedKeys: ReadonlySet<string>): PlainRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  if (prototype !== Object.prototype && prototype !== null) {
    return null;
  }

  const inspected = Object.create(null) as PlainRecord;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || FORBIDDEN_OBJECT_KEYS.has(key) || !allowedKeys.has(key)) {
      return null;
    }
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return null;
    }
    inspected[key] = descriptor.value;
  }
  return inspected;
}

function own(record: PlainRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function readArrayPrefix(value: unknown, maximum: number): readonly unknown[] | null {
  let isArray: boolean;
  let prototype: object | null;
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    isArray = Array.isArray(value);
    prototype = isArray ? Object.getPrototypeOf(value) : null;
    lengthDescriptor = isArray ? Object.getOwnPropertyDescriptor(value, 'length') : undefined;
  } catch {
    return null;
  }
  if (
    !isArray ||
    prototype !== Array.prototype ||
    !lengthDescriptor ||
    !('value' in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    return null;
  }

  const length = Math.min(lengthDescriptor.value as number, maximum);
  const prefix: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch {
      return null;
    }
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return null;
    }
    prefix.push(descriptor.value);
  }
  return prefix;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/gu, '\n');
}

function removeNonTextControls(value: string): string {
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    const code = value.charCodeAt(index);
    if (character === '\n' || character === '\t' || !isControlCharacter(code)) {
      output += character;
    }
  }
  return output;
}

function truncateUtf8(value: string, maximumBytes: number): BoundedText {
  const encoded = textEncoder.encode(value);
  if (encoded.byteLength <= maximumBytes) {
    return { value: value || undefined, truncated: false };
  }

  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (textEncoder.encode(value.slice(0, middle)).byteLength <= maximumBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  if (low > 0) {
    const finalCode = value.charCodeAt(low - 1);
    if (finalCode >= 0xd800 && finalCode <= 0xdbff) {
      low -= 1;
    }
  }
  const bounded = value.slice(0, low);
  return { value: bounded || undefined, truncated: true };
}

function normalizeBoundedText(value: unknown, maximumBytes: number): BoundedText | null {
  if (value === undefined) {
    return { truncated: false };
  }
  if (typeof value !== 'string') {
    return null;
  }

  // Bound normalization work before touching an attacker-controlled long string.
  const maximumCodeUnits = Math.max(maximumBytes * 4, 32);
  const prebounded = value.slice(0, maximumCodeUnits);
  let normalized: string;
  try {
    normalized = removeNonTextControls(normalizeLineEndings(prebounded)).normalize('NFC');
  } catch {
    return null;
  }
  const bounded = truncateUtf8(normalized, maximumBytes);
  return {
    value: bounded.value,
    truncated: bounded.truncated || prebounded.length !== value.length,
  };
}

function parseStrictAttribute(value: unknown, maximumCodeUnits: number): string | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumCodeUnits ||
    value !== value.trim() ||
    value.includes('\\') ||
    containsControlCharacters(value)
  ) {
    return null;
  }
  return value;
}

function parsePermalink(value: unknown): ParsedPermalink | null {
  const permalink = parseStrictAttribute(value, SYNC_LIMITS.canonicalUrlBytes);
  if (!permalink || !permalink.startsWith('https://')) {
    return null;
  }
  const authorityStart = 'https://'.length;
  const authorityRemainder = permalink.slice(authorityStart);
  const authorityDelimiter = authorityRemainder.search(/[/?#]/u);
  const authorityEnd =
    authorityDelimiter === -1 ? permalink.length : authorityStart + authorityDelimiter;
  const authority = permalink.slice(authorityStart, authorityEnd);
  if (authority !== 'x.com') {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(permalink);
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
  if (!match) {
    return null;
  }
  const [, account, sourceItemId] = match;
  if (!account || !sourceItemId) {
    return null;
  }
  return {
    account,
    sourceItemId,
    canonicalUrl: `https://x.com/${account}/status/${sourceItemId}`,
  };
}

function parseAuthor(value: unknown, account: string): SocialItem['author'] | null {
  if (value === undefined) {
    return { handle: account };
  }
  const record = inspectPlainRecord(value, new Set(['displayName', 'handle']));
  if (!record) {
    return null;
  }

  const displayName = normalizeBoundedText(record.displayName, SYNC_LIMITS.authorDisplayNameBytes);
  if (!displayName) {
    return null;
  }
  let handle = account;
  if (own(record, 'handle')) {
    const rawHandle = parseStrictAttribute(record.handle, 16);
    if (!rawHandle) {
      return null;
    }
    const withoutAt = rawHandle.startsWith('@') ? rawHandle.slice(1) : rawHandle;
    if (!X_ACCOUNT_PATTERN.test(withoutAt) || withoutAt.toLowerCase() !== account.toLowerCase()) {
      return null;
    }
    handle = account;
  }

  return {
    ...(displayName.value === undefined ? {} : { displayName: displayName.value }),
    handle,
  };
}

function parseMediaUrl(value: unknown): string | null {
  const rawUrl = parseStrictAttribute(value, SYNC_LIMITS.canonicalUrlBytes);
  if (!rawUrl || !rawUrl.startsWith('https://')) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname === '' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== ''
  ) {
    return null;
  }
  parsed.hash = '';
  return parsed.href;
}

function parseMedia(value: unknown, maximumItems: number): readonly RemoteMedia[] | null {
  if (value === undefined) {
    return [];
  }
  const values = readArrayPrefix(value, maximumItems);
  if (!values) {
    return null;
  }

  const mediaByKey = new Map<string, RemoteMedia>();
  for (const raw of values) {
    const record = inspectPlainRecord(raw, new Set(['type', 'url', 'alt']));
    if (
      !record ||
      typeof record.type !== 'string' ||
      !['image', 'video', 'link'].includes(record.type)
    ) {
      return null;
    }
    const url = parseMediaUrl(record.url);
    if (!url) {
      continue;
    }
    const alt = normalizeBoundedText(record.alt, SYNC_LIMITS.mediaAltBytes);
    if (!alt) {
      return null;
    }
    const media: RemoteMedia = {
      type: record.type as RemoteMedia['type'],
      url,
      ...(alt.value === undefined ? {} : { alt: alt.value }),
    };
    const key = `${media.type}\u0000${media.url}\u0000${media.alt ?? ''}`;
    mediaByKey.set(key, media);
  }

  return [...mediaByKey.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, media]) => media);
}

function parsePublishedAt(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = IsoTimestampSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  try {
    return new Date(parsed.data).toISOString();
  } catch {
    return null;
  }
}

function serializeHashInput(item: Omit<SocialItem, 'capturedAt' | 'contentHash'>): string {
  return JSON.stringify({
    schemaVersion: item.schemaVersion,
    source: item.source,
    sourceItemId: item.sourceItemId,
    canonicalUrl: item.canonicalUrl,
    title: item.title ?? null,
    text: item.text ?? null,
    author:
      item.author === undefined
        ? null
        : {
            displayName: item.author.displayName ?? null,
            handle: item.author.handle ?? null,
          },
    publishedAt: item.publishedAt ?? null,
    completeness: item.completeness,
    media: item.media.map((media) => ({
      type: media.type,
      url: media.url,
      alt: media.alt ?? null,
    })),
    extractorVersion: item.extractorVersion,
  });
}

async function sha256(value: string): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      return null;
    }
    const digest = await subtle.digest('SHA-256', textEncoder.encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

async function parseEntry(
  value: unknown,
  capturedAt: string,
  limits: XBookmarksLimits,
): Promise<ParsedEntry | null> {
  const record = inspectPlainRecord(
    value,
    new Set(['permalink', 'title', 'text', 'author', 'publishedAt', 'contentKind', 'media']),
  );
  if (!record) {
    return null;
  }
  const permalink = parsePermalink(record.permalink);
  if (!permalink) {
    return null;
  }
  if (
    own(record, 'contentKind') &&
    record.contentKind !== 'post' &&
    record.contentKind !== 'unsupported'
  ) {
    return null;
  }

  const title = normalizeBoundedText(record.title, SYNC_LIMITS.titleBytes);
  const text = normalizeBoundedText(record.text, limits.maxTextBytes);
  const author = parseAuthor(record.author, permalink.account);
  const publishedAt = parsePublishedAt(record.publishedAt);
  const media = parseMedia(record.media, limits.maxMedia);
  if (!title || !text || !author || publishedAt === null || !media) {
    return null;
  }

  const completeness =
    record.contentKind === 'unsupported'
      ? ('unsupported' as const)
      : text.value === undefined
        ? ('metadata_only' as const)
        : ('summary_only' as const);
  const itemWithoutHash: Omit<SocialItem, 'capturedAt' | 'contentHash'> = {
    schemaVersion: SYNC_SCHEMA_VERSION,
    source: 'x',
    sourceItemId: permalink.sourceItemId,
    canonicalUrl: permalink.canonicalUrl,
    ...(title.value === undefined ? {} : { title: title.value }),
    ...(text.value === undefined ? {} : { text: text.value }),
    author,
    ...(publishedAt === undefined ? {} : { publishedAt }),
    completeness,
    media: [...media],
    extractorVersion: X_BOOKMARKS_ADAPTER_VERSION,
  };
  const contentHash = await sha256(serializeHashInput(itemWithoutHash));
  if (!contentHash) {
    return null;
  }
  const candidate = {
    ...itemWithoutHash,
    capturedAt,
    contentHash,
  };
  const parsed = SocialItemSchema.safeParse(candidate);
  if (!parsed.success) {
    return null;
  }
  let acceptedBytes: number;
  try {
    acceptedBytes = textEncoder.encode(JSON.stringify(parsed.data)).byteLength;
  } catch {
    return null;
  }
  return { item: parsed.data, acceptedBytes };
}

function parseSignal(value: unknown): XBookmarksDomSignal | null {
  const record = inspectPlainRecord(value, new Set(['kind', 'challenge']));
  if (!record || typeof record.kind !== 'string') {
    return null;
  }
  if (record.kind === 'challenge') {
    if (
      !own(record, 'challenge') ||
      typeof record.challenge !== 'string' ||
      !['login_required', 'captcha', 'rate_limited'].includes(record.challenge)
    ) {
      return null;
    }
    return { kind: 'challenge', challenge: record.challenge as AdapterChallenge };
  }
  if (own(record, 'challenge')) {
    return null;
  }
  if (['items', 'empty', 'terminal', 'structure_changed'].includes(record.kind)) {
    return { kind: record.kind } as XBookmarksDomSignal;
  }
  return null;
}

function callPort(port: XBookmarksDomReadPort, methodName: keyof XBookmarksDomReadPort): unknown {
  try {
    const method = port[methodName];
    return typeof method === 'function' ? Reflect.apply(method, port, []) : undefined;
  } catch {
    return undefined;
  }
}

function readEntry(port: XBookmarksDomReadPort, index: number): unknown {
  try {
    return port.readEntry(index);
  } catch {
    return undefined;
  }
}

function createClock(now: () => number): Clock | null {
  let startedAt: number;
  try {
    startedAt = now();
  } catch {
    return null;
  }
  if (!Number.isFinite(startedAt)) {
    return null;
  }
  const safeNow = (): number | null => {
    try {
      const value = now();
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  };
  return {
    startedAt,
    now: safeNow,
    elapsed: () => {
      const current = safeNow();
      return current === null ? null : Math.max(0, current - startedAt);
    },
  };
}

function baseMetrics(overrides: Partial<AdapterBatchMetrics> = {}): AdapterBatchMetrics {
  return {
    observedNodes: 0,
    acceptedItems: 0,
    acceptedBytes: 0,
    elapsedMs: 0,
    ...overrides,
  };
}

function result(
  capability: AdapterCapability,
  signal: AdapterSignal,
  items: readonly SocialItem[] = [],
  metrics: AdapterBatchMetrics = baseMetrics(),
): AdapterBatchResult {
  return { capability, signal, items, metrics };
}

function structureChanged(capability: AdapterCapability, elapsedMs = 0): AdapterBatchResult {
  return result(
    capability,
    { kind: 'structure_changed', stopReason: 'structure_changed' },
    [],
    baseMetrics({ elapsedMs }),
  );
}

function pageRemainsSupported(port: XBookmarksDomReadPort): boolean {
  return detectXBookmarksCapability(callPort(port, 'readPageUrl')).kind === 'collection_scan';
}

function navigationChanged(clock: Clock, observedNodes = 0): AdapterBatchResult {
  const elapsedMs = clock.elapsed();
  return result(
    { kind: 'unsupported' },
    { kind: 'unsupported' },
    [],
    baseMetrics({ observedNodes, elapsedMs: elapsedMs ?? 0 }),
  );
}

function budgetExceeded(
  capability: AdapterCapability,
  budget: AdapterBudget,
  items: readonly SocialItem[],
  metrics: AdapterBatchMetrics,
): AdapterBatchResult {
  return result(
    capability,
    { kind: 'budget_exceeded', budget, stopReason: 'budget_exceeded' },
    items,
    metrics,
  );
}

export function resolveXBookmarksLimits(candidate: unknown): Readonly<XBookmarksLimits> | null {
  if (candidate === undefined) {
    return X_BOOKMARKS_CEILINGS;
  }
  const record = inspectPlainRecord(candidate, new Set(LIMIT_KEYS));
  if (!record) {
    return null;
  }
  const resolved = { ...X_BOOKMARKS_CEILINGS };
  for (const key of LIMIT_KEYS) {
    if (!own(record, key)) {
      continue;
    }
    const value = record[key];
    const minimum = key === 'maxMedia' ? 0 : 1;
    if (!Number.isSafeInteger(value) || (value as number) < minimum) {
      return null;
    }
    resolved[key] = Math.min(value as number, X_BOOKMARKS_CEILINGS[key]);
  }
  return Object.freeze(resolved);
}

export function detectXBookmarksCapability(pageUrl: unknown): AdapterCapability {
  return pageUrl === X_BOOKMARKS_PAGE_URL
    ? {
        kind: 'collection_scan',
        source: 'x',
        adapterVersion: X_BOOKMARKS_ADAPTER_VERSION,
      }
    : { kind: 'unsupported' };
}

export async function adaptXBookmarksDom(
  port: XBookmarksDomReadPort,
  options: XBookmarksAdapterOptions = {},
): Promise<AdapterBatchResult> {
  const now = options.now ?? Date.now;
  const clock = createClock(now);
  if (!clock) {
    return structureChanged({ kind: 'unsupported' });
  }

  const pageUrl = callPort(port, 'readPageUrl');
  const capability = detectXBookmarksCapability(pageUrl);
  if (capability.kind === 'unsupported') {
    const elapsedMs = clock.elapsed();
    return result(
      capability,
      { kind: 'unsupported' },
      [],
      baseMetrics({ elapsedMs: elapsedMs ?? 0 }),
    );
  }

  const limits = resolveXBookmarksLimits(options.limits);
  const remainingCandidateSlots = options.remainingCandidateSlots ?? limits?.maxItems ?? 0;
  const knownSourceItemIds = new Set<string>();
  if (
    options.knownSourceItemIds !== undefined &&
    (!Array.isArray(options.knownSourceItemIds) ||
      options.knownSourceItemIds.length > X_BOOKMARKS_CEILINGS.maxItems + SYNC_KNOWN_FRONTIER_LIMIT)
  ) {
    return structureChanged(capability);
  }
  for (const value of options.knownSourceItemIds ?? []) {
    const sourceItemId = XSourceItemIdSchema.safeParse(value);
    if (!sourceItemId.success) {
      return structureChanged(capability);
    }
    knownSourceItemIds.add(sourceItemId.data);
  }
  const acceptedBytesBefore = options.acceptedBytesBefore ?? 0;
  if (
    !limits ||
    !Number.isSafeInteger(remainingCandidateSlots) ||
    remainingCandidateSlots < 0 ||
    remainingCandidateSlots > X_BOOKMARKS_CEILINGS.maxItems ||
    !Number.isSafeInteger(acceptedBytesBefore) ||
    acceptedBytesBefore < 0 ||
    acceptedBytesBefore > X_BOOKMARKS_CEILINGS.maxTotalBytes
  ) {
    return structureChanged(capability);
  }

  const elapsedBeforeRead = clock.elapsed();
  if (elapsedBeforeRead === null) {
    return structureChanged(capability);
  }
  if (elapsedBeforeRead >= limits.maxElapsedMs) {
    return budgetExceeded(
      capability,
      'elapsed_time',
      [],
      baseMetrics({ elapsedMs: elapsedBeforeRead }),
    );
  }
  if (remainingCandidateSlots === 0) {
    return budgetExceeded(capability, 'candidate_items', [], baseMetrics());
  }
  if (acceptedBytesBefore > limits.maxTotalBytes) {
    return budgetExceeded(capability, 'accepted_bytes', [], baseMetrics());
  }

  let capturedAt = options.capturedAt;
  if (capturedAt === undefined) {
    try {
      capturedAt = new Date(clock.startedAt).toISOString();
    } catch {
      return structureChanged(capability);
    }
  }
  const parsedCapturedAt = IsoTimestampSchema.safeParse(capturedAt);
  if (!parsedCapturedAt.success) {
    return structureChanged(capability);
  }

  const signal = parseSignal(callPort(port, 'readSignal'));
  const observedNodeCount = callPort(port, 'readObservedNodeCount');
  const entryCount = callPort(port, 'readEntryCount');
  if (!pageRemainsSupported(port)) {
    return navigationChanged(clock);
  }
  if (
    !signal ||
    !Number.isSafeInteger(observedNodeCount) ||
    (observedNodeCount as number) < 0 ||
    !Number.isSafeInteger(entryCount) ||
    (entryCount as number) < 0 ||
    (entryCount as number) > (observedNodeCount as number)
  ) {
    return structureChanged(capability);
  }

  const safeObservedNodes = Math.min(observedNodeCount as number, limits.maxObservedNodes);
  const elapsedAfterHeader = clock.elapsed();
  if (elapsedAfterHeader === null) {
    return structureChanged(capability);
  }
  if (signal.kind === 'structure_changed') {
    return structureChanged(capability, elapsedAfterHeader);
  }
  if (signal.kind === 'challenge') {
    const stopReason = signal.challenge === 'rate_limited' ? 'rate_limited' : 'login_required';
    return result(
      capability,
      { kind: 'challenge', challenge: signal.challenge, stopReason },
      [],
      baseMetrics({ observedNodes: safeObservedNodes, elapsedMs: elapsedAfterHeader }),
    );
  }
  if ((observedNodeCount as number) > limits.maxObservedNodes) {
    return budgetExceeded(
      capability,
      'observed_nodes',
      [],
      baseMetrics({ observedNodes: safeObservedNodes, elapsedMs: elapsedAfterHeader }),
    );
  }
  if (elapsedAfterHeader >= limits.maxElapsedMs) {
    return budgetExceeded(
      capability,
      'elapsed_time',
      [],
      baseMetrics({ observedNodes: safeObservedNodes, elapsedMs: elapsedAfterHeader }),
    );
  }
  if (signal.kind === 'empty') {
    return (entryCount as number) === 0
      ? result(
          capability,
          { kind: 'empty' },
          [],
          baseMetrics({ observedNodes: safeObservedNodes, elapsedMs: elapsedAfterHeader }),
        )
      : structureChanged(capability, elapsedAfterHeader);
  }
  if (signal.kind === 'items' && (entryCount as number) === 0) {
    return structureChanged(capability, elapsedAfterHeader);
  }

  const items: SocialItem[] = [];
  const itemsById = new Map<string, SocialItem>();
  let candidateItems = 0;
  let acceptedBytes = 0;
  for (let index = 0; index < (entryCount as number); index += 1) {
    if (!pageRemainsSupported(port)) {
      return navigationChanged(clock, safeObservedNodes);
    }
    const elapsedBeforeEntry = clock.elapsed();
    if (elapsedBeforeEntry === null) {
      return structureChanged(capability);
    }
    if (elapsedBeforeEntry >= limits.maxElapsedMs) {
      return budgetExceeded(
        capability,
        'elapsed_time',
        items,
        baseMetrics({
          observedNodes: safeObservedNodes,
          acceptedItems: items.length,
          acceptedBytes,
          elapsedMs: elapsedBeforeEntry,
        }),
      );
    }

    const parsedEntry = await parseEntry(readEntry(port, index), parsedCapturedAt.data, limits);
    if (!pageRemainsSupported(port)) {
      return navigationChanged(clock, safeObservedNodes);
    }
    if (!parsedEntry) {
      return structureChanged(capability, elapsedBeforeEntry);
    }
    const elapsedAfterEntry = clock.elapsed();
    if (elapsedAfterEntry === null) {
      return structureChanged(capability);
    }
    if (elapsedAfterEntry >= limits.maxElapsedMs) {
      return budgetExceeded(
        capability,
        'elapsed_time',
        items,
        baseMetrics({
          observedNodes: safeObservedNodes,
          acceptedItems: items.length,
          acceptedBytes,
          elapsedMs: elapsedAfterEntry,
        }),
      );
    }

    const sourceItemId = parsedEntry.item.sourceItemId;
    const previous = itemsById.get(sourceItemId);
    if (previous) {
      if (
        previous.contentHash !== parsedEntry.item.contentHash ||
        previous.canonicalUrl !== parsedEntry.item.canonicalUrl
      ) {
        return structureChanged(capability, elapsedAfterEntry);
      }
      continue;
    }
    // Only the coordinator can distinguish a replayed identity from a newly accepted item.
    // Keep this adapter bound to one batch; the persisted job ceiling is enforced after dedupe.
    const batchItemLimit = Math.min(limits.maxItems, remainingCandidateSlots);
    const consumesCandidateSlot = !knownSourceItemIds.has(sourceItemId);
    if (consumesCandidateSlot && candidateItems >= batchItemLimit) {
      return budgetExceeded(
        capability,
        'candidate_items',
        items,
        baseMetrics({
          observedNodes: safeObservedNodes,
          acceptedItems: items.length,
          acceptedBytes,
          elapsedMs: elapsedAfterEntry,
        }),
      );
    }
    if (acceptedBytesBefore + acceptedBytes + parsedEntry.acceptedBytes > limits.maxTotalBytes) {
      return budgetExceeded(
        capability,
        'accepted_bytes',
        items,
        baseMetrics({
          observedNodes: safeObservedNodes,
          acceptedItems: items.length,
          acceptedBytes,
          elapsedMs: elapsedAfterEntry,
        }),
      );
    }
    itemsById.set(sourceItemId, parsedEntry.item);
    items.push(parsedEntry.item);
    if (consumesCandidateSlot) {
      candidateItems += 1;
    }
    acceptedBytes += parsedEntry.acceptedBytes;
  }

  const finalElapsedMs = clock.elapsed();
  if (finalElapsedMs === null) {
    return structureChanged(capability);
  }
  if (!pageRemainsSupported(port)) {
    return navigationChanged(clock, safeObservedNodes);
  }
  const metrics = baseMetrics({
    observedNodes: safeObservedNodes,
    acceptedItems: items.length,
    acceptedBytes,
    elapsedMs: finalElapsedMs,
  });
  if (finalElapsedMs >= limits.maxElapsedMs) {
    return budgetExceeded(capability, 'elapsed_time', items, metrics);
  }
  if (
    candidateItems >= Math.min(limits.maxItems, remainingCandidateSlots) &&
    signal.kind !== 'terminal'
  ) {
    return budgetExceeded(capability, 'candidate_items', items, metrics);
  }
  return result(capability, { kind: signal.kind }, items, metrics);
}

export function createXBookmarksDomReadPort(
  observation: XBookmarksDomObservation,
): XBookmarksDomReadPort {
  return {
    readPageUrl: () => observation.pageUrl,
    readSignal: () => observation.signal,
    readObservedNodeCount: () => observation.observedNodeCount,
    readEntryCount: () => observation.entries.length,
    readEntry: (index) => observation.entries[index],
  };
}

export async function adaptXBookmarksObservation(
  observation: XBookmarksDomObservation,
  options: XBookmarksAdapterOptions = {},
): Promise<AdapterBatchResult> {
  return adaptXBookmarksDom(createXBookmarksDomReadPort(observation), options);
}

export const xBookmarksAdapter = Object.freeze({
  source: 'x' as const,
  version: X_BOOKMARKS_ADAPTER_VERSION,
  hosts: Object.freeze(['x.com'] as const),
  detect: detectXBookmarksCapability,
  adapt: adaptXBookmarksDom,
});
