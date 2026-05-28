import { describe, expect, it } from 'vitest';
import type { BookmarkItem, CapturedContent } from '../src/shared/bookmark-types.js';
import {
  generateBookmarkMarkdown,
  generateCapturedContentMarkdown,
} from '../src/utils/markdown-generator.js';
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
});
