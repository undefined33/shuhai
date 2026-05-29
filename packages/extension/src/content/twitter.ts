import type {
  CapturedContent,
  CapturedMedia,
  DiagnosticReport,
  SelectorProbe,
} from '../shared/bookmark-types.js';
import {
  createDiagnosticReport,
  missingRequiredProbeNames,
  runSelectorProbes,
  structureErrorMessage,
} from '../utils/extractor-diagnostics.js';

type QueryRoot = Pick<ParentNode, 'querySelector' | 'querySelectorAll'> & {
  textContent?: string | null;
};

const TWITTER_DETAIL_ERROR = '请先打开一条推文的详情页（点击推文进入）';
const TWITTER_STRUCTURE_ERROR = '页面结构可能已更新，提取失败。请反馈此问题。';
const TWITTER_PROBES: SelectorProbe[] = [
  {
    name: 'tweetText',
    selector: '[data-testid="tweetText"]',
    required: true,
    description: '推文正文',
  },
  {
    name: 'User-Name',
    selector: '[data-testid="User-Name"]',
    required: true,
    description: '作者区域',
  },
  {
    name: 'article',
    selector: 'article',
    required: true,
    description: '推文容器',
  },
  {
    name: 'time',
    selector: 'time[datetime]',
    required: false,
    description: '发布时间',
  },
  {
    name: 'videoPlayer',
    selector: '[data-testid="videoPlayer"]',
    required: false,
    description: '视频内容',
  },
];

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function textFromFirst(root: QueryRoot, selectors: string[]): string {
  return textFromFirstMatch(root, selectors).text;
}

function textFromFirstMatch(
  root: QueryRoot,
  selectors: string[],
): { text: string; selector: string } {
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    const text = normalizeText(element?.textContent);
    if (text) {
      return { text, selector };
    }
  }

  return { text: '', selector: '' };
}

function textFromAll(root: QueryRoot, selector: string): string[] {
  return Array.from(root.querySelectorAll(selector))
    .map((element) => normalizeText(element.textContent))
    .filter(Boolean);
}

function isTwitterStatusUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.hostname === 'x.com' ||
        parsed.hostname.endsWith('.x.com') ||
        parsed.hostname === 'twitter.com' ||
        parsed.hostname.endsWith('.twitter.com')) &&
      /\/[^/]+\/status\/\d+/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function statusIdFromUrl(url: string): string {
  const match = url.match(/\/status\/(\d+)/);
  return match?.[1] ?? crypto.randomUUID();
}

function handleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split('/').filter(Boolean)[0] ?? '';
  } catch {
    return '';
  }
}

function extractHandle(documentRef: Document, url: string, fallbacksUsed: string[]): string {
  const handles = textFromAll(documentRef, '[data-testid="User-Name"] a[href^="/"]');
  const explicitHandle = handles.find((line) => line.startsWith('@'));
  if (explicitHandle) {
    return explicitHandle;
  }

  const href = documentRef
    .querySelector('[data-testid="User-Name"] a[href^="/"]')
    ?.getAttribute('href');
  const pathHandle = href?.split('/').filter(Boolean)[0] ?? handleFromUrl(url);
  if (pathHandle) {
    fallbacksUsed.push('Twitter 作者: URL 路径');
  }

  return pathHandle ? `@${pathHandle}` : '';
}

function extractDisplayName(documentRef: Document, handle: string): string {
  const displayName = textFromFirst(documentRef, [
    '[data-testid="User-Name"] [dir="ltr"] span span',
    '[data-testid="User-Name"] [dir="ltr"] span',
    '[data-testid="User-Name"]',
  ]);
  const fallback = displayName
    .split(/\n|(?=@)/)
    .map((line) => normalizeText(line))
    .find((line) => line && !line.startsWith('@') && line !== handle);

  return fallback ?? '';
}

function collectTweetText(documentRef: Document, fallbacksUsed: string[]): string {
  const match = textFromFirstMatch(documentRef, [
    'article [data-testid="tweetText"]',
    '[data-testid="tweetText"]',
    'article [lang]',
  ]);

  if (!match.text) {
    throw new Error(TWITTER_STRUCTURE_ERROR);
  }

  if (match.selector !== 'article [data-testid="tweetText"]') {
    fallbacksUsed.push(`Twitter 正文: ${match.selector}`);
  }

  return match.text;
}

function appendQuoteTweet(documentRef: Document, text: string): string {
  const quote = textFromFirst(documentRef, [
    'article [data-testid="quoteTweet"] [data-testid="tweetText"]',
    '[data-testid="quoteTweet"] [data-testid="tweetText"]',
    '[data-testid="quoteTweet"]',
  ]);

  if (!quote) {
    return text;
  }

  return `${text}\n\n---\n引用推文：\n${quote}`;
}

