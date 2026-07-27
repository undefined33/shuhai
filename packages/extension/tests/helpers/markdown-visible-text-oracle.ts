export interface VisibleMediaLink {
  label: string;
  target: string;
  alt?: string;
}

export interface VisibleSocialMarkdown {
  title: string;
  author: string;
  published: string;
  captured: string;
  completeness: string;
  sourceLabel: string;
  sourceTarget: string;
  content: string;
  media: VisibleMediaLink[];
}

const DECIMAL_CHARACTER_REFERENCE = /&#([0-9]{1,7});/gu;

function decodeDisplayText(value: string): string {
  if (/&(?!#[0-9]{1,7};)/u.test(value)) {
    throw new Error('Unexpected entity in display text');
  }

  return value.replace(DECIMAL_CHARACTER_REFERENCE, (_match, decimal: string) => {
    const codePoint = Number(decimal);
    if (
      !Number.isInteger(codePoint) ||
      codePoint < 0 ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      throw new Error('Invalid decimal character reference');
    }
    return String.fromCodePoint(codePoint);
  });
}

function takePrefixedLine(lines: string[], prefix: string): string {
  const line = lines.shift();
  if (!line?.startsWith(prefix)) {
    throw new Error(`Expected line prefix: ${prefix}`);
  }
  return line.slice(prefix.length);
}

function takeBlankLine(lines: string[]): void {
  if (lines.shift() !== '') {
    throw new Error('Expected a blank line');
  }
}

function parseLink(value: string, expectedLabel?: string): { label: string; target: string } {
  const match = /^\[([A-Za-z0-9 ]+)\]\(([^()\s]+)\)$/u.exec(value);
  if (!match) {
    throw new Error('Expected a fixed Markdown link');
  }
  const [, label, target] = match;
  if (expectedLabel !== undefined && label !== expectedLabel) {
    throw new Error(`Expected link label: ${expectedLabel}`);
  }
  const parsed = new URL(target);
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.hostname === ''
  ) {
    throw new Error('Expected a credential-free HTTPS link');
  }
  return { label, target };
}

export function parseVisibleSocialMarkdown(markdown: string): VisibleSocialMarkdown {
  if (!markdown.startsWith('---\n')) {
    throw new Error('Expected frontmatter');
  }
  const frontmatterEnd = markdown.indexOf('\n---\n', 4);
  if (frontmatterEnd === -1) {
    throw new Error('Expected terminated frontmatter');
  }

  const body = markdown.slice(frontmatterEnd + 5);
  if (!body.endsWith('\n')) {
    throw new Error('Expected a final renderer newline');
  }
  const lines = body.slice(0, -1).split('\n');
  takeBlankLine(lines);
  const title = decodeDisplayText(takePrefixedLine(lines, '# '));
  takeBlankLine(lines);
  const author = decodeDisplayText(takePrefixedLine(lines, '- Author: '));
  const published = decodeDisplayText(takePrefixedLine(lines, '- Published: '));
  const captured = decodeDisplayText(takePrefixedLine(lines, '- Captured: '));
  const completeness = decodeDisplayText(takePrefixedLine(lines, '- Completeness: '));
  const source = parseLink(takePrefixedLine(lines, '- Source: '), 'Open original');
  takeBlankLine(lines);
  if (lines.shift() !== '## Content') {
    throw new Error('Expected Content section');
  }
  takeBlankLine(lines);

  const contentLines: string[] = [];
  while (lines.length > 0 && !(lines[0] === '' && lines[1] === '## Remote media')) {
    const line = lines.shift() as string;
    const displayLine = line.endsWith('\\') ? line.slice(0, -1) : line;
    contentLines.push(displayLine === '&#10;' ? '' : displayLine);
  }
  const content = decodeDisplayText(contentLines.join('\n'));

  const media: VisibleMediaLink[] = [];
  if (lines.length > 0) {
    takeBlankLine(lines);
    if (lines.shift() !== '## Remote media') {
      throw new Error('Expected Remote media section');
    }
    takeBlankLine(lines);

    for (const line of lines) {
      const match = /^- (\[Open (?:image|video|link) [1-9][0-9]*\]\([^()\s]+\))(?: — (.*))?$/u.exec(
        line,
      );
      if (!match) {
        throw new Error('Expected a fixed remote media link');
      }
      const link = parseLink(match[1]);
      media.push({
        ...link,
        ...(match[2] === undefined ? {} : { alt: decodeDisplayText(match[2]) }),
      });
    }
  }

  return {
    title,
    author,
    published,
    captured,
    completeness,
    sourceLabel: source.label,
    sourceTarget: source.target,
    content,
    media,
  };
}

export function formatVisibleSocialMarkdown(value: VisibleSocialMarkdown): string {
  const lines = [
    `Title: ${value.title}`,
    `Author: ${value.author}`,
    `Published: ${value.published}`,
    `Captured: ${value.captured}`,
    `Completeness: ${value.completeness}`,
    `Source: ${value.sourceLabel} -> ${value.sourceTarget}`,
    'Content:',
    value.content,
  ];

  if (value.media.length > 0) {
    lines.push(
      'Remote media:',
      ...value.media.map(
        (media) =>
          `${media.label} -> ${media.target}${media.alt === undefined ? '' : ` | ${media.alt}`}`,
      ),
    );
  }

  return `${lines.join('\n')}\n`;
}
