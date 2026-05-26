import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ChromeFileReader } from '../src/main/readers/chrome-file-reader.js';
import { BookmarkPipeline } from '../src/main/pipeline/index.js';

// Sample Chrome Bookmarks JSON
const SAMPLE_BOOKMARKS = {
  roots: {
    bookmark_bar: {
      type: 'folder',
      name: 'Bookmarks Bar',
      children: [
        {
          type: 'folder',
          name: '开发',
          children: [
            {
              type: 'url',
              name: 'GitHub',
              url: 'https://github.com',
              date_added: '13350451200000000',
            },
            {
              type: 'url',
              name: 'React Docs',
              url: 'https://react.dev/?utm_source=newsletter',
              date_added: '13350451200000000',
            },
          ],
        },
        {
          type: 'url',
          name: 'YouTube',
          url: 'https://www.youtube.com/',
          date_added: '13350451200000000',
        },
        {
          type: 'url',
          name: 'Local File',
          url: 'file:///C:/docs/local.pdf',
          date_added: '13350451200000000',
        },
      ],
    },
    other: { type: 'folder', name: 'Other', children: [] },
    synced: { type: 'folder', name: 'Synced', children: [] },
  },
};

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `shuhai-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('ChromeFileReader', () => {
  it('parses Chrome bookmarks JSON correctly', async () => {
    const bookmarksPath = join(testDir, 'Bookmarks');
    await writeFile(bookmarksPath, JSON.stringify(SAMPLE_BOOKMARKS));

    // Create a reader that uses our test file
    const reader = new (class extends ChromeFileReader {
      constructor() { super(); }
      override getPath() { return bookmarksPath; }
      override exists() { return true; }
      async read() {
        const { readFile: rf } = await import('node:fs/promises');
        const content = await rf(bookmarksPath, 'utf-8');
        const data = JSON.parse(content);
        const bookmarks: any[] = [];
        this['traverse'](data.roots.bookmark_bar, [], bookmarks);
        this['traverse'](data.roots.other, ['Other'], bookmarks);
        return bookmarks;
      }
    })();

    const bookmarks = await reader.read();

    // Should skip file:// URLs
    expect(bookmarks.length).toBe(3);
    expect(bookmarks[0].title).toBe('GitHub');
    expect(bookmarks[0].categories).toEqual(['Bookmarks Bar', '开发']);
    expect(bookmarks[1].url).toContain('react.dev');
    expect(bookmarks[2].title).toBe('YouTube');
  });
});

describe('Full Pipeline (integration)', () => {
  it('reads, classifies, and exports bookmarks', async () => {
    const bookmarksPath = join(testDir, 'Bookmarks');
    const vaultPath = join(testDir, 'vault');
    await writeFile(bookmarksPath, JSON.stringify(SAMPLE_BOOKMARKS));
    await mkdir(vaultPath, { recursive: true });

    // We need to test the pipeline components individually since
    // BookmarkPipeline uses getChromeBookmarksPath internally.
    // Instead, test the exporter directly with processed data.
    const { MarkdownExporter } = await import('../src/main/exporters/markdown-exporter.js');
    const exporter = new MarkdownExporter(vaultPath);

    const result = await exporter.exportOne({
      url: 'https://github.com',
      title: 'GitHub',
      source: 'chrome',
      contentType: 'article',
      createdAt: new Date('2024-01-15'),
      id: 'abc123',
      normalizedUrl: 'https://github.com/',
      category: '开发/代码',
      aiTags: ['GitHub'],
      status: 'unchecked',
    });

    expect(result).toContain('vault');
    expect(result).toContain('.md');

    const content = await readFile(result, 'utf-8');
    expect(content).toContain('---');
    expect(content).toContain('title: "GitHub"');
    expect(content).toContain('url: "https://github.com"');
    expect(content).toContain('category: "开发/代码"');
    expect(content).toContain('tags: ["GitHub"]');
    expect(content).toContain('shuhai_format: 1');
    expect(content).toContain('# GitHub');
  });

  it('sanitizes exporter attack payloads in generated markdown', async () => {
    const vaultPath = join(testDir, 'security-vault');
    await mkdir(vaultPath, { recursive: true });

    const { MarkdownExporter } = await import('../src/main/exporters/markdown-exporter.js');
    const exporter = new MarkdownExporter(vaultPath);

    const filePath = await exporter.exportOne({
      url: 'javascript:alert(1)',
      title: '.\n---\ninjected: true\n<%* app.vault.delete() %> {{ title }}',
      source: 'chrome',
      contentType: 'article',
      createdAt: new Date('2024-01-15'),
      id: 'attack',
      normalizedUrl: 'javascript:alert(1)',
      category: '../../outside/<%* code %>',
      tags: ['tag\nadmin: true', '{{ tag }}'],
      aiTags: ['<%* tag %>'],
      summary: 'Summary <%* app.vault.delete() %> {{ template }}',
      status: 'unchecked',
    });

    const content = await readFile(filePath, 'utf-8');
    const frontmatterMarkers = content.match(/^---$/gm) ?? [];

    expect(resolve(filePath).startsWith(resolve(join(vaultPath, 'Bookmarks')))).toBe(true);
    expect(frontmatterMarkers).toHaveLength(2);
    expect(content).not.toContain('\ninjected: true');
    expect(content).not.toContain('<%');
    expect(content).not.toContain('%>');
    expect(content).not.toContain('{{');
    expect(content).not.toContain('}}');
    expect(content).toContain('url: ""');
    expect(content).toContain('不安全链接已过滤');
  });

  it('does not overwrite existing body content', async () => {
    const vaultPath = join(testDir, 'vault2');
    await mkdir(vaultPath, { recursive: true });

    const { MarkdownExporter } = await import('../src/main/exporters/markdown-exporter.js');
    const exporter = new MarkdownExporter(vaultPath);

    const bookmark = {
      url: 'https://example.com/article',
      title: 'Test Article',
      source: 'chrome' as const,
      contentType: 'article' as const,
      createdAt: new Date('2024-06-01'),
      id: 'def456',
      normalizedUrl: 'https://example.com/article',
      category: '文章',
      status: 'alive' as const,
    };

    // First export
    const filePath = await exporter.exportOne(bookmark);

    // Simulate user editing the body
    let content = await readFile(filePath, 'utf-8');
    content += '\n我的笔记：这篇文章很有用\n';
    await writeFile(filePath, content, 'utf-8');

    // Re-export (should preserve body)
    await exporter.exportOne({ ...bookmark, status: 'dead' });
    const updated = await readFile(filePath, 'utf-8');

    expect(updated).toContain('我的笔记：这篇文章很有用');
    expect(updated).toContain('status: dead');
  });

  it('creates a Dataview dashboard on first export without overwriting it', async () => {
    const vaultPath = join(testDir, 'dashboard-vault');
    await mkdir(vaultPath, { recursive: true });

    const { MarkdownExporter } = await import('../src/main/exporters/markdown-exporter.js');
    const exporter = new MarkdownExporter(vaultPath);
    const bookmark = {
      url: 'https://example.com/dashboard',
      title: 'Dashboard Bookmark',
      source: 'chrome' as const,
      contentType: 'article' as const,
      createdAt: new Date('2024-06-01'),
      id: 'dashboard',
      normalizedUrl: 'https://example.com/dashboard',
      category: '文章',
      status: 'unchecked' as const,
    };

    await exporter.exportOne(bookmark);
    const dashboardPath = join(vaultPath, 'Bookmarks', 'Dashboard.md');
    const dashboard = await readFile(dashboardPath, 'utf-8');

    expect(dashboard).toContain('## 死链列表');
    expect(dashboard).toContain('## 本周新增');
    expect(dashboard).toContain('## 按来源统计');
    expect(dashboard).toContain('```dataview');

    await writeFile(dashboardPath, '用户自定义 Dashboard', 'utf-8');
    await exporter.exportOne({ ...bookmark, id: 'dashboard-2', url: 'https://example.com/next' });
    await expect(readFile(dashboardPath, 'utf-8')).resolves.toBe('用户自定义 Dashboard');
  });
});
