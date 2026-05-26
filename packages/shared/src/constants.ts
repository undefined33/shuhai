import { platform, homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Default Chrome bookmarks file paths by OS.
 */
export function getChromeBookmarksPath(profile = 'Default'): string {
  const os = platform();
  const home = homedir();

  switch (os) {
    case 'win32':
      return join(
        process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'),
        'Google',
        'Chrome',
        'User Data',
        profile,
        'Bookmarks',
      );
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Google', 'Chrome', profile, 'Bookmarks');
    case 'linux':
      return join(home, '.config', 'google-chrome', profile, 'Bookmarks');
    default:
      throw new Error(`Unsupported platform: ${os}`);
  }
}

/** ShuHai data directory */
export function getDataDir(): string {
  return join(homedir(), '.shuhai');
}

/** Default HTTP port for extension communication (Phase 2) */
export const DEFAULT_PORT = 39281;

/** URL health check concurrency limit */
export const URL_CHECK_CONCURRENCY = 5;

/** Per-domain rate limit interval (ms) */
export const DOMAIN_RATE_LIMIT_MS = 2000;

/** AI batch size for classification */
export const AI_BATCH_SIZE = 50;
