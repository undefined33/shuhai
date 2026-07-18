import { StructuredInputError } from '../shared/extension-messages.js';
import {
  X_SINGLE_EXTRACT_PROTOCOL,
  X_SINGLE_PROTOCOL,
  X_SINGLE_RESPONSE_PROTOCOL,
  X_SINGLE_VERSION,
  canonicalizeXStatusUrl,
  createXSingleDiagnostic,
  parseXSingleEnvelope,
  parseXSingleExtractRequest,
  parseXSingleExtractResponse,
  type XSingleDiagnostic,
  type XSingleDiagnosticCode,
  type XSingleEnvelope,
  type XSingleExtractRequest,
  type XSingleExtractResponse,
  type XSingleProbeName,
  type XStatusIdentity,
} from '../social/x-single-item.js';

const textEncoder = new TextEncoder();
const MAX_TEXT_BYTES = 8 * 1_024;
const MAX_TITLE_BYTES = 1 * 1_024;
const MAX_MEDIA = 12;

type QueryRoot = Pick<ParentNode, 'querySelector' | 'querySelectorAll'>;

interface ProbeState {
  primary_article: boolean;
  status_permalink: boolean;
  tweet_text: boolean;
  author: boolean;
  timestamp: boolean;
}

export class XSingleExtractionError extends Error {
  constructor(
    readonly diagnostic: XSingleDiagnostic,
    readonly reason: XSingleDiagnosticCode,
  ) {
    super('x_single_extraction_failed');
    this.name = 'XSingleExtractionError';
  }
}

function emptyProbes(): ProbeState {
  return {
    primary_article: false,
    status_permalink: false,
    tweet_text: false,
    author: false,
    timestamp: false,
  };
}

function probesFromState(state: ProbeState) {
  return (Object.entries(state) as Array<[XSingleProbeName, boolean]>).map(([name, found]) => ({
    name,
    found,
  }));
}

function extractionError(
  code: XSingleDiagnosticCode,
  state: ProbeState,
  usedFallback = false,
): XSingleExtractionError {
  return new XSingleExtractionError(
    createXSingleDiagnostic(code, probesFromState(state), usedFallback),
    code,
  );
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[^\S\n]+\n/gu, '\n')
    .replace(/\n[^\S\n]+/gu, '\n')
    .replace(/[^\S\n]{2,}/gu, ' ')
    .trim();
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (textEncoder.encode(value).byteLength <= maxBytes) {
    return value;
  }
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (textEncoder.encode(value.slice(0, middle)).byteLength <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  if (low > 0 && /[\uD800-\uDBFF]/u.test(value.charAt(low - 1))) {
    low -= 1;
  }
  return value.slice(0, low);
}

function safeAbsoluteUrl(value: string | null, baseUrl: string): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return undefined;
  }
}

function articleHasIdentity(
  article: Element,
  expected: XStatusIdentity,
): { exact: boolean; hasStatusPermalink: boolean } {
  let hasStatusPermalink = false;
  for (const anchor of Array.from(article.querySelectorAll('a[href]'))) {
    const absolute = safeAbsoluteUrl(anchor.getAttribute('href'), expected.canonicalUrl);
    const identity = canonicalizeXStatusUrl(absolute);
    if (!identity) {
      continue;
    }
    hasStatusPermalink = true;
    if (
      identity.sourceItemId === expected.sourceItemId &&
      identity.canonicalUrl === expected.canonicalUrl
    ) {
      return { exact: true, hasStatusPermalink: true };
    }
  }
  return { exact: false, hasStatusPermalink };
}

