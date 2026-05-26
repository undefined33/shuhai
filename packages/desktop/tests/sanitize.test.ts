import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import {
  safeCategoryPath,
  safeMarkdownUrl,
  sanitizeCategory,
  sanitizeFilename,
  sanitizeMarkdownBlock,
  sanitizeYamlString,
  stripTemplateSyntax,
} from '../src/main/exporters/sanitize.js';

describe('exporter sanitizers', () => {
  it('removes YAML injection line breaks and escapes quotes/backslashes', () => {
    const payload = 'Bad title"\n---\nadmin: true\\\x00';
    const sanitized = sanitizeYamlString(payload);

    expect(sanitized).toBe('Bad title\\"---admin: true\\\\');
    expect(sanitized).not.toContain('\n');
  });

  it('keeps category paths inside the Bookmarks directory', () => {
    const vaultPath = resolve('tmp-vault');
    const safePath = safeCategoryPath(vaultPath, '../../outside/..\\evil');

    expect(safePath.startsWith(resolve(join(vaultPath, 'Bookmarks')))).toBe(true);
    expect(safePath).not.toContain('..');
    expect(sanitizeCategory('../../outside')).toBe('outside');
  });

  it('escapes Markdown link parentheses and filters JavaScript/data URLs', () => {
    expect(safeMarkdownUrl('https://example.com/a)b(c')).toBe('https://example.com/a%29b%28c');
    expect(safeMarkdownUrl('javascript:alert(1)')).toBe('');
    expect(safeMarkdownUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(safeMarkdownUrl('vbscript:msgbox(1)')).toBe('');
  });

  it('replaces executable template syntax with full-width tokens', () => {
    const payload = '<%* app.vault.delete() %> {{ template }}';
    const sanitized = stripTemplateSyntax(payload);

    expect(sanitized).toBe('＜% app.vault.delete() %＞ ｛｛ template ｝｝');
    expect(sanitizeMarkdownBlock(payload)).not.toContain('<%');
    expect(sanitized).not.toContain('{{');
  });

  it('creates safe filenames for empty, hidden, and control-character titles', () => {
    expect(sanitizeFilename('..\n\t')).toBe('untitled');
    expect(sanitizeFilename('.hidden title.')).toBe('hidden title');
    expect(sanitizeFilename('bad/name\\with:chars')).toBe('bad-name-with-chars');
  });
});
