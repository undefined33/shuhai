import { homedir, platform } from 'node:os';
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
