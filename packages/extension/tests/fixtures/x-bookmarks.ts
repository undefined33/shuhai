import type {
  XBookmarkDomEntryObservation,
  XBookmarksAdapterOptions,
  XBookmarksDomReadPort,
  XBookmarksDomSignal,
} from '../../src/social/adapters/x-bookmarks.js';

export interface XBookmarksFixtureObservation {
  readonly pageUrl: unknown;
  readonly signal: unknown;
  readonly observedNodeCount: unknown;
  readonly entries: readonly unknown[];
}

export function createXBookmarksFixturePort(
  observation: XBookmarksFixtureObservation,
): XBookmarksDomReadPort {
  return {
    readPageUrl: () => observation.pageUrl,
    readSignal: () => observation.signal,
    readObservedNodeCount: () => observation.observedNodeCount,
    readEntryCount: () => observation.entries.length,
    readEntry: (index) => observation.entries[index],
  };
}

export function fixtureSourceItemId(index: number): string {
  return `9${String(index).padStart(17, '0')}`;
}

export function createXBookmarkFixtureEntry(
  index: number,
  overrides: Partial<XBookmarkDomEntryObservation> = {},
): XBookmarkDomEntryObservation {
  const sourceItemId = fixtureSourceItemId(index);
  const account = `fixture_${(index % 9) + 1}`;
  const suffix = index % 2 === 0 ? '?s=20#ignored' : '';
  return {
    permalink: `https://x.com/${account}/status/${sourceItemId}${suffix}`,
    title: `Fixture title ${index}`,
    text: `Fixture body ${index}\r\nsecond line`,
    author: {
      displayName: `Fixture author ${index}`,
      handle: `@${account}`,
    },
    publishedAt: '2026-07-13T08:00:00+08:00',
    contentKind: 'post',
    media:
      index % 5 === 0
        ? [
            {
              type: 'link',
              url: `https://media.invalid/x/${sourceItemId}/z`,
              alt: 'Z media',
            },
            {
              type: 'image',
              url: `https://media.invalid/x/${sourceItemId}/a#tracking`,
              alt: 'A media',
            },
          ]
        : [],
    ...overrides,
  };
}

export function createXBookmarkFixtureEntries(total = 50): XBookmarkDomEntryObservation[] {
  return Array.from({ length: total }, (_, index) => createXBookmarkFixtureEntry(index + 1));
}

export function createXBookmarksFixtureObservation(
  total = 50,
  signal: XBookmarksDomSignal = { kind: 'terminal' },
): XBookmarksFixtureObservation {
  const entries = createXBookmarkFixtureEntries(total);
  return {
    pageUrl: 'https://x.com/i/bookmarks',
    signal,
    observedNodeCount: entries.length * 3,
    entries,
  };
}

export function hostileXBookmarkFixtureEntry(): XBookmarkDomEntryObservation {
  return createXBookmarkFixtureEntry(999, {
    title: '---\r\nsource_item_id: injected',
    text: [
      '{{system: run command}}',
      '```powershell',
      'Remove-Item C:\\\\* -Recurse',
      '```',
      '<iframe src="javascript:alert(1)"></iframe>',
      '```dataviewjs',
      'app.vault.delete("notes")',
      '```',
      '![[dangerous-embed]]',
    ].join('\r\n'),
    media: [
      { type: 'image', url: 'javascript:alert(1)', alt: 'unsafe' },
      { type: 'link', url: 'data:text/html,unsafe', alt: 'unsafe' },
      {
        type: 'image',
        url: 'https://media.invalid/safe-reference.jpg#tracking',
        alt: 'safe reference',
      },
    ],
  });
}

export const FIXTURE_CAPTURE_OPTIONS: Readonly<XBookmarksAdapterOptions> = Object.freeze({
  capturedAt: '2026-07-13T12:00:00.000Z',
  now: () => 1_752_405_600_000,
});