function findPrimaryArticle(
  documentRef: Document,
  expected: XStatusIdentity,
  probes: ProbeState,
): Element {
  const articles = Array.from(documentRef.querySelectorAll('article'));
  const exactMatches: Element[] = [];
  for (const article of articles) {
    const match = articleHasIdentity(article, expected);
    probes.status_permalink ||= match.hasStatusPermalink;
    if (match.exact) {
      exactMatches.push(article);
    }
  }
  if (exactMatches.length === 0) {
    throw extractionError(
      probes.status_permalink ? 'permalink_mismatch' : 'article_not_found',
      probes,
    );
  }
  if (exactMatches.length !== 1) {
    throw extractionError('article_ambiguous', probes);
  }
  probes.primary_article = true;
  probes.status_permalink = true;
  return exactMatches[0]!;
}

function extractText(article: Element, probes: ProbeState): string {
  if (
    article.querySelector(
      [
        '[data-testid="tweet-text-show-more-link"]',
        '[data-testid="tweet-text-show-more"]',
        'button[data-testid="tweet-text-show-more"]',
      ].join(','),
    )
  ) {
    throw extractionError('expansion_uncertain', probes);
  }
  const textNodes = Array.from(article.querySelectorAll('[data-testid="tweetText"]'));
  const text = normalizeText(textNodes[0]?.textContent);
  if (!text) {
    throw extractionError('content_missing', probes);
  }
  probes.tweet_text = true;
  if (textEncoder.encode(text).byteLength > MAX_TEXT_BYTES) {
    throw extractionError('payload_oversize', probes);
  }
  return text;
}

function extractAuthor(
  article: Element,
  expected: XStatusIdentity,
  probes: ProbeState,
): XSingleEnvelope['author'] {
  const root = article.querySelector('[data-testid="User-Name"]');
  if (!root) {
    return { handle: expected.handle };
  }
  const expectedPath = `/${expected.handle.toLowerCase()}`;
  const hasBoundProfileLink = Array.from(root.querySelectorAll('a[href]')).some((anchor) => {
    const absolute = safeAbsoluteUrl(anchor.getAttribute('href'), expected.canonicalUrl);
    if (!absolute) {
      return false;
    }
    try {
      const parsed = new URL(absolute);
      return (
        parsed.origin === 'https://x.com' &&
        parsed.pathname.toLowerCase() === expectedPath &&
        !parsed.username &&
        !parsed.password &&
        !parsed.port
      );
    } catch {
      return false;
    }
  });
  const displayName = normalizeText(
    root.querySelector('[dir="ltr"] span')?.textContent ?? root.querySelector('span')?.textContent,
  );
  probes.author = hasBoundProfileLink;
  return {
    ...(displayName && !displayName.startsWith('@') ? { displayName } : {}),
    handle: expected.handle,
  };
}

function extractPublishedAt(article: Element, probes: ProbeState): string | undefined {
  const raw = article.querySelector('time[datetime]')?.getAttribute('datetime');
  if (!raw) {
    return undefined;
  }
  try {
    const value = new Date(raw).toISOString();
    probes.timestamp = true;
    return value;
  } catch {
    throw extractionError('structure_changed', probes);
  }
}

function collectMedia(article: QueryRoot, baseUrl: string, probes: ProbeState) {
  const values: Array<{ type: 'image' | 'video'; url: string; alt?: string }> = [];
  const seen = new Set<string>();

  const add = (type: 'image' | 'video', rawUrl: string | null, rawAlt?: string | null) => {
    const absolute = safeAbsoluteUrl(rawUrl, baseUrl);
    if (!absolute || seen.has(`${type}\u0000${absolute}`)) {
      return;
    }
    seen.add(`${type}\u0000${absolute}`);
    const alt = normalizeText(rawAlt);
    values.push({
      type,
      url: absolute,
      ...(alt ? { alt } : {}),
    });
  };

  for (const image of Array.from(
    article.querySelectorAll(
      'img[src*="pbs.twimg.com/media"], img[src*="pbs.twimg.com/amplify_video_thumb"]',
    ),
  )) {
    add('image', image.getAttribute('src'), image.getAttribute('alt'));
  }
  for (const video of Array.from(article.querySelectorAll('video'))) {
    add('video', video.getAttribute('src') ?? video.getAttribute('poster'), '视频');
  }

  if (values.length > MAX_MEDIA) {
    throw extractionError('payload_oversize', probes);
  }
  return values;
}

