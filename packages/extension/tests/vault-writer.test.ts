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
} from '../src/utils/vault-writer.js';
import { getStorageSnapshot } from './setup.js';

class FakeWritable {
  constructor(private readonly onWrite: (content: string) => void) {}

  async write(content: string): Promise<void> {
    this.onWrite(String(content));
  }

  async close(): Promise<void> {}
}

class FakeFileHandle {
  content = '';

  async createWritable(): Promise<FakeWritable> {
    return new FakeWritable((content) => {
      this.content = content;
    });
  }
}

class FakeDirectoryHandle {
  readonly dirs = new Map<string, FakeDirectoryHandle>();
  readonly files = new Map<string, FakeFileHandle>();

  constructor(readonly name: string) {}

  async queryPermission(): Promise<PermissionState> {
    return 'granted';
  }

  async requestPermission(): Promise<PermissionState> {
    return 'granted';
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
      throw new Error('Directory not found');
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
      throw new Error('File not found');
    }

    const next = new FakeFileHandle();
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
          sourceLabel: '书签索引',
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
        sourceLabel: '操作历史',
        bookmarkCount: 1,
      }),
    ]);
  });
});
