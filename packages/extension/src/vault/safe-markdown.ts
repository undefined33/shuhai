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
const UNSAFE_URL_SCHEME =
  /\b(?:java\s*script|vbscript|data|file|obsidian)\s*(?::|&colon;|&#0*58;|&#x0*3a;)/gi;
const EVENT_HANDLER = /\bon([a-z][a-z0-9_-]*)\s*=/gi;

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
  return Array.from(value.normalize('NFC').replace(/\r\n?/g, '\n'))
    .filter(
      (character) => character === '\n' || character === '\t' || !isControlCharacter(character),
    )
    .join('')
    .trim();
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

/**
 * Dynamic content is emitted only inside indented code blocks. The replacements
 * also keep raw-file processors such as Templater and Dataview from recognizing
 * their command syntax before Markdown rendering.
 */
export function neutralizeSocialBodyText(value: string): string {
  return normalizeUntrustedText(value)
    .replace(UNSAFE_URL_SCHEME, '[blocked scheme]')
    .replace(EVENT_HANDLER, 'event-$1=')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{\{/g, '{ {')
    .replace(/\}\}/g, '} }')
    .replace(/!\s*\[\s*\[/g, '! [ [')
    .replace(/\[\s*\[/g, '[ [')
    .replace(/\]\s*\]/g, '] ]')
    .replace(/!\s*\[/g, '! [')
    .replace(/::/g, ': :')
    .replace(/`/g, '\\`')
    .replace(/~{3,}/g, (run) => Array.from(run).join(' '))
    .replace(/^(\s*)(?:---|\.\.\.)(\s*)$/gm, '$1\\---$2');
}

function indentedDataBlock(value: string): string {
  const safe = neutralizeSocialBodyText(value);
  return safe
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

function appendDataSection(parts: string[], heading: string, value: string | undefined): void {
  if (!value) {
    return;
  }

  const normalized = normalizeUntrustedText(value);
  if (!normalized) {
    return;
  }

  parts.push(`## ${heading}`, '', indentedDataBlock(normalized), '');
}

export function renderSafeSocialMarkdown(item: SocialItem): string {
  const parsedItem = parseSocialItem(item);
  const properties = propertiesFromItem(parsedItem);
  const parts = ['# ShuHai social item', ''];

  appendDataSection(parts, 'Title', parsedItem.title);
  appendDataSection(parts, 'Author', parsedItem.author?.displayName);
  appendDataSection(parts, 'Author handle', parsedItem.author?.handle);
  appendDataSection(parts, 'Published at', parsedItem.publishedAt);
  appendDataSection(parts, 'Source URL', parsedItem.canonicalUrl);
  appendDataSection(parts, 'Content', parsedItem.text);

  if (parsedItem.media.length > 0) {
    const mediaLines = parsedItem.media.map((media) => {
      const alt = media.alt ? ` | ${normalizeUntrustedText(media.alt)}` : '';
      return `${media.type}: ${media.url}${alt}`;
    });
    parts.push('## Remote media', '', indentedDataBlock(mediaLines.join('\n')), '');
  }

  return `${serializeProperties(properties)}\n${parts.join('\n').trimEnd()}\n`;
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
