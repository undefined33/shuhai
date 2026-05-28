import type {
  BookmarkItem,
  ClassificationPlan,
  ClassificationReason,
  ClassificationSuggestion,
  CustomRule,
  FolderItem,
  MovePlan,
} from './bookmark-types.js';

interface InternalRule {
  type: 'domain' | 'title-keyword';
  pattern: string;
  category: string;
  tags: string[];
  priority: number;
  safeRegex: boolean;
}

interface RuleMatch {
  category: string;
  confidence: number;
  reason: ClassificationReason;
  ruleName?: string;
  tags: string[];
}

const ROOT_FOLDER_NAMES = new Set([
  '',
  'Bookmarks Bar',
  'Other Bookmarks',
  'Mobile Bookmarks',
  '书签栏',
  '其他书签',
  '移动设备书签',
]);

const DEFAULT_RULES: InternalRule[] = [
  { type: 'domain', pattern: 'github.com', category: '开发/代码', tags: ['GitHub'], priority: 1, safeRegex: false },
  { type: 'domain', pattern: 'gitlab.com', category: '开发/代码', tags: ['GitLab'], priority: 1, safeRegex: false },
  { type: 'domain', pattern: 'stackoverflow.com', category: '开发/问答', tags: ['StackOverflow'], priority: 1, safeRegex: false },
  { type: 'domain', pattern: 'npmjs.com', category: '开发/工具', tags: ['npm'], priority: 1, safeRegex: false },
  { type: 'domain', pattern: 'developer.mozilla.org', category: '开发/文档', tags: ['MDN'], priority: 1, safeRegex: false },
  { type: 'domain', pattern: 'exploit-db.com', category: '安全/漏洞', tags: ['exploit'], priority: 1, safeRegex: false },
  { type: 'domain', pattern: 'cve.mitre.org', category: '安全/CVE', tags: ['CVE'], priority: 1, safeRegex: false },
  { type: 'domain', pattern: 'virustotal.com', category: '安全/分析', tags: ['malware'], priority: 1, safeRegex: false },
  { type: 'domain', pattern: 'medium.com', category: '文章/技术', tags: ['blog'], priority: 2, safeRegex: false },
  { type: 'domain', pattern: 'dev.to', category: '文章/技术', tags: ['blog'], priority: 2, safeRegex: false },
  { type: 'domain', pattern: 'youtube.com', category: '视频', tags: ['YouTube'], priority: 2, safeRegex: false },
  { type: 'domain', pattern: 'bilibili.com', category: '视频', tags: ['Bilibili'], priority: 2, safeRegex: false },
  { type: 'domain', pattern: 'zhihu.com', category: '知识/知乎', tags: ['知乎'], priority: 2, safeRegex: false },
  { type: 'domain', pattern: 'wikipedia.org', category: '知识/百科', tags: ['Wikipedia'], priority: 2, safeRegex: false },
  { type: 'domain', pattern: 'figma.com', category: '设计', tags: ['Figma'], priority: 2, safeRegex: false },
  { type: 'domain', pattern: 'notion.so', category: '工具', tags: ['Notion'], priority: 2, safeRegex: false },
  { type: 'title-keyword', pattern: 'React|Vue|Angular|Svelte|Next', category: '开发/前端', tags: ['前端'], priority: 3, safeRegex: true },
  { type: 'title-keyword', pattern: 'Python|Rust|Go|Java|C\\+\\+', category: '开发/语言', tags: ['语言'], priority: 3, safeRegex: true },
  { type: 'title-keyword', pattern: 'CVE-\\d{4}|exploit|payload|reverse\\.shell', category: '安全/研究', tags: ['安全'], priority: 3, safeRegex: true },
  { type: 'title-keyword', pattern: 'CTF|writeup|flag\\{', category: '安全/CTF', tags: ['CTF'], priority: 3, safeRegex: true },
];

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function normalizeFolderPath(value: string): string {
  return value
    .split(/[\\/]/)
    .map((segment) =>
      Array.from(segment)
        .filter((character) => character.charCodeAt(0) >= 32)
        .join('')
        .trim(),
    )
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .join('/');
}

function stripRootFolder(path: string): string {
  const segments = normalizeFolderPath(path).split('/').filter(Boolean);

  while (segments.length > 0 && ROOT_FOLDER_NAMES.has(segments[0] ?? '')) {
    segments.shift();
  }

  return segments.join('/');
}

function isRootishPath(path: string): boolean {
  return stripRootFolder(path).length === 0;
}

function toInternalRule(rule: CustomRule): InternalRule | undefined {
  const category = normalizeFolderPath(rule.category);
  const pattern = rule.pattern.trim().toLowerCase();

  if (!category || !pattern) {
    return undefined;
  }

  return {
    type: rule.type,
    pattern,
    category,
    tags: [...rule.tags],
    priority: 0,
    safeRegex: false,
  };
}

