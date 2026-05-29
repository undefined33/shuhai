import { describe, expect, it } from 'vitest';
import type { BookmarkItem, CapturedContent } from '../src/shared/bookmark-types.js';
import {
  generateBookmarkMarkdown,
  generateCapturedContentMarkdown,
} from '../src/utils/markdown-generator.js';
import { getDefaultTemplate, renderTemplate } from '../src/utils/markdown-templates.js';
import {
  neutralizeObsidianSyntax,
  sanitizeFileName,
  sanitizeUrl,
  sanitizeYamlString,
} from '../src/utils/sanitize.js';

const bookmark: BookmarkItem = {
  id: 'b1',
  title: 'CVE <% tp.system.exec("calc") %> {{bad}}',
  url: 'javascript:alert(1)',
  parentId: '1',
  parentTitle: 'APT',
  parentPath: 'Bookmarks Bar/APT',
  index: 0,
};

describe('markdown sanitization', () => {
  it('escapes YAML strings and dangerous file names', () => {
    expect(sanitizeYamlString('a"\nb')).toBe('"a\\" b"');
    expect(sanitizeFileName('../CON:*?')).toBe('untitled.md');
  });

  it('allows only safe URL schemes', () => {
    expect(sanitizeUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(sanitizeUrl('mailto:test@example.com')).toBe('mailto:test@example.com');
    expect(sanitizeUrl('javascript:alert(1)')).toBe('');
  });

  it('neutralizes Obsidian executable syntax', () => {
    const text = neutralizeObsidianSyntax(
      '<% tp.file %> {{query}}\n```dataviewjs\nTABLE\n```\nobsidian://open\n![[secret]]',
    );

    expect(text).toContain('<\\%');
    expect(text).toContain('\\{\\{query\\}\\}');
    expect(text).toContain('```text');
    expect(text).toContain('obsidian-disabled://open');
    expect(text).toContain('\\!\\[\\[secret]]');
  });

  it('generates safe bookmark markdown', () => {
    const markdown = generateBookmarkMarkdown(bookmark);

    expect(markdown).toContain('source: chrome');
    expect(markdown).toContain('shuhai_format: 3');
    expect(markdown).toContain('已过滤不安全 URL');
    expect(markdown).not.toContain('javascript:alert');
    expect(markdown).not.toContain('<% tp.system');
    expect(markdown).not.toContain('{{bad}}');
  });

  it('generates social markdown with media as plain links', () => {
    const capture: CapturedContent = {
      id: 'tweet-1',
      source: 'twitter',
      title: 'Tweet',
      url: 'https://x.com/a/status/1',
      text: 'payload ![x](https://example.com/x.png)',
      media: [{ url: 'https://pbs.twimg.com/media/a.jpg', alt: 'sample' }],
      tags: ['twitter'],
      capturedAt: new Date(0).toISOString(),
    };
    const markdown = generateCapturedContentMarkdown(capture);

    expect(markdown).toContain('[图片: sample](https://pbs.twimg.com/media/a.jpg)');
    expect(markdown).not.toContain('![图片');
    expect(markdown).not.toContain('![');
  });

  it('generates article markdown with article frontmatter and hardened body', () => {
    const capture: CapturedContent = {
      id: 'article-1',
      source: 'article',
      title: 'Article <% bad %>',
      url: 'https://example.com/article',
      author: 'Alice',
      siteName: 'Example Blog',
      description: 'Research {{query}}',
      created: '2026-05-28',
      text: [
        '# Heading',
        '',
        'Body ![remote](https://example.com/a.png)',
        '',
        '```dataview',
        'TABLE file.mtime',
        '```',
        '',
        'obsidian://open',
      ].join('\n'),
      media: [],
      tags: ['article'],
      capturedAt: new Date(0).toISOString(),
      wordCount: 42,
    };
    const markdown = generateCapturedContentMarkdown(capture, new Date('2026-05-28T00:00:00Z'));

    expect(markdown).toContain('source: article');
    expect(markdown).toContain('site: "Example Blog"');
    expect(markdown).toContain('saved: 2026-05-28');
    expect(markdown).toContain('shuhai_format: 3');
    expect(markdown).toContain('word_count: 42');
    expect(markdown).toContain('[图片: remote](https://example.com/a.png)');
    expect(markdown).toContain('```text');
    expect(markdown).toContain('obsidian-disabled://open');
    expect(markdown).not.toContain('![');
    expect(markdown).not.toContain('<% bad %>');
    expect(markdown).not.toContain('{{query}}');
  });

  it('renders custom templates and removes unknown variables', () => {
    const markdown = renderTemplate(getDefaultTemplate('bookmark'), {
      title: 'A',
      title_yaml: '"A"',
      url: 'https://example.com',
      url_yaml: '"https://example.com"',
      url_link: '[打开](https://example.com)',
      folder: '研究',
      folder_yaml: '"研究"',
      confidence: '',
      date: '2026-05-29',
      created: '',
      tags: '["tag"]',
    });

    expect(markdown).toContain('# A');
    expect(markdown).not.toContain('{{');
  });

  it('keeps sanitization effective after template rendering', () => {
    const markdown = renderTemplate(
      {
        id: 'custom',
        name: 'Custom',
        scope: 'article',
        frontmatter: 'title: {{title_yaml}}\nrun: <% tp.system.exec("calc") %>',
        body: '![remote](https://example.com/x.png)\n```dataview\nTABLE\n```',
      },
      {
        title_yaml: '"Research {{query}}"',
      },
    );

    expect(markdown).toContain('<\\%');
    expect(markdown).toContain('[图片: remote](https://example.com/x.png)');
    expect(markdown).toContain('```text');
    expect(markdown).not.toContain('![');
    expect(markdown).not.toContain('{{query}}');
  });
});
