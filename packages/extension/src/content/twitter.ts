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

function collectTweetText(documentRef: Document): string {
  const tweetTexts = Array.from(documentRef.querySelectorAll('[data-testid="tweetText"]'))
    .map((element) => element.textContent?.trim() ?? '')
    .filter(Boolean);

  if (tweetTexts.length > 0) {
    return tweetTexts.join('\n\n');
  }

  return documentRef.body?.textContent?.trim().slice(0, 4000) ?? '';
}

function collectMedia(documentRef: Document): CapturedMedia[] {
  const seen = new Set<string>();
  const media: CapturedMedia[] = [];

  for (const image of Array.from(documentRef.querySelectorAll('img[src*="twimg.com"]'))) {
    const url = image.getAttribute('src') ?? '';
    if (!url || seen.has(url)) {
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

function statusIdFromUrl(url: string): string {
  const match = url.match(/status\/(\d+)/);
  return match?.[1] ?? crypto.randomUUID();
}

export function extractTwitterContent(documentRef: Document, url: string): CapturedContent {
  const handle = textFromFirst(documentRef, [
    '[data-testid="User-Name"] a[href^="/"]',
    'article a[href^="/"]',
  ]);
  const created = documentRef.querySelector('time')?.getAttribute('datetime') ?? undefined;
  const text = collectTweetText(documentRef);
  const title = handle ? `${handle} - ${text.slice(0, 40) || 'Tweet'}` : documentRef.title;

  return {
    id: `twitter-${statusIdFromUrl(url)}`,
    source: 'twitter',
    title,
    url,
    author: handle,
    handle,
    created,
    text,
    media: collectMedia(documentRef),
    tags: ['twitter'],
    capturedAt: new Date().toISOString(),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'social:extract') {
    return false;
  }

  sendResponse({
    ok: true,
    data: extractTwitterContent(document, location.href),
  });
  return true;
});