function numericAttribute(element: Element, name: string): number {
  const value = Number(element.getAttribute(name) ?? '');
  return Number.isFinite(value) ? value : 0;
}

function imageDimension(image: Element, key: 'height' | 'width'): number {
  const imageElement = image as HTMLImageElement;
  const natural = key === 'height' ? imageElement.naturalHeight : imageElement.naturalWidth;
  return natural || numericAttribute(image, key);
}

function isSmallImage(image: Element): boolean {
  const width = imageDimension(image, 'width');
  const height = imageDimension(image, 'height');

  return width > 0 && height > 0 && width < 100 && height < 100;
}

function collectMedia(documentRef: Document): CapturedMedia[] {
  const seen = new Set<string>();
  const media: CapturedMedia[] = [];

  for (const image of Array.from(
    documentRef.querySelectorAll('article img[src*="twimg.com"], img[src*="twimg.com"]'),
  )) {
    const url = image.getAttribute('src') ?? '';
    if (
      !url ||
      seen.has(url) ||
      url.includes('profile_images') ||
      url.includes('emoji') ||
      isSmallImage(image)
    ) {
      continue;
    }

    seen.add(url);
    media.push({
      type: 'image',
      url,
      alt: image.getAttribute('alt') ?? undefined,
    });
  }

  if (documentRef.querySelector('[data-testid="videoPlayer"]')) {
    media.push({
      type: 'video',
      url: '(视频无法直接提取)',
      alt: '视频无法直接提取',
    });
  }

  return media.slice(0, 12);
}

export function extractTwitterContent(documentRef: Document, url: string): CapturedContent {
  return extractTwitterContentWithDiagnostics(documentRef, url).capture;
}

export function extractTwitterContentWithDiagnostics(
  documentRef: Document,
  url: string,
): { capture: CapturedContent; diagnostic: DiagnosticReport } {
  if (!isTwitterStatusUrl(url)) {
    throw new Error(TWITTER_DETAIL_ERROR);
  }

  const probeResults = runSelectorProbes(documentRef, TWITTER_PROBES);
  const missingNames = missingRequiredProbeNames(TWITTER_PROBES, probeResults);
  if (missingNames.length > 0) {
    const message = structureErrorMessage('twitter', missingNames);
    const error = new Error(message) as Error & { diagnostic?: DiagnosticReport };
    error.diagnostic = createDiagnosticReport({
      platform: 'twitter',
      url,
      probes: TWITTER_PROBES,
      probeResults,
      error: message,
    });
    throw error;
  }

  const fallbacksUsed: string[] = [];
  const handle = extractHandle(documentRef, url, fallbacksUsed);
  const author = extractDisplayName(documentRef, handle) || handle;
  const created = documentRef.querySelector('time')?.getAttribute('datetime') ?? undefined;
  const text = appendQuoteTweet(documentRef, collectTweetText(documentRef, fallbacksUsed));
  const titleAuthor = author || handle;
  const title = titleAuthor
    ? `${titleAuthor} - ${text.slice(0, 40) || 'Tweet'}`
    : documentRef.title;

  return {
    capture: {
      id: `twitter-${statusIdFromUrl(url)}`,
      source: 'twitter',
      title,
      url,
      author,
      handle,
      created,
      text,
      media: collectMedia(documentRef),
      tags: ['twitter'],
      capturedAt: new Date().toISOString(),
    },
    diagnostic: createDiagnosticReport({
      platform: 'twitter',
      url,
      probes: TWITTER_PROBES,
      probeResults,
      fallbacksUsed,
    }),
  };
}

const twitterWindow =
  typeof window === 'undefined'
    ? undefined
    : (window as Window & { __shuhaiTwitterExtractorInstalled?: boolean });

if (twitterWindow && !twitterWindow.__shuhaiTwitterExtractorInstalled) {
  twitterWindow.__shuhaiTwitterExtractorInstalled = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'social:extract') {
      return false;
    }

    try {
      const result = extractTwitterContentWithDiagnostics(document, location.href);
      sendResponse({
        ok: true,
        data: result.capture,
        diagnostic: result.diagnostic,
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : TWITTER_STRUCTURE_ERROR,
        diagnostic:
          error instanceof Error && 'diagnostic' in error
            ? (error as Error & { diagnostic?: DiagnosticReport }).diagnostic
            : undefined,
      });
    }

    return true;
  });
}
