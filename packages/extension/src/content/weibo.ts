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

const WEIBO_DETAIL_ERROR = '请先打开一条微博的详情页';
const WEIBO_EXPAND_ERROR = '请先点击"展开全文"后再保存';
const WEIBO_STRUCTURE_ERROR = '页面结构可能已更新，提取失败。请反馈此问题。';
const WEIBO_PROBES: SelectorProbe[] = [
  {
    name: 'weiboText',
    selector: '[class*="detail_wbtext"], [class*="weibo-text"]',
    required: true,
    description: '微博正文',
  },
  {
    name: 'author',
    selector: '[class*="head_name"], [class*="username"]',
    required: true,
    description: '作者区域',
  },
  {
    name: 'time',
    selector: 'time, [class*="time"]',
    required: false,
    description: '发布时间',
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

function isWeiboDetailUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.hostname === 'weibo.com' ||
        parsed.hostname.endsWith('.weibo.com') ||
        parsed.hostname === 'm.weibo.cn') &&
      (/\/detail\/[^/?#]+/.test(parsed.pathname) || /\/status\/[^/?#]+/.test(parsed.pathname))
    );
  } catch {
    return false;
  }
}

function weiboIdFromUrl(url: string): string {
  const match = url.match(/\/(?:detail|status)\/([^/?#]+)/);
  return match?.[1] ?? crypto.randomUUID();
}

function hasExpandPrompt(documentRef: Document): boolean {
  return Array.from(documentRef.querySelectorAll('a, button, span')).some((element) =>
    normalizeText(element.textContent).includes('展开全文'),
  );
}

function collectWeiboText(documentRef: Document, fallbacksUsed: string[]): string {
  if (hasExpandPrompt(documentRef)) {
    throw new Error(WEIBO_EXPAND_ERROR);
  }

  const commentMatch = textFromFirstMatch(documentRef, [
    'article [class*="detail_wbtext"]',
    '[class*="detail_wbtext"]',
    '[class*="weibo-text"]',
    '[class*="txt"]',
    'article',
  ]);

  const repostText = textFromFirst(documentRef, [
    '[class*="retweet"] [class*="detail_wbtext"]',
    '[class*="retweet"] [class*="weibo-text"]',
    '[class*="retweet"] [class*="txt"]',
    '[class*="forward"] [class*="txt"]',
  ]);

  if (commentMatch.text && commentMatch.selector !== 'article [class*="detail_wbtext"]') {
    fallbacksUsed.push(`Weibo 正文: ${commentMatch.selector}`);
  }

  if (commentMatch.text && repostText && commentMatch.text !== repostText) {
    return `${commentMatch.text}\n\n---\n转发原文：\n${repostText}`;
  }

  const text =
    commentMatch.text || repostText || normalizeText(documentRef.body?.textContent).slice(0, 4000);
  if (!text) {
    throw new Error(WEIBO_STRUCTURE_ERROR);
  }

  return text;
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
    documentRef.querySelectorAll('[class*="pic"] img, [class*="media"] img'),
  )) {
    const url = image.getAttribute('src') ?? '';
    if (
      !/^https?:\/\//.test(url) ||
      seen.has(url) ||
      url.includes('face/') ||
      url.includes('emoticon') ||
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

  return media.slice(0, 12);
}

export function extractWeiboContent(documentRef: Document, url: string): CapturedContent {
  return extractWeiboContentWithDiagnostics(documentRef, url).capture;
}

export function extractWeiboContentWithDiagnostics(
  documentRef: Document,
  url: string,
): { capture: CapturedContent; diagnostic: DiagnosticReport } {
  if (!isWeiboDetailUrl(url)) {
    throw new Error(WEIBO_DETAIL_ERROR);
  }

  const probeResults = runSelectorProbes(documentRef, WEIBO_PROBES);
  const missingNames = missingRequiredProbeNames(WEIBO_PROBES, probeResults);
  if (missingNames.length > 0) {
    const message = structureErrorMessage('weibo', missingNames);
    const error = new Error(message) as Error & { diagnostic?: DiagnosticReport };
    error.diagnostic = createDiagnosticReport({
      platform: 'weibo',
      url,
      probes: WEIBO_PROBES,
      probeResults,
      error: message,
    });
    throw error;
  }

  const fallbacksUsed: string[] = [];
  const authorMatch = textFromFirstMatch(documentRef, [
    '[class*="head_name"]',
    '[class*="username"]',
    'article a[href*="/u/"]',
  ]);
  if (authorMatch.text && authorMatch.selector !== '[class*="head_name"]') {
    fallbacksUsed.push(`Weibo 作者: ${authorMatch.selector}`);
  }
  const author = authorMatch.text;
  const created = textFromFirst(documentRef, ['time', '[class*="time"]']) || undefined;
  const text = collectWeiboText(documentRef, fallbacksUsed);
  const title = author ? `${author} - ${text.slice(0, 40) || '微博'}` : documentRef.title;

  return {
    capture: {
      id: `weibo-${weiboIdFromUrl(url)}`,
      source: 'weibo',
      title,
      url,
      author,
      created,
      text,
      media: collectMedia(documentRef),
      tags: ['weibo'],
      capturedAt: new Date().toISOString(),
    },
    diagnostic: createDiagnosticReport({
      platform: 'weibo',
      url,
      probes: WEIBO_PROBES,
      probeResults,
      fallbacksUsed,
    }),
  };
}

const weiboWindow =
  typeof window === 'undefined'
    ? undefined
    : (window as Window & { __shuhaiWeiboExtractorInstalled?: boolean });

if (weiboWindow && !weiboWindow.__shuhaiWeiboExtractorInstalled) {
  weiboWindow.__shuhaiWeiboExtractorInstalled = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'social:extract') {
      return false;
    }

    try {
      const result = extractWeiboContentWithDiagnostics(document, location.href);
      sendResponse({
        ok: true,
        data: result.capture,
        diagnostic: result.diagnostic,
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : WEIBO_STRUCTURE_ERROR,
        diagnostic:
          error instanceof Error && 'diagnostic' in error
            ? (error as Error & { diagnostic?: DiagnosticReport }).diagnostic
            : undefined,
      });
    }

    return true;
  });
}
