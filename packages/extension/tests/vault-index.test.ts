import { describe, expect, it } from 'vitest';
import { renderSafeSocialMarkdown } from '../src/vault/safe-markdown.js';
import {
  MAX_VAULT_INDEX_MARKDOWN_FILES,
  buildSafeVaultPath,
  rebuildVaultIndex,
  reconcileVaultIndex,
} from '../src/vault/vault-index.js';

type SocialItemInput = Parameters<typeof renderSafeSocialMarkdown>[0];
type IndexedRecord = Awaited<ReturnType<typeof rebuildVaultIndex>>['records'][number];

function socialItem(id: string, overrides: Partial<SocialItemInput> = {}): SocialItemInput {
  return {
    schemaVersion: 1,
    source: 'x',
    sourceItemId: id,
    canonicalUrl: `https://x.com/example/status/${id}`,
    capturedAt: '2026-07-13T12:00:00Z',
    completeness: 'complete',
    media: [],
    contentHash: Number(id.replace(/\D/g, '') || '0')
      .toString(16)
      .padStart(64, '0')
      .slice(-64),
    extractorVersion: 1,
    ...overrides,
  };
}

function markdownFixture(id: string): string {
  return renderSafeSocialMarkdown(socialItem(id));
}

function compactMarkdownFixture(id: number): string {
  const sourceItemId = String(id);
  return [
    '---',
    'shuhai_schema: 1',
    'source: "x"',
    `source_item_id: "${sourceItemId}"`,
    `canonical_url: "https://x.com/example/status/${sourceItemId}"`,
    'captured_at: "2026-07-13T12:00:00Z"',
    'capture_completeness: "complete"',
    `content_hash: "${id.toString(16).padStart(64, '0')}"`,
    'extractor_version: 1',
    '---',
    '',
  ].join('\n');
}

class FakeFileHandle {
  readonly kind = 'file' as const;
  readonly sliceEnds: Array<number | undefined> = [];

  constructor(
    readonly name: string,
    private readonly content: string,
    private readonly readError?: Error,
  ) {}

  async getFile(): Promise<File> {
    if (this.readError) {
      throw this.readError;
    }

    const blob = new Blob([this.content]);
    return {
      size: blob.size,
      slice: (start?: number, end?: number) => {
        this.sliceEnds.push(end);
        return blob.slice(start, end);
      },
    } as File;
  }
}

class FakeDirectoryHandle {
  readonly kind = 'directory' as const;
  readonly children = new Map<string, FakeDirectoryHandle | FakeFileHandle>();

  constructor(readonly name: string) {}

  addDirectory(name: string): FakeDirectoryHandle {
    const directory = new FakeDirectoryHandle(name);
    this.children.set(name, directory);
    return directory;
  }

  addFile(name: string, content: string, readError?: Error): FakeFileHandle {
    const file = new FakeFileHandle(name, content, readError);
    this.children.set(name, file);
    return file;
  }

  async *entries(): AsyncIterableIterator<[string, FakeDirectoryHandle | FakeFileHandle]> {
    for (const entry of this.children) {
      yield entry;
    }
  }
}

function asDirectoryHandle(directory: FakeDirectoryHandle): FileSystemDirectoryHandle {
  return directory as unknown as FileSystemDirectoryHandle;
}

