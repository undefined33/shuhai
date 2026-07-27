import {
  CaptureCompletenessSchema,
  ContentHashSchema,
  HttpsUrlSchema,
  IsoTimestampSchema,
  SocialSourceSchema,
  SourceItemIdSchema,
  parseSocialItem,
  type SocialItem,
} from '../social/sync-schema.js';

export const MAX_FRONTMATTER_BYTES = 8 * 1024;

export const SAFE_SOCIAL_PROPERTY_KEYS = [
  'shuhai_schema',
  'source',
  'source_item_id',
  'canonical_url',
  'captured_at',
  'capture_completeness',
  'content_hash',
  'extractor_version',
] as const;

const PROPERTY_KEY_SET = new Set<string>(SAFE_SOCIAL_PROPERTY_KEYS);
const DISPLAY_SYNTAX_CODE_POINTS = new Set([
  0x21, // !
  0x22, // "
  0x23, // #
  0x24, // $
  0x25, // %
  0x26, // &
  0x27, // '
  0x28, // (
  0x29, // )
  0x2a, // *
  0x2b, // +
  0x2d, // -
  0x2e, // .
  0x3a, // :
  0x3c, // <
  0x3d, // =
  0x3e, // >
  0x5b, // [
  0x5c, // \
  0x5d, // ]
  0x5e, // ^
  0x5f, // _
  0x60, // `
  0x7b, // {
  0x7c, // |
  0x7d, // }
  0x7e, // ~
]);
const RAW_URL_DESTINATION_CHARACTER = /^[A-Za-z0-9:/?#@!$&'*+,;=._~-]$/u;

export interface SafeSocialProperties {
  schemaVersion: 1;
  source: 'x' | 'weibo';
  sourceItemId: string;
  canonicalUrl: string;
  capturedAt: string;
  completeness: 'complete' | 'summary_only' | 'metadata_only' | 'unsupported';
  contentHash: string;
  extractorVersion: number;
}

export type SafeMarkdownParseErrorCode =
  | 'missing_frontmatter'
  | 'unterminated_frontmatter'
  | 'frontmatter_too_large'
  | 'invalid_property'
  | 'unknown_property'
  | 'duplicate_property'
  | 'missing_property';

export type SafeMarkdownParseResult =
  | { ok: true; properties: SafeSocialProperties; frontmatterBytes: number }
  | { ok: false; code: SafeMarkdownParseErrorCode; error: string };

function parseError(code: SafeMarkdownParseErrorCode, error: string): SafeMarkdownParseResult {
  return { ok: false, code, error };
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) as number;
  return codePoint < 32 || (codePoint >= 127 && codePoint <= 159);
}

function normalizeUntrustedText(value: string): string {
  return Array.from(value.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, ' '))
    .filter((character) => character === '\n' || !isControlCharacter(character))
    .join('');
}

function propertiesFromItem(item: SocialItem): SafeSocialProperties {
  return {
    schemaVersion: 1,
    source: item.source,
    sourceItemId: item.sourceItemId,
    canonicalUrl: item.canonicalUrl,
    capturedAt: item.capturedAt,
    completeness: item.completeness,
    contentHash: item.contentHash,
    extractorVersion: item.extractorVersion,
  };
}

function yamlJsonScalar(value: string): string {
  return JSON.stringify(value);
}

function serializeProperties(properties: SafeSocialProperties): string {
  const lines = [
    '---',
    `shuhai_schema: ${properties.schemaVersion}`,
    `source: ${yamlJsonScalar(properties.source)}`,
    `source_item_id: ${yamlJsonScalar(properties.sourceItemId)}`,
    `canonical_url: ${yamlJsonScalar(properties.canonicalUrl)}`,
    `captured_at: ${yamlJsonScalar(properties.capturedAt)}`,
    `capture_completeness: ${yamlJsonScalar(properties.completeness)}`,
    `content_hash: ${yamlJsonScalar(properties.contentHash)}`,
    `extractor_version: ${properties.extractorVersion}`,
    '---',
  ];
  const frontmatter = `${lines.join('\n')}\n`;

  if (utf8Bytes(frontmatter) > MAX_FRONTMATTER_BYTES) {
    throw new Error('Generated frontmatter exceeds the 8 KiB limit');
  }

  return frontmatter;
}

function encodeDisplayLine(value: string): string {
  let encoded = '';
  let leadingWhitespace = true;
  const characters = Array.from(value);
  let lastNonSpace = -1;
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    if (characters[index] !== ' ') {
      lastNonSpace = index;
      break;
    }
  }

  for (const [index, character] of characters.entries()) {
    const codePoint = character.codePointAt(0) as number;
    if (character === ' ' && (leadingWhitespace || index > lastNonSpace)) {
      encoded += '&#32;';
      continue;
    }
    leadingWhitespace = false;
    encoded += DISPLAY_SYNTAX_CODE_POINTS.has(codePoint) ? `&#${codePoint};` : character;
  }

  return encoded;
}

