import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';

const extensionRoot = resolve(import.meta.dirname, '..');
const distRoot = resolve(extensionRoot, 'dist');
const require = createRequire(import.meta.url);
const viteCli = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
let buildStartedAt = 0;

function staticImports(filePath: string): string[] {
  const source = readFileSync(filePath, 'utf8');
  const imports = new Set<string>();
  for (const match of source.matchAll(
    /(?:^|;)\s*import(?:[^"'();]*?\bfrom\s*)?["']([^"']+)["']/gu,
  )) {
    const specifier = match[1];
    if (specifier?.startsWith('.')) {
      imports.add(resolve(dirname(filePath), specifier));
    }
  }
  return [...imports];
}

function collectInitialJavaScript(entryPath: string): string[] {
  const pending = [entryPath];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const dependency of staticImports(current)) {
      if (extname(dependency) === '.js') {
        pending.push(dependency);
      }
    }
  }
  return [...visited];
}

beforeAll(async () => {
  buildStartedAt = Date.now();
  execFileSync(process.execPath, [viteCli, 'build'], {
    cwd: extensionRoot,
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: 'pipe',
    timeout: 30_000,
  });
}, 30_000);

describe('fresh surface production build', () => {
  it('uses the build created by this test process', () => {
    const popup = resolve(distRoot, 'popup.js');
    expect(existsSync(popup)).toBe(true);
    expect(statSync(popup).mtimeMs).toBeGreaterThanOrEqual(buildStartedAt - 1_000);
  });

  it('keeps the Popup initial graph bounded and free of task workspaces', () => {
    const initialFiles = collectInitialJavaScript(resolve(distRoot, 'popup.js'));
    const names = initialFiles.map((file) => file.replaceAll('\\', '/'));
    const source = initialFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
    const gzipBytes = initialFiles.reduce(
      (total, file) => total + gzipSync(readFileSync(file)).byteLength,
      0,
    );

    const gzipEvidence = initialFiles.map((file) => ({
      file: file.replaceAll('\\', '/').split('/dist/').at(-1),
      gzipBytes: gzipSync(readFileSync(file)).byteLength,
    }));
    expect(gzipBytes, JSON.stringify(gzipEvidence)).toBeLessThan(130 * 1_024);
    expect(names.some((name) => name.endsWith('/App.js'))).toBe(false);
    expect(names.some((name) => name.endsWith('/XSyncPage.js'))).toBe(false);
    expect(source).not.toMatch(/\bstate:get\b/u);
    expect(source).not.toMatch(/\bopenSyncStore\b|\bgetVaultHandle\b|\bclassifyBookmarks\b/u);
  });

  it('emits independent surface entries and no UI chunk above 500 kB', () => {
    expect(existsSync(resolve(distRoot, 'popup.js'))).toBe(true);
    expect(existsSync(resolve(distRoot, 'sidepanel.js'))).toBe(true);

    const uiJavaScript = [
      resolve(distRoot, 'popup.js'),
      resolve(distRoot, 'sidepanel.js'),
      ...readdirSync(resolve(distRoot, 'assets'))
        .filter((name) => name.endsWith('.js'))
        .map((name) => resolve(distRoot, 'assets', name)),
    ];
    expect(Math.max(...uiJavaScript.map((file) => statSync(file).size))).toBeLessThan(500 * 1_024);
  });
});
