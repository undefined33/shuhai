import type { CapturedContent, CapturedMedia } from '../shared/bookmark-types.js';

function textFromFirst(documentRef: Document, selectors: string[]): string {
  for (const selector of selectors) {
    const element = documentRef.querySelector(selector);
    const text = element?.textContent?.trim();
    if (text) {
      return text;
    }
  }

  return '';
}

function collectWeiboText(documentRef: Document): string {
  const text = textFromFirst(documentRef, [
    'article [class*="detail_wbtext"]',
    '[class*="detail_wbtext"]',
    '[class*="txt"]',
    'article',
  ]);

  return text || documentRef.body?.textContent?.trim().slice(0, 4000) || '';
}

function collectMedia(documentRef: Document): CapturedMedia[] {
  const seen = new Set<string>();
  const media: CapturedMedia[] = [];

  for (const image of Array.from(documentRef.querySelectorAll('img'))) {
    const url = image.getAttribute('src') ?? '';
    if (!/^https?:\/\//.test(url) || seen.has(url)) {
      continue;
    }

    seen.add(url);
    media.push({
      url,
      alt: image.getAttribute('alt') ?? undefined,
    });
  }

  return media.slice(0, 12);
}

export function extractWeiboContent(documentRef: Document, url: string): CapturedContent {
  const author = textFromFirst(documentRef, [
    '[class*="head_name"]',
    '[class*="username"]',
    'article a[href*="/u/"]',
  ]);
  const created = textFromFirst(documentRef, ['time', '[class*="time"]']) || undefined;
  const text = collectWeiboText(documentRef);
  const title = author ? `${author} - ${text.slice(0, 40) || '微博'}` : documentRef.title;

  return {
    id: `weibo-${crypto.randomUUID()}`,
    source: 'weibo',
    title,
    url,
    author,
    created,
    text,
    media: collectMedia(documentRef),
    tags: ['weibo'],
    capturedAt: new Date().toISOString(),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'social:extract') {
    return false;
  }

  sendResponse({
    ok: true,
    data: extractWeiboContent(document, location.href),
  });
  return true;
});