function diagnosticForUnknownError(probes: ProbeState, error: unknown): XSingleDiagnostic {
  if (error instanceof XSingleExtractionError) {
    return error.diagnostic;
  }
  if (
    error instanceof StructuredInputError &&
    (error.code === 'message_too_large' || error.code === 'string_too_large')
  ) {
    return createXSingleDiagnostic('payload_oversize', probesFromState(probes));
  }
  return createXSingleDiagnostic('payload_invalid', probesFromState(probes));
}

export function extractXSingleEnvelope(documentRef: Document, pageUrl: string): XSingleEnvelope {
  const probes = emptyProbes();
  const expected = canonicalizeXStatusUrl(pageUrl);
  if (!expected) {
    throw extractionError('route_invalid', probes);
  }
  const article = findPrimaryArticle(documentRef, expected, probes);
  const text = extractText(article, probes);
  const author = extractAuthor(article, expected, probes);
  const publishedAt = extractPublishedAt(article, probes);
  const titlePrefix = author.displayName ?? `@${expected.handle}`;
  const title = truncateUtf8(`${titlePrefix} - ${text}`, MAX_TITLE_BYTES);

  try {
    return parseXSingleEnvelope({
      protocol: X_SINGLE_PROTOCOL,
      version: X_SINGLE_VERSION,
      routeFamily: 'x/status',
      sourceItemId: expected.sourceItemId,
      canonicalUrl: expected.canonicalUrl,
      title,
      text,
      author,
      ...(publishedAt ? { publishedAt } : {}),
      media: collectMedia(article, expected.canonicalUrl, probes),
      contentKind: 'post',
    });
  } catch (error) {
    const diagnostic = diagnosticForUnknownError(probes, error);
    throw new XSingleExtractionError(diagnostic, diagnostic.errorCode);
  }
}

export function handleXSingleExtractRequest(
  documentRef: Document,
  pageUrl: string,
  requestInput: unknown,
): XSingleExtractResponse {
  const request = parseXSingleExtractRequest(requestInput);
  const current = canonicalizeXStatusUrl(pageUrl);
  if (
    !current ||
    current.canonicalUrl !== request.canonicalUrl ||
    current.sourceItemId !== request.sourceItemId
  ) {
    return parseXSingleExtractResponse({
      protocol: X_SINGLE_RESPONSE_PROTOCOL,
      version: X_SINGLE_VERSION,
      requestId: request.requestId,
      ok: false,
      diagnostic: createXSingleDiagnostic('route_invalid', probesFromState(emptyProbes())),
    });
  }

  try {
    return parseXSingleExtractResponse({
      protocol: X_SINGLE_RESPONSE_PROTOCOL,
      version: X_SINGLE_VERSION,
      requestId: request.requestId,
      ok: true,
      item: extractXSingleEnvelope(documentRef, pageUrl),
    });
  } catch (error) {
    return parseXSingleExtractResponse({
      protocol: X_SINGLE_RESPONSE_PROTOCOL,
      version: X_SINGLE_VERSION,
      requestId: request.requestId,
      ok: false,
      diagnostic: diagnosticForUnknownError(emptyProbes(), error),
    });
  }
}

const twitterWindow =
  typeof window === 'undefined'
    ? undefined
    : (window as Window & { __shuhaiXSingleExtractorInstalled?: boolean });

if (twitterWindow && !twitterWindow.__shuhaiXSingleExtractorInstalled) {
  twitterWindow.__shuhaiXSingleExtractorInstalled = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    let request: XSingleExtractRequest;
    try {
      request = parseXSingleExtractRequest(message);
    } catch {
      return false;
    }
    if (request.protocol !== X_SINGLE_EXTRACT_PROTOCOL || request.type !== 'xSingle:extract') {
      return false;
    }
    sendResponse(handleXSingleExtractRequest(document, location.href, request));
    return true;
  });
}
