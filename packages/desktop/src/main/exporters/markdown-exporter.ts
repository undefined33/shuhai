import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { ProcessedBookmark } from '@shuhai/shared';
import { urlHash } from '../pipeline/normalize-url.js';
import {
  safeCategoryPath,
  safeMarkdownUrl,
  sanitizeCategory,
  sanitizeFilename,
  sanitizeMarkdownBlock,
  sanitizeMarkdownText,
  sanitizeYamlString,
} from './sanitize.js';

const DASHBOARD_FILENAME = 'Dashboard.md';

/**
 * Generate YAML frontmatter from a processed bookmark.
 */
function generateFrontmatter(bookmark: ProcessedBookmark): string {
  const lines = ['---'];
  lines.push(`title: "${sanitizeYamlString(bookmark.title)}"`);
  lines.push(`url: "${sanitizeYamlString(safeMarkdownUrl(bookmark.url))}"`);
  lines.push(`sources: ["${sanitizeYamlString(bookmark.source)}"]`);

  const allTags = [...(bookmark.aiTags || []), ...(bookmark.tags || [])]
    .map(sanitizeYamlString)
    .filter((tag) => tag.length > 0);
  if (allTags.length > 0) {
    lines.push(`tags: [${allTags.map((tag) => `"${tag}"`).join(', ')}]`);
  }

  lines.push(`category: "${sanitizeYamlString(sanitizeCategory(bookmark.category))}"`);
  lines.push(`created: ${bookmark.createdAt.toISOString().split('T')[0]}`);
  lines.push(`archived: ${new Date().toISOString().split('T')[0]}`);
  lines.push(`status: ${bookmark.status}`);

  if (bookmark.resolvedUrl && bookmark.resolvedUrl !== bookmark.url) {
    const resolvedUrl = safeMarkdownUrl(bookmark.resolvedUrl);
    if (resolvedUrl) {
      lines.push(`resolved_url: "${sanitizeYamlString(resolvedUrl)}"`);
    }
  }
  if (bookmark.confidence !== undefined) {
    lines.push(`ai_classified: true`);
    lines.push(`confidence: ${bookmark.confidence}`);
  }

  lines.push('last_modified_by: shuhai');
  lines.push('shuhai_format: 1');
  lines.push('---');
  return lines.join('\n');
}

/**
 * Generate the markdown body for a bookmark.
 */
function generateBody(bookmark: ProcessedBookmark): string {
  const lines: string[] = [];
  const title = sanitizeMarkdownText(bookmark.title) || 'Untitled';
  const source = sanitizeMarkdownText(bookmark.source);
  const categories = bookmark.categories
    ?.map(sanitizeMarkdownText)
    .filter((category) => category.length > 0);
  const bookmarkUrl = safeMarkdownUrl(bookmark.url);

  lines.push('');
  lines.push(`# ${title}`);
  lines.push('');

  if (categories && categories.length > 0) {
    lines.push(`- **来源**: Chrome 书签 > ${categories.join(' > ')}`);
  } else {
    lines.push(`- **来源**: ${source}`);
  }
  if (bookmarkUrl) {
    lines.push(`- **原始链接**: [点击访问](${bookmarkUrl})`);
  } else {
    lines.push('- **原始链接**: 不安全链接已过滤');
  }

  const statusIcon = bookmark.status === 'alive' ? '✅ 有效' :
    bookmark.status === 'dead' ? '❌ 失效' :
    bookmark.status === 'redirect' ? '↗️ 重定向' : '⏳ 未检测';
  lines.push(`- **状态**: ${statusIcon}`);
  lines.push('');

  if (bookmark.summary) {
    lines.push('## AI 摘要');
    lines.push('');
    lines.push(sanitizeMarkdownBlock(bookmark.summary));
    lines.push('');
  }

  lines.push('## 笔记');
  lines.push('');
  lines.push('');

  return lines.join('\n');
}

/**
 * Exports processed bookmarks as Markdown files to an Obsidian vault.
 */
export class MarkdownExporter {
  constructor(private readonly vaultPath: string) {}

  /**
   * Export a single bookmark to a .md file.
   * Uses atomic write (tmp + rename) for safety.
   * Never overwrites existing body content.
   */
  async exportOne(bookmark: ProcessedBookmark): Promise<string> {
    const filename = `${sanitizeFilename(bookmark.title)}-${urlHash(bookmark.url)}.md`;
    const dir = safeCategoryPath(this.vaultPath, bookmark.category);
    const filePath = join(dir, filename);

    await this.ensureDashboard();
    await mkdir(dir, { recursive: true });

    // If file exists, only update frontmatter (preserve body)
    if (existsSync(filePath)) {
      const existing = await readFile(filePath, 'utf-8');
      const bodyStart = existing.indexOf('\n---\n', 4);
      if (bodyStart !== -1) {
        const existingBody = existing.slice(bodyStart + 5);
        const newContent = generateFrontmatter(bookmark) + '\n' + existingBody;
        await this.atomicWrite(filePath, newContent);
        return filePath;
      }
    }

    // New file: write frontmatter + body
    const content = generateFrontmatter(bookmark) + generateBody(bookmark);
    await this.atomicWrite(filePath, content);
    return filePath;
  }

  /** Atomic write: write to .tmp then rename */
  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const tmpPath = filePath + '.tmp';
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(tmpPath, content, 'utf-8');
    await rename(tmpPath, filePath);
  }

  private async ensureDashboard(): Promise<void> {
    const dashboardDir = join(this.vaultPath, 'Bookmarks');
    const dashboardPath = join(dashboardDir, DASHBOARD_FILENAME);

    if (existsSync(dashboardPath)) {
      return;
    }

    await mkdir(dashboardDir, { recursive: true });
    try {
      await writeFile(dashboardPath, generateDashboard(), { encoding: 'utf-8', flag: 'wx' });
    } catch (error) {
      if (!isFileAlreadyExistsError(error)) {
        throw error;
      }
    }
  }
}

function generateDashboard(): string {
  return [
    '# Bookmarks Dashboard',
    '',
    '## 死链列表',
    '```dataview',
    'TABLE url, category, file.mtime AS "Updated"',
    'FROM "Bookmarks"',
    'WHERE shuhai_format = 1 AND status = "dead"',
    'SORT file.mtime DESC',
    '```',
    '',
    '## 本周新增',
    '```dataview',
    'TABLE url, category, created',
    'FROM "Bookmarks"',
    'WHERE shuhai_format = 1 AND created >= date(today) - dur(7 days)',
    'SORT created DESC',
    '```',
    '',
    '## 按来源统计',
    '```dataview',
    'TABLE length(rows) AS "Count"',
    'FROM "Bookmarks"',
    'WHERE shuhai_format = 1',
    'GROUP BY sources',
    'SORT length(rows) DESC',
    '```',
    '',
  ].join('\n');
}

function isFileAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