/**
 * Encode dynamic display text without changing the characters a Markdown
 * reader shows. Decimal character references are resolved after block parsing,
 * so hostile text remains readable without becoming Markdown or HTML syntax.
 */
export function neutralizeSocialBodyText(value: string): string {
  return normalizeUntrustedText(value).split('\n').map(encodeDisplayLine).join('\n');
}

function renderInlineDisplayText(value: string): string {
  return neutralizeSocialBodyText(value.replace(/\r\n?/g, '\n').replace(/\n+/g, ' '));
}

function renderBlockDisplayText(value: string): string {
  return neutralizeSocialBodyText(value)
    .split('\n')
    .map((line) => (line === '' ? '&#10;' : line))
    .join('\\\n');
}

function percentEncodeUtf8(value: string): string {
  return Array.from(
    new TextEncoder().encode(value),
    (byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`,
  ).join('');
}

function encodeMarkdownLinkDestination(value: string): string {
  let encoded = '';

  for (let index = 0; index < value.length; ) {
    const character = String.fromCodePoint(value.codePointAt(index) as number);
    index += character.length;

    if (
      character === '%' &&
      index + 1 < value.length &&
      /^[0-9A-Fa-f]{2}$/u.test(value.slice(index, index + 2))
    ) {
      encoded += `%${value.slice(index, index + 2)}`;
      index += 2;
      continue;
    }

    encoded += RAW_URL_DESTINATION_CHARACTER.test(character)
      ? character
      : percentEncodeUtf8(character);
  }

  return encoded;
}

function renderSafeHttpsLink(label: string, value: string): string {
  const validated = HttpsUrlSchema.parse(value);
  const parsed = new URL(validated);
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.hostname === ''
  ) {
    throw new Error('Expected a safe HTTPS link destination');
  }

  return `[${label}](${encodeMarkdownLinkDestination(parsed.href)})`;
}

export function renderSafeSocialMarkdown(item: SocialItem): string {
  const parsedItem = parseSocialItem(item);
  const properties = propertiesFromItem(parsedItem);
  const fallbackTitle = parsedItem.source === 'x' ? 'Saved X item' : 'Saved Weibo item';
  const title = parsedItem.title
    ? renderInlineDisplayText(parsedItem.title)
    : renderInlineDisplayText(fallbackTitle);
  const authorParts = [parsedItem.author?.displayName, parsedItem.author?.handle].filter(
    (value): value is string => Boolean(value),
  );
  const author =
    authorParts.length > 0 ? authorParts.map(renderInlineDisplayText).join(' · ') : 'Not available';
  const publishedAt = parsedItem.publishedAt
    ? renderInlineDisplayText(parsedItem.publishedAt)
    : 'Not available';
  const content = parsedItem.text ? renderBlockDisplayText(parsedItem.text) : 'No captured text.';
  const parts = [
    `# ${title}`,
    '',
    `- Author: ${author}`,
    `- Published: ${publishedAt}`,
    `- Captured: ${renderInlineDisplayText(parsedItem.capturedAt)}`,
    `- Completeness: ${renderInlineDisplayText(parsedItem.completeness)}`,
    `- Source: ${renderSafeHttpsLink('Open original', parsedItem.canonicalUrl)}`,
    '',
    '## Content',
    '',
    content,
    '',
  ];

  if (parsedItem.media.length > 0) {
    const mediaLines = parsedItem.media.map((media, index) => {
      const label = `Open ${media.type} ${index + 1}`;
      const alt = media.alt ? ` — ${renderInlineDisplayText(media.alt)}` : '';
      return `- ${renderSafeHttpsLink(label, media.url)}${alt}`;
    });
    parts.push('## Remote media', '', ...mediaLines, '');
  }

  return `${serializeProperties(properties)}\n${parts.join('\n')}`;
}

function parseJsonString(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function parsePositiveInteger(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= 1_000_000 ? parsed : null;
}

function validateParsedProperties(values: ReadonlyMap<string, string>): SafeMarkdownParseResult {
  for (const key of SAFE_SOCIAL_PROPERTY_KEYS) {
    if (!values.has(key)) {
      return parseError('missing_property', `Missing required property: ${key}`);
    }
  }

  const schemaVersion = parsePositiveInteger(values.get('shuhai_schema') as string);
  const extractorVersion = parsePositiveInteger(values.get('extractor_version') as string);
  const source = parseJsonString(values.get('source') as string);
  const sourceItemId = parseJsonString(values.get('source_item_id') as string);
  const canonicalUrl = parseJsonString(values.get('canonical_url') as string);
  const capturedAt = parseJsonString(values.get('captured_at') as string);
  const completeness = parseJsonString(values.get('capture_completeness') as string);
  const contentHash = parseJsonString(values.get('content_hash') as string);

  if (
    schemaVersion !== 1 ||
    extractorVersion === null ||
    source === null ||
    sourceItemId === null ||
    canonicalUrl === null ||
    capturedAt === null ||
    completeness === null ||
    contentHash === null
  ) {
    return parseError('invalid_property', 'Frontmatter contains an invalid scalar');
  }

  const parsedSource = SocialSourceSchema.safeParse(source);
  const parsedSourceItemId = SourceItemIdSchema.safeParse(sourceItemId);
  const parsedCanonicalUrl = HttpsUrlSchema.safeParse(canonicalUrl);
  const parsedCapturedAt = IsoTimestampSchema.safeParse(capturedAt);
  const parsedCompleteness = CaptureCompletenessSchema.safeParse(completeness);
  const parsedContentHash = ContentHashSchema.safeParse(contentHash);
  if (
    !parsedSource.success ||
    !parsedSourceItemId.success ||
    !parsedCanonicalUrl.success ||
    !parsedCapturedAt.success ||
    !parsedCompleteness.success ||
    !parsedContentHash.success
  ) {
    return parseError('invalid_property', 'Frontmatter property failed runtime validation');
  }

  let identityItem: SocialItem;
  try {
    identityItem = parseSocialItem({
      schemaVersion: 1,
      source: parsedSource.data,
      sourceItemId: parsedSourceItemId.data,
      canonicalUrl: parsedCanonicalUrl.data,
      capturedAt: parsedCapturedAt.data,
      completeness: parsedCompleteness.data,
      media: [],
      contentHash: parsedContentHash.data,
      extractorVersion,
    });
  } catch {
    return parseError(
      'invalid_property',
      'Frontmatter source, item ID, and canonical URL do not identify the same item',
    );
  }

  return {
    ok: true,
    properties: {
      schemaVersion: 1,
      source: identityItem.source,
      sourceItemId: identityItem.sourceItemId,
      canonicalUrl: identityItem.canonicalUrl,
      capturedAt: identityItem.capturedAt,
      completeness: identityItem.completeness,
      contentHash: identityItem.contentHash,
      extractorVersion: identityItem.extractorVersion,
    },
    frontmatterBytes: 0,
  };
}

export function parseSafeSocialProperties(input: string): SafeMarkdownParseResult {
  if (!(input.startsWith('---\n') || input.startsWith('---\r\n'))) {
    return parseError('missing_frontmatter', 'File does not start with frontmatter');
  }

  const firstLineEnd = input.indexOf('\n');
  let cursor = firstLineEnd + 1;
  const values = new Map<string, string>();

  while (cursor <= input.length) {
    const nextLineEnd = input.indexOf('\n', cursor);
    const lineEnd = nextLineEnd === -1 ? input.length : nextLineEnd;
    const rawLine = input.slice(cursor, lineEnd);
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    if (line === '---') {
      const frontmatterEnd = lineEnd;
      const frontmatterBytes = utf8Bytes(input.slice(0, frontmatterEnd));
      if (frontmatterBytes > MAX_FRONTMATTER_BYTES) {
        return parseError('frontmatter_too_large', 'Frontmatter exceeds the 8 KiB limit');
      }

      const validated = validateParsedProperties(values);
      return validated.ok ? { ...validated, frontmatterBytes } : validated;
    }

    if (utf8Bytes(input.slice(0, lineEnd)) > MAX_FRONTMATTER_BYTES) {
      return parseError('frontmatter_too_large', 'Frontmatter exceeds the 8 KiB limit');
    }

    const separator = line.indexOf(':');
    if (separator <= 0 || line.slice(0, separator).trim() !== line.slice(0, separator)) {
      return parseError('invalid_property', 'Frontmatter line is not a strict key/value pair');
    }

    const key = line.slice(0, separator);
    const value = line.slice(separator + 1).trimStart();
    if (!PROPERTY_KEY_SET.has(key)) {
      return parseError('unknown_property', `Unknown frontmatter property: ${key}`);
    }
    if (values.has(key)) {
      return parseError('duplicate_property', `Duplicate frontmatter property: ${key}`);
    }
    values.set(key, value);

    if (nextLineEnd === -1) {
      break;
    }
    cursor = nextLineEnd + 1;
  }

  return utf8Bytes(input) > MAX_FRONTMATTER_BYTES
    ? parseError('frontmatter_too_large', 'Frontmatter exceeds the 8 KiB limit')
    : parseError('unterminated_frontmatter', 'Frontmatter closing delimiter is missing');
}

export const generateSafeSocialMarkdown = renderSafeSocialMarkdown;
export const parseSyncFrontmatter = parseSafeSocialProperties;
export const parseSafeMarkdownFrontmatter = parseSafeSocialProperties;
