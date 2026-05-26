import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { ProcessedBookmark } from '@shuhai/shared';
import { urlHash } from '../pipeline/normalize-url.js';

/**
 * Sanitize a string for use as a filename.
 * Replaces illegal characters, preserves CJK.
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/**
 * Generate YAML frontmatter from a processed bookmark.
 */
function generateFrontmatter(bookmark: ProcessedBookmark): string {
  const lines = ['---'];
  lines.push(`title: "${bookmark.title.replace(/"/g, '\\"')}"`);
  lines.push(`url: "${bookmark.url}"`);
  lines.push(`sources: [${bookmark.source}]`);

  const allTags = [...(bookmark.aiTags || []), ...(bookmark.tags || [])];
  if (allTags.length > 0) {
    lines.push(`tags: [${allTags.join(', ')}]`);
  }

  lines.push(`category: ${bookmark.category}`);
  lines.push(`created: ${bookmark.createdAt.toISOString().split('T')[0]}`);
  lines.push(`archived: ${new Date().toISOString().split('T')[0]}`);
  lines.push(`status: ${bookmark.status}`);

  if (bookmark.resolvedUrl && bookmark.resolvedUrl !== bookmark.url) {
    lines.push(`resolved_url: "${bookmark.resolvedUrl}"`);
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
  lines.push('');
  lines.push(`# ${bookmark.title}`);
  lines.push('');

  if (bookmark.categories && bookmark.categories.length > 0) {
    lines.push(`- **来源**: Chrome 书签 > ${bookmark.categories.join(' > ')}`);
  } else {
    lines.push(`- **来源**: ${bookmark.source}`);
  }
  lines.push(`- **原始链接**: [点击访问](${bookmark.url})`);

  const statusIcon = bookmark.status === 'alive' ? '✅ 有效' :
    bookmark.status === 'dead' ? '❌ 失效' :
    bookmark.status === 'redirect' ? '↗️ 重定向' : '⏳ 未检测';
  lines.push(`- **状态**: ${statusIcon}`);
  lines.push('');

  if (bookmark.summary) {
    lines.push('## AI 摘要');
    lines.push('');
    lines.push(bookmark.summary);
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
    const categoryDir = bookmark.category.replace(/\//g, '/');
    const dir = join(this.vaultPath, 'Bookmarks', categoryDir);
    const filePath = join(dir, filename);

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
}
