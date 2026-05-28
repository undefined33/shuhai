import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { RawBookmark } from '@shuhai/shared';
import { getChromeBookmarksPath } from '../platform-paths.js';

/**
 * Chrome Bookmarks JSON file structure
 */
interface ChromeBookmarkNode {
  type: 'url' | 'folder';
  name: string;
  url?: string;
  date_added?: string;
  children?: ChromeBookmarkNode[];
}

interface ChromeBookmarksFile {
  roots: {
    bookmark_bar: ChromeBookmarkNode;
    other: ChromeBookmarkNode;
    synced: ChromeBookmarkNode;
  };
}

/**
 * Reads Chrome's local Bookmarks JSON file and converts to RawBookmark[].
 */
export class ChromeFileReader {
  private readonly path: string;

  constructor(profile = 'Default') {
    this.path = getChromeBookmarksPath(profile);
  }

  /** Check if the bookmarks file exists */
  exists(): boolean {
    return existsSync(this.path);
  }

  /** Get the file path being read */
  getPath(): string {
    return this.path;
  }

  /** Read and parse all bookmarks */
  async read(): Promise<RawBookmark[]> {
    const content = await readFile(this.path, 'utf-8');
    const data: ChromeBookmarksFile = JSON.parse(content);
    const bookmarks: RawBookmark[] = [];

    this.traverse(data.roots.bookmark_bar, [], bookmarks);
    this.traverse(data.roots.other, ['Other'], bookmarks);
    this.traverse(data.roots.synced, ['Synced'], bookmarks);

    return bookmarks;
  }

  /**
   * Recursively traverse the bookmark tree.
   * Folders become category path segments.
   */
  private traverse(
    node: ChromeBookmarkNode,
    folderPath: string[],
    result: RawBookmark[],
  ): void {
    if (node.type === 'url' && node.url) {
      // Skip non-http URLs (chrome://, file://, javascript:, etc.)
      if (!node.url.startsWith('http://') && !node.url.startsWith('https://')) {
        return;
      }

      result.push({
        url: node.url,
        title: node.name || new URL(node.url).hostname,
        source: 'chrome',
        contentType: 'article',
        createdAt: this.parseChromeDateAdded(node.date_added),
        categories: folderPath.length > 0 ? [...folderPath] : undefined,
      });
    }

    if (node.children) {
      const nextPath = node.name ? [...folderPath, node.name] : folderPath;
      for (const child of node.children) {
        this.traverse(child, nextPath, result);
      }
    }
  }

  /**
   * Chrome stores dates as microseconds since 1601-01-01.
   * Convert to JavaScript Date.
   */
  private parseChromeDateAdded(dateAdded?: string): Date {
    if (!dateAdded) return new Date();
    // Chrome epoch: microseconds since 1601-01-01
    const chromeEpochMicros = BigInt(dateAdded);
    // Difference between 1601 and 1970 in microseconds
    const epochDiff = BigInt(11644473600000000);
    const unixMicros = chromeEpochMicros - epochDiff;
    const unixMs = Number(unixMicros / BigInt(1000));
    return new Date(unixMs);
  }
}