describe('Vault index', () => {
  it('builds deterministic strict paths from a SocialItem', () => {
    expect(buildSafeVaultPath(socialItem('123'), 'ShuHai/Social')).toEqual([
      'ShuHai',
      'Social',
      'x',
      '123.md',
    ]);
    expect(buildSafeVaultPath(socialItem('123'), 'ShuHai/Social', 'intent-abc_123')).toEqual([
      'ShuHai',
      'Social',
      'x',
      '123-intent-abc_123.md',
    ]);
    expect(() => buildSafeVaultPath(socialItem('123'), 'ShuHai/Social', 'intent:unsafe')).toThrow();

    expect(() => buildSafeVaultPath(socialItem('123'), '../ShuHai')).toThrow(
      'Unsafe Vault path segment',
    );
    expect(() => buildSafeVaultPath(socialItem('123'), ['CON'])).toThrow(
      'Unsafe Vault path segment',
    );
    expect(() => buildSafeVaultPath(socialItem('123'), ['ShuHai.'])).toThrow(
      'Unsafe Vault path segment',
    );
    expect(() => buildSafeVaultPath(socialItem('123'), ['ShuHai', 'e\u0301'])).toThrow(
      'Unsafe Vault path segment',
    );
  });

  it('scans only the supplied managed subtree and rebuilds records from properties', async () => {
    const vault = new FakeDirectoryHandle('PrivateVault');
    const managed = vault.addDirectory('ShuHai');
    managed.addFile('root.md', markdownFixture('1'));
    const source = managed.addDirectory('x');
    source.addFile('two.md', markdownFixture('2'));
    vault.addDirectory('Unmanaged').addFile('private.md', markdownFixture('999'));

    const result = await rebuildVaultIndex({
      handle: asDirectoryHandle(managed),
      relativePathPrefix: ['ShuHai'],
    });

    expect(result.partial).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.scannedMarkdownFiles).toBe(2);
    expect(result.records).toEqual([
      expect.objectContaining({
        key: 'x:1',
        sourceItemId: '1',
        relativePath: 'ShuHai/root.md',
      }),
      expect.objectContaining({
        key: 'x:2',
        sourceItemId: '2',
        relativePath: 'ShuHai/x/two.md',
      }),
    ]);
    expect(result.records.some((record) => record.sourceItemId === '999')).toBe(false);

    await expect(
      rebuildVaultIndex(asDirectoryHandle(managed), {
        relativePathPrefix: ['DifferentName'],
      }),
    ).rejects.toThrow('exact handle name');
  });

  it('reads at most the frontmatter probe and leaves a large body lazy', async () => {
    const managed = new FakeDirectoryHandle('ShuHai');
    const file = managed.addFile(
      'large-body.md',
      `${markdownFixture('10')}${'private body '.repeat(100_000)}`,
    );

    const result = await rebuildVaultIndex(asDirectoryHandle(managed));

    expect(result.records).toHaveLength(1);
    expect(file.sliceEnds).toEqual([8 * 1024 + 1]);
  });

  it('fails closed on duplicate properties, duplicate identities, and mismatched canonical URLs', async () => {
    const managed = new FakeDirectoryHandle('ShuHai');
    managed.addFile('first.md', markdownFixture('20'));
    managed.addFile('duplicate-id.md', markdownFixture('20'));
    managed.addFile(
      'duplicate-url.md',
      markdownFixture('21').replace(
        'https://x.com/example/status/21',
        'https://x.com/example/status/20',
      ),
    );
    managed.addFile(
      'duplicate-property.md',
      markdownFixture('22').replace('source: "x"', 'source: "x"\nsource: "weibo"'),
    );

    const result = await rebuildVaultIndex(asDirectoryHandle(managed));

    expect(result.records).toHaveLength(1);
    expect(result.partial).toBe(true);
    expect(result.errors.map((error) => error.code).sort()).toEqual([
      'duplicate_record',
      'invalid_frontmatter',
      'invalid_frontmatter',
    ]);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ parserCode: 'duplicate_property' })]),
    );
  });

  it('rejects Windows device names, trailing dots, normalization drift, and collisions', async () => {
    const managed = new FakeDirectoryHandle('ShuHai');
    managed.addFile('CON.md', markdownFixture('30'));
    managed.addFile('trailing. ', markdownFixture('31'));
    managed.addFile('control\u0085.md', markdownFixture('36'));
    managed.addFile('e\u0301.md', markdownFixture('32'));
    managed.addFile('\u00e9.md', markdownFixture('33'));
    managed.addFile('Case.md', markdownFixture('34'));
    managed.addFile('case.MD', markdownFixture('35'));
    managed.addFile('\uFF21.md', markdownFixture('37'));
    managed.addFile('A.md', markdownFixture('38'));

    const result = await rebuildVaultIndex(asDirectoryHandle(managed));

    expect(result.records).toEqual([]);
    expect(result.partial).toBe(true);
    expect(result.errors.map((error) => error.code)).toContain('invalid_path');
    expect(result.errors.filter((error) => error.code === 'path_collision')).toHaveLength(3);
  });

  it('stops below directories deeper than four and reports partial', async () => {
    const managed = new FakeDirectoryHandle('ShuHai');
    let current = managed;
    for (let depth = 1; depth <= 4; depth += 1) {
      current = current.addDirectory(`d${depth}`);
    }
    current.addFile('allowed.md', markdownFixture('40'));
    current.addDirectory('d5').addFile('blocked.md', markdownFixture('41'));

    const result = await rebuildVaultIndex(asDirectoryHandle(managed));

    expect(result.records).toEqual([
      expect.objectContaining({
        sourceItemId: '40',
        relativePath: 'ShuHai/d1/d2/d3/d4/allowed.md',
      }),
    ]);
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'depth_limit', relativePath: 'ShuHai/d1/d2/d3/d4/d5' }),
    ]);
    expect(result.partial).toBe(true);
  });

  it('stops at the total managed-subtree entry budget and reports partial', async () => {
    const managed = new FakeDirectoryHandle('ShuHai');
    managed.addFile('first.txt', 'ignored');
    managed.addFile('second.txt', 'ignored');
    managed.addFile('third.txt', 'ignored');

    const result = await rebuildVaultIndex(asDirectoryHandle(managed), { maxEntries: 2 });

    expect(result.records).toEqual([]);
    expect(result.scannedEntries).toBe(2);
    expect(result.scannedMarkdownFiles).toBe(0);
    expect(result.errors).toEqual([expect.objectContaining({ code: 'entry_limit' })]);
    expect(result.partial).toBe(true);
  });

  it('reports read errors without discarding valid records', async () => {
    const managed = new FakeDirectoryHandle('ShuHai');
    managed.addFile('good.md', markdownFixture('50'));
    managed.addFile('denied.md', '', new DOMException('Denied', 'NotAllowedError'));

    const result = await rebuildVaultIndex(asDirectoryHandle(managed));

    expect(result.records).toHaveLength(1);
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'read_failed', relativePath: 'ShuHai/denied.md' }),
    ]);
    expect(result.partial).toBe(true);
    expect(() => reconcileVaultIndex(result.records, result)).toThrow(
      'partial Vault index cannot produce deterministic orphan results',
    );
  });

  it('classifies user renames, content changes, catalog orphans, and file orphans', async () => {
    const managed = new FakeDirectoryHandle('ShuHai');
    managed.addFile('renamed-by-user.md', markdownFixture('60'));
    managed.addFile('file-orphan.md', markdownFixture('61'));
    managed.addFile('changed.md', markdownFixture('62'));
    const rebuilt = await rebuildVaultIndex(asDirectoryHandle(managed));
    const renamedRecord = rebuilt.records.find(
      (record) => record.sourceItemId === '60',
    ) as IndexedRecord;
    const changedRecord = rebuilt.records.find(
      (record) => record.sourceItemId === '62',
    ) as IndexedRecord;
    const oldCatalogRecord: IndexedRecord = {
      ...renamedRecord,
      relativePath: 'ShuHai/old-name.md',
    };
    const catalogOrphan: IndexedRecord = {
      ...renamedRecord,
      key: 'x:999',
      sourceItemId: '999',
      canonicalUrl: 'https://x.com/example/status/999',
      relativePath: 'ShuHai/missing.md',
    };
    const changedCatalogRecord: IndexedRecord = {
      ...changedRecord,
      contentHash: 'f'.repeat(64),
    };

    const result = reconcileVaultIndex(
      [oldCatalogRecord, catalogOrphan, changedCatalogRecord],
      rebuilt,
    );

    expect(result.renamed).toEqual([
      {
        key: 'x:60',
        fromRelativePath: 'ShuHai/old-name.md',
        toRelativePath: 'ShuHai/renamed-by-user.md',
      },
    ]);
    expect(result.catalogOrphans.map((record) => record.sourceItemId)).toEqual(['999']);
    expect(result.fileOrphans.map((record) => record.sourceItemId)).toEqual(['61']);
    expect(result.matched.map((record) => record.sourceItemId)).toEqual(['60']);
    expect(result.changed).toEqual([
      expect.objectContaining({
        key: 'x:62',
        catalogRecord: expect.objectContaining({ contentHash: 'f'.repeat(64) }),
        rebuiltRecord: expect.objectContaining({ contentHash: changedRecord.contentHash }),
      }),
    ]);
  });

  it('caps a rebuild at 10,000 Markdown files within the Goal budget', async () => {
    const managed = new FakeDirectoryHandle('ShuHai');
    let fixtureBytes = 0;
    for (let index = 0; index <= MAX_VAULT_INDEX_MARKDOWN_FILES; index += 1) {
      const markdown = compactMarkdownFixture(index);
      fixtureBytes += new TextEncoder().encode(markdown).byteLength;
      managed.addFile(`${String(index).padStart(5, '0')}.md`, markdown);
    }
    const startedAt = performance.now();

    const result = await rebuildVaultIndex(asDirectoryHandle(managed));
    const elapsed = performance.now() - startedAt;

    expect(fixtureBytes).toBeLessThan(32 * 1024 * 1024);
    expect(elapsed).toBeLessThan(10_000);
    expect(result.records).toHaveLength(MAX_VAULT_INDEX_MARKDOWN_FILES);
    expect(result.scannedMarkdownFiles).toBe(MAX_VAULT_INDEX_MARKDOWN_FILES);
    expect(result.partial).toBe(true);
    expect(result.errors).toEqual([expect.objectContaining({ code: 'file_limit' })]);
  }, 15_000);
});
