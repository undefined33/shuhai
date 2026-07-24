import { describe, expect, it } from 'vitest';
import {
  MAX_FRONTMATTER_BYTES,
  SAFE_SOCIAL_PROPERTY_KEYS,
  neutralizeSocialBodyText,
  parseSafeMarkdownFrontmatter,
  parseSyncFrontmatter,
  renderSafeSocialMarkdown,
} from '../src/vault/safe-markdown.js';

type SocialItemInput = Parameters<typeof renderSafeSocialMarkdown>[0];

function socialItem(overrides: Partial<SocialItemInput> = {}): SocialItemInput {
  return {
    schemaVersion: 1,
    source: 'x',
    sourceItemId: '1234567890',
    canonicalUrl: 'https://x.com/example/status/1234567890',
    title: 'A saved post',
    text: 'Body text',
    author: { displayName: 'Example', handle: '@example' },
    publishedAt: '2026-07-12T10:00:00Z',
    capturedAt: '2026-07-13T12:00:00+08:00',
    completeness: 'complete',
    media: [],
    contentHash: 'a'.repeat(64),
    extractorVersion: 1,
    ...overrides,
  };
}

function frontmatterKeys(markdown: string): string[] {
  const closingDelimiter = markdown.indexOf('\n---\n', 4);
  return markdown
    .slice(4, closingDelimiter)
    .split('\n')
    .map((line) => line.slice(0, line.indexOf(':')));
}

