import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MAX_FRONTMATTER_BYTES,
  SAFE_SOCIAL_PROPERTY_KEYS,
  neutralizeSocialBodyText,
  parseSafeMarkdownFrontmatter,
  parseSyncFrontmatter,
  renderSafeSocialMarkdown,
} from '../src/vault/safe-markdown.js';
import {
  formatVisibleSocialMarkdown,
  parseVisibleSocialMarkdown,
} from './helpers/markdown-visible-text-oracle.js';

type SocialItemInput = Parameters<typeof renderSafeSocialMarkdown>[0];

function normalizeFixtureNewlines(value: string): string {
  return value.replaceAll('\r\n', '\n');
}

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
  it('renders a readable fixed structure with an independent visible-text oracle', () => {
    const item = socialItem({
      title: '安全研究 AT&T: Reading <signals> with `code` (notes)',
      text: [
        '第一段保留 AT&T、1 < 2、`code` 和括号 (test)。',
        'Second paragraph keeps https://example.com/research?q=(x) as visible evidence.',
      ].join('\n\n'),
      author: { displayName: '研究员 Alice & Bob', handle: '@alice_sec' },
      media: [
        {
          type: 'image',
          url: 'https://cdn.example/images/diagram%20one.png',
          alt: '架构图 <overview>',
        },
        {
          type: 'link',
          url: 'https://example.com/source?q=AT%26T#notes',
          alt: 'Reference (primary)',
        },
      ],
    });
    const markdown = renderSafeSocialMarkdown(item);
    const expectedMarkdown = normalizeFixtureNewlines(
      readFileSync(new URL('./fixtures/safe-readable-social.md', import.meta.url), 'utf8'),
    );
    const expectedVisible = normalizeFixtureNewlines(
      readFileSync(new URL('./fixtures/safe-readable-social.visible.txt', import.meta.url), 'utf8'),
    );

    expect(markdown).toBe(expectedMarkdown);
    expect(formatVisibleSocialMarkdown(parseVisibleSocialMarkdown(markdown))).toBe(expectedVisible);
    expect(markdown).not.toContain('    第一段');
    expect(markdown).not.toContain('```');
    expect(markdown).not.toContain('![');
  });

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

  it('keeps hostile body readable while leaving active syntax inert', () => {
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
      'file:///C:/private.txt',
      'vbscript:msgbox(1)',
      '# injected heading',
      '- injected list',
      '> [!danger] second callout',
      '    indented code',
      '\t- tabbed list',
      '\\[[escaped-wikilink]]',
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
    expect(body).not.toContain('file:');
    expect(body).not.toContain('vbscript:');
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

    const visible = parseVisibleSocialMarkdown(markdown);
    const expectedVisibleAttack = attack.replace('\t', ' ').replace('\u0085', '');
    expect(visible.title).toBe(expectedVisibleAttack.replace(/\n+/g, ' '));
    expect(visible.content).toBe(expectedVisibleAttack);
    expect(visible.media).toEqual([
      {
        label: 'Open image 1',
        target: 'https://cdn.example/remote.png',
        alt: '![[embed]] {{query}}',
      },
    ]);
  });

  it('normalizes and encodes HTTPS link destinations without double encoding', () => {
    const markdown = renderSafeSocialMarkdown(
      socialItem({
        media: [
          {
            type: 'link',
            url: 'https://example.com/a path/(report)[v1]/雪?q=100%&ok=%20#part(2)',
            alt: 'Link target test',
          },
        ],
      }),
    );
    const visible = parseVisibleSocialMarkdown(markdown);

    expect(visible.sourceTarget).toBe('https://x.com/example/status/1234567890');
    expect(visible.media[0]?.target).toBe(
      'https://example.com/a%20path/%28report%29%5Bv1%5D/%E9%9B%AA?q=100%25&ok=%20#part%282%29',
    );
    expect(markdown).not.toContain('%2520');
  });

  it('preserves visible boundary whitespace without exposing block syntax', () => {
    const markdown = renderSafeSocialMarkdown(
      socialItem({
        title: '  padded title  \nnext line ',
        text: '\n  leading and trailing  \n\nlast line  \n',
        author: { displayName: ' Alice ', handle: ' @alice ' },
      }),
    );
    const visible = parseVisibleSocialMarkdown(markdown);

    expect(visible.title).toBe('  padded title   next line ');
    expect(visible.author).toBe(' Alice  ·  @alice ');
    expect(visible.content).toBe('\n  leading and trailing  \n\nlast line  \n');
    expect(markdown).not.toMatch(/^\s{4}leading/mu);
    expect(markdown).not.toMatch(/[ \t]+$/mu);
    const rawContent = markdown.slice(markdown.indexOf('## Content\n\n') + '## Content\n\n'.length);
    expect(rawContent).not.toMatch(/^ {0,3}(?:[-+*#>]|[0-9]+\.)\s/mu);
  });

  it('rejects unsafe remote media instead of emitting it', () => {
    expect(() =>
      renderSafeSocialMarkdown(
        socialItem({ media: [{ type: 'image', url: 'data:image/png;base64,AA==' }] }),
      ),
    ).toThrow('https URL');
    expect(() =>
      renderSafeSocialMarkdown(
        socialItem({
          media: [{ type: 'link', url: 'https://user:secret@example.com/private' }],
        }),
      ),
    ).toThrow('without credentials');
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
      '&#45;&#45;&#45;\nkey&#58;&#58; &#123;&#123;x&#125;&#125;\n&#96;&#96;&#96;button\nobsidian&#58;//open',
    );
  });
});
