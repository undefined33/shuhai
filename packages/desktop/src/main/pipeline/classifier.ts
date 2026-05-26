import type { RawBookmark, ClassificationRule } from '@shuhai/shared';

/** Classification result */
export interface ClassificationResult {
  category: string;
  tags: string[];
}

/** Built-in default rules */
const DEFAULT_RULES: ClassificationRule[] = [
  // Dev
  { type: 'domain', pattern: 'github.com', category: '开发/代码', tags: ['GitHub'], priority: 1 },
  { type: 'domain', pattern: 'stackoverflow.com', category: '开发/问答', tags: ['StackOverflow'], priority: 1 },
  { type: 'domain', pattern: 'npmjs.com', category: '开发/工具', tags: ['npm'], priority: 1 },
  { type: 'domain', pattern: 'developer.mozilla.org', category: '开发/文档', tags: ['MDN'], priority: 1 },
  { type: 'title-keyword', pattern: 'React|Vue|Angular|Svelte|Next', category: '开发/前端', tags: ['前端'], priority: 2 },
  { type: 'title-keyword', pattern: 'Python|Rust|Go|Java|C\\+\\+', category: '开发/语言', tags: [], priority: 2 },
  // Content
  { type: 'domain', pattern: 'medium.com', category: '文章', tags: ['博客'], priority: 1 },
  { type: 'domain', pattern: 'youtube.com', category: '视频', tags: ['YouTube'], priority: 1 },
  { type: 'domain', pattern: 'bilibili.com', category: '视频', tags: ['B站'], priority: 1 },
  // Knowledge
  { type: 'domain', pattern: 'zhihu.com', category: '知识/知乎', tags: ['知乎'], priority: 1 },
  { type: 'domain', pattern: 'wikipedia.org', category: '知识/百科', tags: ['维基'], priority: 1 },
  // Design & Tools
  { type: 'domain', pattern: 'figma.com', category: '设计', tags: ['Figma'], priority: 1 },
  { type: 'domain', pattern: 'notion.so', category: '工具', tags: ['Notion'], priority: 1 },
];

/**
 * Rule-based bookmark classifier.
 * Three layers: chrome folder → domain rules → title keyword rules.
 */
export class RuleClassifier {
  private rules: ClassificationRule[];

  constructor(customRules: ClassificationRule[] = []) {
    // Custom rules have higher priority
    this.rules = [...customRules, ...DEFAULT_RULES];
  }

  /**
   * Classify a bookmark using the three-layer strategy.
   */
  classify(bookmark: RawBookmark): ClassificationResult {
    // Layer 1: Chrome folder path → direct category mapping
    if (bookmark.categories && bookmark.categories.length > 0) {
      return {
        category: bookmark.categories.join('/'),
        tags: [...bookmark.categories],
      };
    }

    // Layer 2 & 3: Match rules (domain first, then keyword)
    const domainRules = this.rules.filter((r) => r.type === 'domain');
    const keywordRules = this.rules.filter((r) => r.type === 'title-keyword');

    let hostname = '';
    try {
      hostname = new URL(bookmark.url).hostname;
    } catch {
      // Invalid URL, skip domain matching
    }

    // Check domain rules
    for (const rule of domainRules) {
      if (hostname.includes(rule.pattern)) {
        return { category: rule.category, tags: [...rule.tags] };
      }
    }

    // Check title keyword rules
    for (const rule of keywordRules) {
      const regex = new RegExp(rule.pattern, 'i');
      if (regex.test(bookmark.title)) {
        return { category: rule.category, tags: [...rule.tags] };
      }
    }

    // No match → uncategorized
    return { category: '未分类', tags: [] };
  }
}