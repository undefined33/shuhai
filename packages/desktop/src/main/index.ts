import { getChromeBookmarksPath } from '@shuhai/shared';

/**
 * ShuHai Desktop - Main Process Entry
 * Minimal bootstrap for engineering closure verification.
 */
async function main() {
  const bookmarksPath = getChromeBookmarksPath();
  console.log(`[ShuHai] Chrome bookmarks path: ${bookmarksPath}`);
  console.log('[ShuHai] Desktop app initialized (dev mode)');
}

main().catch(console.error);
