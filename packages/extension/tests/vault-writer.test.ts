import { describe, expect, it } from 'vitest';
import type { BookmarkItem, CapturedContent } from '../src/shared/bookmark-types.js';
import {
  buildBookmarkExportPath,
  buildCaptureExportPath,
  checkVaultPermission,
  exportActivityLogToVault,
  exportBookmarksToVault,
  exportCaptureToVault,
  previewBookmarkExport,
  readVaultTextFile,
  readVaultTextPrefix,
  MAX_SAFE_VAULT_PREFIX_BYTES,
  MAX_SAFE_VAULT_WRITE_BYTES,
  writeVaultFileSafely,
} from '../src/utils/vault-writer.js';
import { getStorageSnapshot } from './setup.js';

class FakeWritable {
  constructor(private readonly onWrite: (content: string) => void) {}

  async write(content: string): Promise<void> {
    this.onWrite(String(content));
  }

  async close(): Promise<void> {}

  async abort(): Promise<void> {}
}

class FakeFileHandle {
  readonly kind = 'file' as const;
  content = '';
  readonly writableOptions: unknown[] = [];

  constructor(readonly name: string) {}

  async createWritable(options?: unknown): Promise<FakeWritable> {
    this.writableOptions.push(options);
    return new FakeWritable((content) => {
      this.content = content;
    });
  }

  async getFile(): Promise<File> {
    const content = this.content;
    const blob = new Blob([content]);
    return {
      size: blob.size,
      slice: (start?: number, end?: number) => blob.slice(start, end),
      text: async () => content,
    } as File;
  }
}

class FakeDirectoryHandle {
  readonly kind = 'directory' as const;
  readonly dirs: Map<string, FakeDirectoryHandle>;
  readonly files: Map<string, FakeFileHandle>;
  private readonly identity: object;
  private readonly missingLookupDelayMs: number;

  constructor(
    readonly name: string,
    options: {
      dirs?: Map<string, FakeDirectoryHandle>;
      files?: Map<string, FakeFileHandle>;
      identity?: object;
      missingLookupDelayMs?: number;
    } = {},
  ) {
    this.dirs = options.dirs ?? new Map();
    this.files = options.files ?? new Map();
    this.identity = options.identity ?? {};
    this.missingLookupDelayMs = options.missingLookupDelayMs ?? 0;
  }

  alias(): FakeDirectoryHandle {
    return new FakeDirectoryHandle(this.name, {
      dirs: this.dirs,
      files: this.files,
      identity: this.identity,
      missingLookupDelayMs: this.missingLookupDelayMs,
    });
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return other instanceof FakeDirectoryHandle && other.identity === this.identity;
  }

  async queryPermission(): Promise<PermissionState> {
    return 'granted';
  }

  async requestPermission(): Promise<PermissionState> {
    return 'granted';
  }

  async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
    for (const [name, directory] of this.dirs) {
      yield [name, directory as unknown as FileSystemHandle];
    }
    for (const [name, file] of this.files) {
      yield [name, file as unknown as FileSystemHandle];
    }
  }

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FakeDirectoryHandle> {
    const existing = this.dirs.get(name);
    if (existing) {
      return existing;
    }

    if (!options?.create) {
      throw new DOMException('Directory not found', 'NotFoundError');
    }

    const next = new FakeDirectoryHandle(name);
    this.dirs.set(name, next);
    return next;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    const existing = this.files.get(name);
    if (existing) {
      return existing;
    }

    if (!options?.create) {
      if (this.missingLookupDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.missingLookupDelayMs));
      }
      throw new DOMException('File not found', 'NotFoundError');
    }

    const next = new FakeFileHandle(name);
    this.files.set(name, next);
    return next;
  }
}

const bookmark: BookmarkItem = {
  id: 'b1',
  title: '../CVE: payload',
  url: 'https://example.com/cve',
  parentId: '1',
  parentTitle: 'APT',
  parentPath: 'Bookmarks Bar/APT',
  index: 0,
};

