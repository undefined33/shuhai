import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
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
      if (extname(dependency) === '.js') pending.push(dependency);
    }
  }
  return [...visited];
}

beforeAll(() => {
  buildStartedAt = Date.now();
  execFileSync(process.execPath, [viteCli, 'build'], {
    cwd: extensionRoot,
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: 'pipe',
    timeout: 30_000,
  });
}, 30_000);

describe('independent Options production build', () => {
  it('emits a fresh Options HTML and JavaScript entry', () => {
    const html = resolve(distRoot, 'options', 'index.html');
    const entry = resolve(distRoot, 'options.js');
    expect(existsSync(html)).toBe(true);
    expect(existsSync(entry)).toBe(true);
    expect(statSync(entry).mtimeMs).toBeGreaterThanOrEqual(buildStartedAt - 1_000);
  });

  it('keeps the Options initial graph bounded and free of task workspaces', () => {
    const initialFiles = collectInitialJavaScript(resolve(distRoot, 'options.js'));
    const names = initialFiles.map((file) => file.replaceAll('\\', '/'));
    const source = initialFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
    const gzipBytes = initialFiles.reduce(
      (total, file) => total + gzipSync(readFileSync(file)).byteLength,
      0,
    );

    expect(gzipBytes).toBeLessThan(180 * 1_024);
    expect(names.some((name) => name.endsWith('/App.js'))).toBe(false);
    expect(names.some((name) => name.endsWith('/XSyncPage.js'))).toBe(false);
    expect(names.some((name) => name.endsWith('/BookmarkTree.js'))).toBe(false);
    expect(source).not.toMatch(/\bstate:get\b|\boperations:getRecent\b|\bplan:create\b/u);
    expect(source).not.toMatch(/\bopenSyncStore\b|\bX_BOOKMARKS_ROUTE\b/u);
  });
});
