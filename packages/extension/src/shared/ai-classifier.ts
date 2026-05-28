import { AI_BATCH_SIZE } from '@shuhai/shared';
import type {
  AppSettings,
  BookmarkItem,
  ClassificationSuggestion,
} from './bookmark-types.js';
import { normalizeFolderPath } from './classifier.js';

interface DeepSeekChoice {
  message?: {
    content?: string;
  };
}

interface DeepSeekResponse {
  choices?: DeepSeekChoice[];
}

interface RawAiSuggestion {
  bookmarkId?: string;
  targetFolder?: string;
  confidence?: number;
  reason?: string;
  tags?: string[];
}

export interface FetchLike {
  (
    input: string,
    init: {
      method: string;
      headers: Record<string, string>;
      body: string;
    },
  ): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
    json(): Promise<DeepSeekResponse>;
  }>;
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, value));
}

function extractJsonArray(content: string): RawAiSuggestion[] {
  const start = content.indexOf('[');
  const end = content.lastIndexOf(']');

  if (start === -1 || end === -1 || end <= start) {
    return [];
  }

  const parsed = JSON.parse(content.slice(start, end + 1)) as unknown;
  return Array.isArray(parsed) ? (parsed as RawAiSuggestion[]) : [];
}

function buildPrompt(bookmarks: BookmarkItem[]): string {
  const payload = bookmarks.map((bookmark) => ({
    bookmarkId: bookmark.id,
    title: bookmark.title,
    url: bookmark.url,
    currentFolder: bookmark.parentPath,
  }));

  return [
    '你是 ShuHai 的书签分类器。',
    '请只返回 JSON 数组，不要返回解释文字。',
    '每一项格式: {"bookmarkId":"...","targetFolder":"安全/研究","confidence":0.92,"reason":"...","tags":["安全"]}',
    'targetFolder 使用中文短路径，最多三级。不要返回正则表达式或脚本。',
    JSON.stringify(payload),
  ].join('\n');
}

function toSuggestion(item: RawAiSuggestion): ClassificationSuggestion | undefined {
  const bookmarkId = item.bookmarkId?.trim();
  const targetFolder = normalizeFolderPath(item.targetFolder ?? '');

  if (!bookmarkId || !targetFolder) {
    return undefined;
  }

  return {
    bookmarkId,
    targetFolder,
    confidence: clampConfidence(item.confidence),
    reason: 'ai',
    ruleName: item.reason?.slice(0, 80),
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 8) : [],
  };
}

export async function classifyWithDeepSeek(
  bookmarks: BookmarkItem[],
  settings: AppSettings,
  fetchImpl: FetchLike = fetch,
): Promise<ClassificationSuggestion[]> {
  if (!settings.useAi || !settings.deepSeekApiKey.trim()) {
    return [];
  }

  const batch = bookmarks.slice(0, AI_BATCH_SIZE);

  if (batch.length === 0) {
    return [];
  }

  const response = await fetchImpl('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.deepSeekApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.deepSeekModel,
      messages: [{ role: 'user', content: buildPrompt(batch) }],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? '';

  return extractJsonArray(content)
    .map(toSuggestion)
    .filter((suggestion): suggestion is ClassificationSuggestion => Boolean(suggestion));
}
