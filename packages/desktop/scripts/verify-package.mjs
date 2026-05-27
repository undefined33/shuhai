import { existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const REQUIRED_ASAR_ENTRIES = [
  'dist/main/index.js',
  'dist/preload/preload.cjs',
  'dist/renderer/index.html',
];

export function verifyPackageArtifacts({
  releaseDir,
  distDir = resolve('dist'),
  asarEntries,
} = {}) {
  const resolvedReleaseDir = resolve(releaseDir ?? 'release');
  const exePath = findFile(resolvedReleaseDir, (file) => file.endsWith('.exe'));
  assertSizedFile(exePath, 1_000_000, 'Windows installer');

  const appAsarPath = join(resolvedReleaseDir, 'win-unpacked', 'resources', 'app.asar');
  assertSizedFile(appAsarPath, 10_000, 'app.asar');

  const unpackedDir = join(resolvedReleaseDir, 'win-unpacked', 'resources', 'app.asar.unpacked');
  const nativeModulePath = findFile(unpackedDir, (file) => file.endsWith('better_sqlite3.node'));
  assertSizedFile(nativeModulePath, 50_000, 'better-sqlite3 native module');

  const entries = asarEntries ?? listAsarEntries(appAsarPath);
  for (const entry of REQUIRED_ASAR_ENTRIES) {
    if (!entries.includes(entry)) {
      throw new Error(`Package app.asar is missing ${entry}`);
    }
  }

  for (const entry of REQUIRED_ASAR_ENTRIES) {
    assertSizedFile(join(distDir, entry.replace('dist/', '')), 1, `local ${entry}`);
  }

  return {
    installer: exePath,
    appAsar: appAsarPath,
    nativeModule: nativeModulePath,
    entries: REQUIRED_ASAR_ENTRIES,
  };
}

export function findFile(root, predicate) {
  if (!existsSync(root)) {
    throw new Error(`Missing directory: ${root}`);
  }

  const entries = readdirSync(root, { withFileTypes: true })
    .map((entry) => join(root, entry.name));

  for (const entry of entries) {
    const stats = statSync(entry);
    if (stats.isDirectory()) {
      try {
        return findFile(entry, predicate);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith('No matching file')) {
          throw error;
        }
      }
    } else if (predicate(entry)) {
      return entry;
    }
  }

  throw new Error(`No matching file found under ${root}`);
}

function assertSizedFile(filePath, minBytes, label) {
  if (!existsSync(filePath)) {
    throw new Error(`${label} is missing: ${filePath}`);
  }

  const { size } = statSync(filePath);
  if (size < minBytes) {
    throw new Error(`${label} is too small: ${filePath} (${size} bytes)`);
  }
}

function listAsarEntries(appAsarPath) {
  const asar = loadAsarModule();
  if (!asar) {
    throw new Error('Cannot locate @electron/asar to inspect app.asar');
  }

  return asar.listPackage(appAsarPath).map((entry) => entry.replace(/^\/+/, ''));
}

function loadAsarModule() {
  try {
    return require('@electron/asar');
  } catch {
    // electron-builder depends on @electron/asar, but pnpm keeps it nested.
  }

  let current = resolve('.');
  while (true) {
    const pnpmDir = join(current, 'node_modules', '.pnpm');
    if (existsSync(pnpmDir)) {
      const candidates = readdirSync(pnpmDir)
        .filter((entry) => entry.startsWith('@electron+asar@'))
        .sort()
        .reverse();

      for (const candidate of candidates) {
        const candidatePath = join(
          pnpmDir,
          candidate,
          'node_modules',
          '@electron',
          'asar',
        );
        if (existsSync(candidatePath)) {
          return require(candidatePath);
        }
      }
    }

    const parent = resolve(current, '..');
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = verifyPackageArtifacts({
      releaseDir: process.argv[2] ?? 'release',
      distDir: resolve('dist'),
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