describe('safe social Markdown', () => {
  it('serializes only the fixed properties whitelist and round-trips it', () => {
    const item = socialItem({
      title: 'Title that must stay out of properties',
    });
    const markdown = renderSafeSocialMarkdown(item);

    expect(frontmatterKeys(markdown)).toEqual(SAFE_SOCIAL_PROPERTY_KEYS);
    expect(markdown.slice(0, markdown.indexOf('\n---\n', 4))).not.toContain('page_payload');
    expect(markdown.slice(0, markdown.indexOf('\n---\n', 4))).not.toContain('title:');

    const parsed = parseSyncFrontmatter(markdown);
    expect(parsed).toEqual(
      expect.objectContaining({
        ok: true,
        properties: expect.objectContaining({
          source: 'x',
          sourceItemId: '1234567890',
          completeness: 'complete',
          contentHash: 'a'.repeat(64),
        }),
      }),
    );
    if (parsed.ok) {
      expect(parsed.frontmatterBytes).toBeLessThanOrEqual(MAX_FRONTMATTER_BYTES);
    }

    expect(() =>
      renderSafeSocialMarkdown({
        ...item,
        page_payload: 'must not be accepted',
      } as SocialItemInput),
    ).toThrow();
    expect(() =>
      renderSafeSocialMarkdown(socialItem({ sourceItemId: 'id": properties injected' })),
    ).toThrow('X sourceItemId');
  });

  it('keeps hostile body and remote media as inert indented data', () => {
    const attack = [
      '---',
      'evil: !!js/function >',
      'javascript:alert(1)',
      'java script&#58;alert(2)',
      'data:text/html,<script>alert(1)</script>',
      '<img src="https://tracker.example/pixel" onerror=alert(1)>',
      '<iframe src="https://tracker.example"></iframe>',
      '<form action="https://tracker.example"><input onclick=go()></form>',
      '![remote](https://tracker.example/image.png)',
      '![[secret-embed]]',
      '[[wiki-command]]',
      '<% tp.system.exec("calc") %>',
      '{{renderer :danger}}',
      '```dataviewjs',
      'dv.io.load("private")',
      '```',
      '> [!danger] plugin callout',
      'query:: `= dv.pages()`',
      '~~~button',
      'command: shell',
      '~~~',
      'obsidian://advanced-uri?vault=private',
      'control\u0085separator',
      '...',
    ].join('\n');
    const markdown = renderSafeSocialMarkdown(
      socialItem({
        title: attack,
        text: attack,
        media: [
          {
            type: 'image',
            url: 'https://cdn.example/remote.png',
            alt: '![[embed]] {{query}}',
          },
        ],
      }),
    );
    const body = markdown.slice(markdown.indexOf('\n---\n', 4) + 5);

    expect(body).not.toContain('javascript:');
    expect(body).not.toContain('data:');
    expect(body).not.toContain('obsidian:');
    expect(body).not.toContain('<img');
    expect(body).not.toContain('<iframe');
    expect(body).not.toContain('<form');
    expect(body).not.toContain('onerror=');
    expect(body).not.toContain('onclick=');
    expect(body).not.toContain('![');
    expect(body).not.toContain('[[');
    expect(body).not.toContain('<%');
    expect(body).not.toContain('{{');
    expect(body).not.toContain('```');
    expect(body).not.toContain('~~~');
    expect(body).not.toContain('::');
    expect(body).not.toContain('\u0085');
    expect(body).not.toMatch(/^> \[!/m);
    expect(body).toContain('https://cdn.example/remote.png');
    expect(body).not.toContain('![remote');

    const dynamicLines = body
      .split('\n')
      .filter((line) => line.includes('blocked scheme') || line.includes('tracker.example'));
    expect(dynamicLines.length).toBeGreaterThan(0);
    expect(dynamicLines.every((line) => line.startsWith('    '))).toBe(true);
  });

  it('rejects unsafe remote media instead of emitting it', () => {
    expect(() =>
      renderSafeSocialMarkdown(
        socialItem({ media: [{ type: 'image', url: 'data:image/png;base64,AA==' }] }),
      ),
    ).toThrow('https URL');
  });

  it('rejects unknown and duplicate properties', () => {
    const markdown = renderSafeSocialMarkdown(socialItem());
    const unknown = markdown.replace('\n---\n\n#', '\npage_payload: "run"\n---\n\n#');
    const duplicate = markdown.replace(
      'source_item_id: "1234567890"',
      'source_item_id: "1234567890"\nsource_item_id: "other"',
    );

    expect(parseSyncFrontmatter(unknown)).toEqual(
      expect.objectContaining({ ok: false, code: 'unknown_property' }),
    );
    expect(parseSafeMarkdownFrontmatter(duplicate)).toEqual(
      expect.objectContaining({ ok: false, code: 'duplicate_property' }),
    );
  });

  it('rejects YAML syntax and malformed scalar values', () => {
    const markdown = renderSafeSocialMarkdown(socialItem());
    const yamlTag = markdown.replace('source: "x"', 'source: !!js/function "x"');
    const credentialUrl = markdown.replace(
      'https://x.com/example/status/1234567890',
      'https://user:secret@x.com/example/status/1234567890',
    );

    expect(parseSyncFrontmatter(yamlTag)).toEqual(
      expect.objectContaining({ ok: false, code: 'invalid_property' }),
    );
    expect(parseSyncFrontmatter(credentialUrl)).toEqual(
      expect.objectContaining({ ok: false, code: 'invalid_property' }),
    );

    const mismatchedIdentity = markdown.replace(
      'source_item_id: "1234567890"',
      'source_item_id: "999"',
    );
    expect(parseSyncFrontmatter(mismatchedIdentity)).toEqual(
      expect.objectContaining({ ok: false, code: 'invalid_property' }),
    );
  });

  it('rejects frontmatter larger than 8 KiB without parsing the body', () => {
    const tooLarge = [
      '---',
      'shuhai_schema: 1',
      'source: "x"',
      `source_item_id: "${'a'.repeat(MAX_FRONTMATTER_BYTES)}"`,
      '---',
    ].join('\n');
    const bodyHeavy = `${renderSafeSocialMarkdown(socialItem())}${'body '.repeat(50_000)}`;

    expect(parseSyncFrontmatter(tooLarge)).toEqual(
      expect.objectContaining({ ok: false, code: 'frontmatter_too_large' }),
    );
    expect(parseSyncFrontmatter(bodyHeavy)).toEqual(expect.objectContaining({ ok: true }));
  });

  it('neutralizes standalone plugin syntax independently', () => {
    expect(neutralizeSocialBodyText('---\nkey:: {{x}}\n```button\nobsidian://open')).toBe(
      '\\---\nkey: : { {x} }\n\\`\\`\\`button\n[blocked scheme]//open',
    );
  });
});
