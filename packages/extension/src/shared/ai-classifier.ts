import { AI_BATCH_SIZE } from '@shuhai/shared';
import type {
  AppSettings,
  BookmarkItem,
  ClassificationMode,
  ClassificationSuggestion,
  FolderItem,
} from './bookmark-types.js';
import { normalizeFolderPath, stripRootFolder } from './classifier.js';

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

interface AiPromptContext {
  mode: ClassificationMode;
  folders: FolderItem[];
}

interface ClassifyAllOptions {
  mode?: ClassificationMode;
  folders?: FolderItem[];
  fetchImpl?: FetchLike;
  onProgress?: (done: number, total: number) => void;
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

function summarizeFolders(folders: FolderItem[]): string {
  return folders
    .map((folder) => ({
      path: stripRootFolder(folder.path) || folder.path,
      bookmarkCount: folder.bookmarkCount,
    }))
    .filter((folder) => folder.path)
    .sort((a, b) => b.bookmarkCount - a.bookmarkCount || a.path.localeCompare(b.path))
    .slice(0, 120)
    .map((folder) => `- ${folder.path} (${folder.bookmarkCount})`)
    .join('\n');
}

function buildPrompt(bookmarks: BookmarkItem[], context: AiPromptContext): string {
  const payload = bookmarks.map((bookmark) => ({
    bookmarkId: bookmark.id,
    title: bookmark.title,
    url: bookmark.url,
    currentFolder: stripRootFolder(bookmark.parentPath) || bookmark.parentPath,
  }));
  const folderSummary = summarizeFolders(context.folders);
  const modeInstruction =
    context.mode === 'full'
      ? [
          '请重新审视每个书签的现有文件夹是否合理。',
          '如果当前文件夹已经是最佳分类，返回相同 targetFolder。',
          '如果有更好的分类，返回新的 targetFolder。',
          '优先合并相似文件夹、拆分过大的文件夹，并保持最多三级目录。',
        ].join('\n')
      : '只为根目录或未分类书签给出整理建议；已有明确文件夹的书签可以返回原文件夹。';

  return [
    '你是 ShuHai 的书签分类专家。',
    '只返回 JSON 数组，不要返回解释文字。',
    '每一项格式: {"bookmarkId":"...","targetFolder":"安全/漏洞研究","confidence":0.92,"reason":"...","tags":["安全"]}',
    'targetFolder 使用中文短路径，最多三级。不要返回正则表达式、脚本或 Markdown。',
    modeInstruction,
    folderSummary ? `当前文件夹结构:\n${folderSummary}` : '当前没有可参考的文件夹结构。',
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

function chunkBookmarks(bookmarks: BookmarkItem[]): BookmarkItem[][] {
  const chunks: BookmarkItem[][] = [];

  for (let index = 0; index < bookmarks.length; index += AI_BATCH_SIZE) {
    chunks.push(bookmarks.slice(index, index + AI_BATCH_SIZE));
  }

  return chunks;
}

function optionsFromFetch(
  fetchImplOrOptions?: FetchLike | ClassifyAllOptions,
): Required<Pick<ClassifyAllOptions, 'mode' | 'folders' | 'fetchImpl'>> &
  Pick<ClassifyAllOptions, 'onProgress'> {
  if (typeof fetchImplOrOptions === 'function') {
    return {
      mode: 'safe',
      folders: [],
      fetchImpl: fetchImplOrOptions,
    };
  }

  return {
    mode: fetchImplOrOptions?.mode ?? 'safe',
    folders: fetchImplOrOptions?.folders ?? [],
    fetchImpl: fetchImplOrOptions?.fetchImpl ?? fetch,
    onProgress: fetchImplOrOptions?.onProgress,
  };
}

export async function classifyWithDeepSeek(
  bookmarks: BookmarkItem[],
  settings: AppSettings,
  fetchImplOrOptions?: FetchLike | ClassifyAllOptions,
): Promise<ClassificationSuggestion[]> {
  if (!settings.useAi || !settings.deepSeekApiKey.trim()) {
    return [];
  }

  const options = optionsFromFetch(fetchImplOrOptions);
  const batch = bookmarks.slice(0, AI_BATCH_SIZE);

  if (batch.length === 0) {
    return [];
  }

  const response = await options.fetchImpl('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.deepSeekApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.deepSeekModel,
      messages: [
        {
          role: 'user',
          content: buildPrompt(batch, {
            mode: options.mode,
            folders: options.folders,
          }),
        },
      ],
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

export async function classifyAllWithDeepSeek(
  bookmarks: BookmarkItem[],
  settings: AppSettings,
  options: ClassifyAllOptions = {},
): Promise<ClassificationSuggestion[]> {
  const batches = chunkBookmarks(bookmarks);
  const results: ClassificationSuggestion[] = [];
  let processed = 0;

  for (const batch of batches) {
    const suggestions = await classifyWithDeepSeek(batch, settings, options);
    results.push(...suggestions);
    processed += batch.length;
    options.onProgress?.(processed, bookmarks.length);
  }

  return results;
}