function matchRule(bookmark: BookmarkItem, rules: InternalRule[]): RuleMatch | undefined {
  const hostname = getHostname(bookmark.url);
  const title = bookmark.title.toLowerCase();
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

  for (const rule of sortedRules) {
    if (rule.type === 'domain' && hostname.includes(rule.pattern.toLowerCase())) {
      return {
        category: rule.category,
        confidence: rule.priority <= 1 ? 0.95 : 0.85,
        reason: 'rule',
        ruleName: `domain:${rule.pattern}`,
        tags: [...rule.tags],
      };
    }

    if (rule.type === 'title-keyword' && rule.safeRegex) {
      const regex = new RegExp(rule.pattern, 'i');
      if (regex.test(title)) {
        return {
          category: rule.category,
          confidence: 0.72,
          reason: 'rule',
          ruleName: `title:${rule.pattern}`,
          tags: [...rule.tags],
        };
      }
    }

    if (rule.type === 'title-keyword' && !rule.safeRegex && title.includes(rule.pattern)) {
      return {
        category: rule.category,
        confidence: 0.72,
        reason: 'rule',
        ruleName: `title:${rule.pattern}`,
        tags: [...rule.tags],
      };
    }
  }

  return undefined;
}

export function classifyBookmark(
  bookmark: BookmarkItem,
  customRules: CustomRule[] = [],
): ClassificationSuggestion {
  const existingCategory = stripRootFolder(bookmark.parentPath);

  if (existingCategory && !isRootishPath(bookmark.parentPath)) {
    return {
      bookmarkId: bookmark.id,
      targetFolder: existingCategory,
      confidence: 1,
      reason: 'folder',
      ruleName: 'chrome-folder',
      tags: existingCategory.split('/'),
    };
  }

  const custom = customRules.map(toInternalRule).filter((rule): rule is InternalRule => Boolean(rule));
  const ruleMatch = matchRule(bookmark, [...custom, ...DEFAULT_RULES]);

  if (ruleMatch) {
    return {
      bookmarkId: bookmark.id,
      targetFolder: normalizeFolderPath(ruleMatch.category),
      confidence: ruleMatch.confidence,
      reason: ruleMatch.reason,
      ruleName: ruleMatch.ruleName,
      tags: ruleMatch.tags,
    };
  }

  return {
    bookmarkId: bookmark.id,
    targetFolder: '未分类',
    confidence: 0.4,
    reason: 'rule',
    ruleName: 'fallback',
    tags: [],
  };
}

function makeMoveId(bookmarkId: string, targetFolder: string): string {
  return `${bookmarkId}:${targetFolder}`;
}

function shouldMove(currentFolder: string, targetFolder: string): boolean {
  const current = stripRootFolder(currentFolder);
  const target = normalizeFolderPath(targetFolder);

  if (!target) {
    return false;
  }

  return current !== target;
}

function getExistingFolderPaths(folders: FolderItem[]): Set<string> {
  return new Set(
    folders.map((folder) => stripRootFolder(folder.path)).filter((path) => path.length > 0),
  );
}

export function generateClassificationPlan(
  bookmarks: BookmarkItem[],
  folders: FolderItem[],
  customRules: CustomRule[] = [],
  aiSuggestions: ClassificationSuggestion[] = [],
  now = new Date(),
): ClassificationPlan {
  const aiById = new Map(aiSuggestions.map((suggestion) => [suggestion.bookmarkId, suggestion]));
  const existingFolders = getExistingFolderPaths(folders);
  const moves: MovePlan[] = [];
  let unchanged = 0;

  for (const bookmark of bookmarks) {
    const suggestion = aiById.get(bookmark.id) ?? classifyBookmark(bookmark, customRules);
    const targetFolder = normalizeFolderPath(suggestion.targetFolder);

    if (!shouldMove(bookmark.parentPath, targetFolder)) {
      unchanged += 1;
      continue;
    }

    moves.push({
      id: makeMoveId(bookmark.id, targetFolder),
      bookmarkId: bookmark.id,
      bookmarkTitle: bookmark.title || bookmark.url,
      bookmarkUrl: bookmark.url,
      currentFolder: bookmark.parentPath || '根目录',
      targetFolder,
      confidence: suggestion.confidence,
      reason: suggestion.reason,
      ruleName: suggestion.ruleName,
      tags: [...suggestion.tags],
      selected: suggestion.confidence >= 0.6,
    });
  }

  const newFolders = Array.from(
    new Set(
      moves
        .map((move) => move.targetFolder)
        .filter((targetFolder) => !existingFolders.has(targetFolder)),
    ),
  ).sort((a, b) => a.localeCompare(b, 'zh-CN'));

  moves.sort((a, b) => b.confidence - a.confidence || a.bookmarkTitle.localeCompare(b.bookmarkTitle));

  return {
    moves,
    newFolders,
    unchanged,
    totalBookmarks: bookmarks.length,
    generatedAt: now.toISOString(),
  };
}

export { normalizeFolderPath, stripRootFolder };