const articleCapture: CapturedContent = {
  id: 'article-1',
  source: 'article',
  title: '深入理解 eBPF',
  url: 'https://example.com/ebpf',
  text: '# eBPF',
  media: [],
  tags: ['article'],
  capturedAt: new Date(0).toISOString(),
};

describe('vault writer', () => {
  it('builds safe bookmark export paths', () => {
    expect(
      buildBookmarkExportPath(bookmark, {
        directoryPrefix: '../Bookmarks',
      }),
    ).toEqual(['Bookmarks', 'APT', 'CVE payload.md']);
  });

  it('previews folder counts', () => {
    const preview = previewBookmarkExport([bookmark], {
      directoryPrefix: 'Bookmarks',
    });

    expect(preview.total).toBe(1);
    expect(preview.folders).toEqual([{ path: 'Bookmarks/APT', count: 1 }]);
  });

  it('writes bookmark markdown, skips existing files, and records a manifest', async () => {
    const root = new FakeDirectoryHandle('Vault') as unknown as FileSystemDirectoryHandle;
    const allowed = await checkVaultPermission(root);
    const first = await exportBookmarksToVault(root, [bookmark], {
      directoryPrefix: 'Bookmarks',
    });
    const second = await exportBookmarksToVault(root, [bookmark], {
      directoryPrefix: 'Bookmarks',
    });
    const snapshot = getStorageSnapshot();

    expect(allowed).toBe(true);
    expect(first.exported).toBe(1);
    expect(second.skipped).toBe(1);
    expect(snapshot.exportManifests).toHaveLength(2);
    expect(snapshot.exportManifests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'bookmark-index',
          sourceLabel: '书签目录',
          fileLabels: ['CVE payload.md'],
          bookmarkCount: 1,
        }),
      ]),
    );
  });

  it('writes captured articles under the article folder', async () => {
    const root = new FakeDirectoryHandle('Vault') as unknown as FileSystemDirectoryHandle;
    const result = await exportCaptureToVault(root, articleCapture, 'Bookmarks');
    const snapshot = getStorageSnapshot();

    expect(buildCaptureExportPath(articleCapture, 'Bookmarks')).toEqual([
      'Bookmarks',
      '文章',
      '深入理解 eBPF.md',
    ]);
    expect(result.exported).toBe(1);
    expect(result.files).toEqual(['Bookmarks/文章/深入理解 eBPF.md']);
    expect(snapshot.exportManifests).toEqual([
      expect.objectContaining({
        type: 'capture',
        sourceLabel: '文章',
        fileLabels: ['深入理解 eBPF.md'],
        bookmarkCount: 1,
      }),
    ]);
  });

  it('records activity log exports with an activity manifest', async () => {
    const root = new FakeDirectoryHandle('Vault') as unknown as FileSystemDirectoryHandle;
    const path = await exportActivityLogToVault(
      root,
      [
        {
          id: 'activity-1',
          type: 'capture_save',
          timestamp: new Date(0).toISOString(),
          summary: '保存了一篇文章',
        },
      ],
      'Bookmarks',
    );
    const snapshot = getStorageSnapshot();

    expect(path).toBe('Bookmarks/_activity/activity-log.md');
    expect(snapshot.exportManifests).toEqual([
      expect.objectContaining({
        type: 'activity',
        sourceLabel: '历史记录',
        fileLabels: ['activity-log.md'],
        bookmarkCount: 1,
      }),
    ]);
  });

  it('creates a file once and never overwrites it on a retry', async () => {
    const fakeRoot = new FakeDirectoryHandle('Vault');
    const root = fakeRoot as unknown as FileSystemDirectoryHandle;
    const path = ['ShuHai', 'x', '123.md'];

    const first = await writeVaultFileSafely(root, path, 'first');
    const second = await writeVaultFileSafely(root, path, 'second');
    const content = await readVaultTextFile(root, path);

    expect(first).toEqual({ status: 'created', relativePath: 'ShuHai/x/123.md' });
    expect(second).toEqual({ status: 'already_exists', relativePath: 'ShuHai/x/123.md' });
    expect(content).toBe('first');
  });

  it('serializes concurrent writes to the same path', async () => {
    const root = new FakeDirectoryHandle('Vault') as unknown as FileSystemDirectoryHandle;
    const path = ['ShuHai', 'x', 'same.md'];

    const outcomes = await Promise.all([
      writeVaultFileSafely(root, path, 'first'),
      writeVaultFileSafely(root, path, 'second'),
    ]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['already_exists', 'created']);
    expect(await readVaultTextFile(root, path)).toBe('first');
  });

  it('serializes concurrent writes through alias handles for the same directory entry', async () => {
    const fakeRoot = new FakeDirectoryHandle('Vault', { missingLookupDelayMs: 10 });
    const firstRoot = fakeRoot as unknown as FileSystemDirectoryHandle;
    const aliasRoot = fakeRoot.alias() as unknown as FileSystemDirectoryHandle;
    const path = ['ShuHai', 'x', 'alias.md'];

    const outcomes = await Promise.all([
      writeVaultFileSafely(firstRoot, path, 'first'),
      writeVaultFileSafely(aliasRoot, path, 'second'),
    ]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['already_exists', 'created']);
    expect(await readVaultTextFile(firstRoot, path)).toBe('first');
  });

  it('rejects a case-insensitive sibling collision before creating another file', async () => {
    const fakeRoot = new FakeDirectoryHandle('Vault');
    const existing = new FakeFileHandle('Post.md');
    existing.content = 'existing';
    fakeRoot.files.set(existing.name, existing);

    const outcome = await writeVaultFileSafely(
      fakeRoot as unknown as FileSystemDirectoryHandle,
      ['post.md'],
      'replacement',
    );

    expect(outcome).toMatchObject({ status: 'error', errorCode: 'path_collision' });
    expect(fakeRoot.files.size).toBe(1);
    expect(fakeRoot.files.get('Post.md')?.content).toBe('existing');
    expect(fakeRoot.files.has('post.md')).toBe(false);
  });

  it('serializes concurrent case variants through alias handles', async () => {
    const fakeRoot = new FakeDirectoryHandle('Vault', { missingLookupDelayMs: 10 });
    const firstRoot = fakeRoot as unknown as FileSystemDirectoryHandle;
    const aliasRoot = fakeRoot.alias() as unknown as FileSystemDirectoryHandle;

    const outcomes = await Promise.all([
      writeVaultFileSafely(firstRoot, ['Post.md'], 'first'),
      writeVaultFileSafely(aliasRoot, ['post.md'], 'second'),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'created')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.errorCode === 'path_collision')).toHaveLength(1);
    expect(fakeRoot.files.size).toBe(1);
  });

  it('serializes writes whose ancestor directories differ only by case', async () => {
    const fakeRoot = new FakeDirectoryHandle('Vault', { missingLookupDelayMs: 10 });
    const firstRoot = fakeRoot as unknown as FileSystemDirectoryHandle;
    const aliasRoot = fakeRoot.alias() as unknown as FileSystemDirectoryHandle;

    const outcomes = await Promise.all([
      writeVaultFileSafely(firstRoot, ['ShuHai', 'x', 'first.md'], 'first'),
      writeVaultFileSafely(aliasRoot, ['shuhai', 'x', 'second.md'], 'second'),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'created')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.errorCode === 'path_collision')).toHaveLength(1);
    expect(fakeRoot.dirs.size).toBe(1);
    expect(['ShuHai', 'shuhai']).toContain([...fakeRoot.dirs.keys()][0]);
  });

  it('rejects NFKC compatibility collisions for files and directories', async () => {
    const fileRoot = new FakeDirectoryHandle('Vault');
    const compatibilityFile = new FakeFileHandle('\uFF21.md');
    fileRoot.files.set(compatibilityFile.name, compatibilityFile);
    const fileOutcome = await writeVaultFileSafely(
      fileRoot as unknown as FileSystemDirectoryHandle,
      ['A.md'],
      'content',
    );

    const directoryRoot = new FakeDirectoryHandle('Vault');
    directoryRoot.dirs.set('\uFF21', new FakeDirectoryHandle('\uFF21'));
    const directoryOutcome = await writeVaultFileSafely(
      directoryRoot as unknown as FileSystemDirectoryHandle,
      ['A', 'note.md'],
      'content',
    );

    expect(fileOutcome).toMatchObject({ status: 'error', errorCode: 'path_collision' });
    expect(directoryOutcome).toMatchObject({ status: 'error', errorCode: 'path_collision' });
    expect(fileRoot.files.has('A.md')).toBe(false);
    expect(directoryRoot.dirs.has('A')).toBe(false);
  });

  it('fails closed when sibling enumeration cannot be completed', async () => {
    class EnumerationFailureDirectoryHandle extends FakeDirectoryHandle {
      override async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
        const name = 'unrelated.md';
        yield [name, new FakeFileHandle(name) as unknown as FileSystemHandle];
        throw new DOMException('Directory disappeared', 'NotFoundError');
      }
    }

    const fakeRoot = new EnumerationFailureDirectoryHandle('Vault');
    const outcome = await writeVaultFileSafely(
      fakeRoot as unknown as FileSystemDirectoryHandle,
      ['blocked.md'],
      'content',
    );

    expect(outcome).toMatchObject({ status: 'error', errorCode: 'write_failed' });
    expect(fakeRoot.files.size).toBe(0);
  });

  it('fails closed when a sibling collision scan exceeds its fixed budget', async () => {
    class OversizedDirectoryHandle extends FakeDirectoryHandle {
      override async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
        for (let index = 0; index <= 20_000; index += 1) {
          const name = `unrelated-${index}.md`;
          yield [name, new FakeFileHandle(name) as unknown as FileSystemHandle];
        }
      }
    }

    const fakeRoot = new OversizedDirectoryHandle('Vault');
    const outcome = await writeVaultFileSafely(
      fakeRoot as unknown as FileSystemDirectoryHandle,
      ['blocked.md'],
      'content',
    );

    expect(outcome).toMatchObject({ status: 'error', errorCode: 'write_failed' });
    expect(outcome.error).toContain('bounded collision scan');
    expect(fakeRoot.files.size).toBe(0);
  });

  it('does not overwrite a file that appears before the exclusive writer is acquired', async () => {
    class RacingDirectoryHandle extends FakeDirectoryHandle {
      private initialLookup = true;

      override async getFileHandle(
        name: string,
        options?: { create?: boolean },
      ): Promise<FakeFileHandle> {
        if (this.initialLookup && !options?.create) {
          this.initialLookup = false;
          throw new DOMException('File not found', 'NotFoundError');
        }
        if (options?.create && !this.files.has(name)) {
          const external = new FakeFileHandle(name);
          external.content = 'external content';
          this.files.set(name, external);
        }
        return super.getFileHandle(name, options);
      }
    }

    const fakeRoot = new RacingDirectoryHandle('Vault');
    const root = fakeRoot as unknown as FileSystemDirectoryHandle;
    const outcome = await writeVaultFileSafely(root, ['raced.md'], 'ShuHai content');

    expect(outcome).toEqual({ status: 'already_exists', relativePath: 'raced.md' });
    expect(fakeRoot.files.get('raced.md')?.content).toBe('external content');
    expect(fakeRoot.files.get('raced.md')?.writableOptions).toEqual([
      { keepExistingData: true, mode: 'exclusive' },
    ]);
  });

  it('makes the zero-byte external creation limitation explicit', async () => {
    class EmptyFileRaceDirectoryHandle extends FakeDirectoryHandle {
      private initialLookup = true;

      override async getFileHandle(
        name: string,
        options?: { create?: boolean },
      ): Promise<FakeFileHandle> {
        if (this.initialLookup && !options?.create) {
          this.initialLookup = false;
          throw new DOMException('File not found', 'NotFoundError');
        }
        if (options?.create && !this.files.has(name)) {
          this.files.set(name, new FakeFileHandle(name));
        }
        return super.getFileHandle(name, options);
      }
    }

    const fakeRoot = new EmptyFileRaceDirectoryHandle('Vault');
    const outcome = await writeVaultFileSafely(
      fakeRoot as unknown as FileSystemDirectoryHandle,
      ['random-intent-name.md'],
      'ShuHai content',
    );

    expect(outcome).toEqual({ status: 'created', relativePath: 'random-intent-name.md' });
    expect(fakeRoot.files.get('random-intent-name.md')?.content).toBe('ShuHai content');
  });

  it('returns an explicit outcome when alias identity comparison fails', async () => {
    let lookupStarted: (() => void) | undefined;
    let releaseLookup: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      lookupStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });

    class IdentityFailureDirectoryHandle extends FakeDirectoryHandle {
      override async isSameEntry(): Promise<boolean> {
        throw new DOMException('Cannot compare handles', 'NotAllowedError');
      }

      override async getFileHandle(
        name: string,
        options?: { create?: boolean },
      ): Promise<FakeFileHandle> {
        if (!options?.create) {
          lookupStarted?.();
          await release;
        }
        return super.getFileHandle(name, options);
      }
    }

    const firstRoot = new IdentityFailureDirectoryHandle('Vault');
    const firstWrite = writeVaultFileSafely(
      firstRoot as unknown as FileSystemDirectoryHandle,
      ['first.md'],
      'first',
    );
    await started;

    const secondOutcome = await writeVaultFileSafely(
      new FakeDirectoryHandle('Other Vault') as unknown as FileSystemDirectoryHandle,
      ['second.md'],
      'second',
    );
    releaseLookup?.();
    const firstOutcome = await firstWrite;

    expect(secondOutcome).toMatchObject({ status: 'error', errorCode: 'permission_denied' });
    expect(firstOutcome.status).toBe('created');
  });

  it.each([
    [['..', 'escape.md']],
    [['ShuHai', 'CON.md']],
    [['ShuHai', 'COM\u00b9.md']],
    [['ShuHai', 'trailing.']],
    [['ShuHai', 'control\u0085.md']],
    [['ShuHai', 'decomposed-e\u0301.md']],
    [['ShuHai', '\uFF21.md']],
    [['ShuHai', `${'界'.repeat(41)}.md`]],
    [['ShuHai', 'nested/escape.md']],
  ])('rejects unsafe path segments: %j', async (path) => {
    const root = new FakeDirectoryHandle('Vault') as unknown as FileSystemDirectoryHandle;
    const outcome = await writeVaultFileSafely(root, path, 'blocked');

    expect(outcome.status).toBe('error');
    expect(outcome.errorCode).toBe('invalid_path');
  });

  it('does not treat permission failures as a missing file', async () => {
    class DeniedDirectoryHandle extends FakeDirectoryHandle {
      override async getFileHandle(): Promise<FakeFileHandle> {
        throw new DOMException('Permission denied', 'NotAllowedError');
      }
    }

    const root = new DeniedDirectoryHandle('Vault') as unknown as FileSystemDirectoryHandle;
    const outcome = await writeVaultFileSafely(root, ['blocked.md'], 'blocked');

    expect(outcome.status).toBe('error');
    expect(outcome.errorCode).toBe('permission_denied');
  });

  it('requests read-write permission when the stored handle is still prompting', async () => {
    let requested = 0;
    class PromptDirectoryHandle extends FakeDirectoryHandle {
      override async queryPermission(): Promise<PermissionState> {
        return 'prompt';
      }

      override async requestPermission(): Promise<PermissionState> {
        requested += 1;
        return 'granted';
      }
    }

    const root = new PromptDirectoryHandle('Vault') as unknown as FileSystemDirectoryHandle;

    await expect(checkVaultPermission(root)).resolves.toBe(true);
    expect(requested).toBe(1);
  });

  it('reports create and write failures without claiming a file was created', async () => {
    class CreateFailureDirectoryHandle extends FakeDirectoryHandle {
      override async getFileHandle(
        name: string,
        options?: { create?: boolean },
      ): Promise<FakeFileHandle> {
        if (options?.create) {
          throw new DOMException('Create failed', 'UnknownError');
        }
        return super.getFileHandle(name, options);
      }
    }
    class WriteFailureDirectoryHandle extends FakeDirectoryHandle {
      private created = false;
      private readonly failedFile = {
        name: 'write-failure.md',
        getFile: async () => ({ size: 0 }) as File,
        createWritable: async () => ({
          write: async () => {
            throw new DOMException('Write failed', 'UnknownError');
          },
          close: async () => undefined,
          abort: async () => undefined,
        }),
      } as unknown as FakeFileHandle;

      override async getFileHandle(
        name: string,
        options?: { create?: boolean },
      ): Promise<FakeFileHandle> {
        if (name !== 'write-failure.md') {
          throw new DOMException('File not found', 'NotFoundError');
        }
        if (!this.created && !options?.create) {
          throw new DOMException('File not found', 'NotFoundError');
        }
        this.created = true;
        return this.failedFile;
      }
    }

    const createFailure = await writeVaultFileSafely(
      new CreateFailureDirectoryHandle('Vault') as unknown as FileSystemDirectoryHandle,
      ['create-failure.md'],
      'content',
    );
    const writeFailure = await writeVaultFileSafely(
      new WriteFailureDirectoryHandle('Vault') as unknown as FileSystemDirectoryHandle,
      ['write-failure.md'],
      'content',
    );

    expect(createFailure).toMatchObject({ status: 'error', errorCode: 'write_failed' });
    expect(writeFailure).toMatchObject({ status: 'error', errorCode: 'write_failed' });
  });

  it('reports a close failure without retrying over the orphaned file', async () => {
    class CloseFailureDirectoryHandle extends FakeDirectoryHandle {
      private created = false;
      private readonly fileHandle = {
        name: 'orphan.md',
        getFile: async () => ({ size: 0 }) as File,
        createWritable: async () => ({
          write: async () => undefined,
          close: async () => {
            throw new DOMException('Vault permission was revoked', 'NotAllowedError');
          },
          abort: async () => undefined,
        }),
      } as unknown as FileSystemFileHandle;

      override async getFileHandle(
        name: string,
        options?: { create?: boolean },
      ): Promise<FakeFileHandle> {
        if (name !== 'orphan.md') {
          throw new DOMException('File not found', 'NotFoundError');
        }
        if (!this.created && !options?.create) {
          throw new DOMException('File not found', 'NotFoundError');
        }
        this.created = true;
        return this.fileHandle as unknown as FakeFileHandle;
      }
    }

    const root = new CloseFailureDirectoryHandle('Vault') as unknown as FileSystemDirectoryHandle;
    const first = await writeVaultFileSafely(root, ['orphan.md'], 'content');
    const retry = await writeVaultFileSafely(root, ['orphan.md'], 'content');

    expect(first.status).toBe('error');
    expect(first.errorCode).toBe('permission_denied');
    expect(retry.status).toBe('already_exists');
  });

  it('rejects content above the fixed write budget before creating a file', async () => {
    const fakeRoot = new FakeDirectoryHandle('Vault');
    const root = fakeRoot as unknown as FileSystemDirectoryHandle;

    const outcome = await writeVaultFileSafely(
      root,
      ['too-large.md'],
      'x'.repeat(MAX_SAFE_VAULT_WRITE_BYTES + 1),
    );

    expect(outcome.status).toBe('error');
    expect(outcome.errorCode).toBe('file_too_large');
    expect(fakeRoot.files.size).toBe(0);
  });

  it('enforces a byte limit when reading an existing file', async () => {
    const root = new FakeDirectoryHandle('Vault') as unknown as FileSystemDirectoryHandle;
    await writeVaultFileSafely(root, ['large.md'], '123456789');

    await expect(readVaultTextFile(root, ['large.md'], 8)).rejects.toThrow(
      'exceeds the read limit',
    );
    expect(await readVaultTextPrefix(root, ['large.md'], 8)).toBe('123456789');
    await expect(
      readVaultTextPrefix(root, ['large.md'], MAX_SAFE_VAULT_PREFIX_BYTES + 1),
    ).rejects.toThrow('Vault prefix read limit');
  });
});
