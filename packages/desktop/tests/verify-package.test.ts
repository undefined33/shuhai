import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findFile, verifyPackageArtifacts } from '../scripts/verify-package.mjs';

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('verify-package script', () => {
  it('finds files recursively', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'shuhai-package-'));
    mkdirSync(join(tempDir, 'a', 'b'), { recursive: true });
    writeFileSync(join(tempDir, 'a', 'b', 'target.exe'), Buffer.alloc(1));

    expect(findFile(tempDir, (file) => file.endsWith('.exe'))).toContain('target.exe');
  });

  it('verifies installer, app.asar, native module, and packaged entries', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'shuhai-package-'));
    const releaseDir = join(tempDir, 'release');
    const distDir = join(tempDir, 'dist');

    mkdirSync(join(releaseDir, 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release'), { recursive: true });
    mkdirSync(join(distDir, 'main'), { recursive: true });
    mkdirSync(join(distDir, 'renderer'), { recursive: true });

    writeFileSync(join(releaseDir, 'ShuHai Setup.exe'), Buffer.alloc(1_000_000));
    writeFileSync(join(releaseDir, 'win-unpacked', 'resources', 'app.asar'), Buffer.alloc(10_000));
    writeFileSync(
      join(releaseDir, 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
      Buffer.alloc(50_000),
    );
    writeFileSync(join(distDir, 'main', 'index.js'), 'main');
    writeFileSync(join(distDir, 'preload.js'), 'preload');
    writeFileSync(join(distDir, 'renderer', 'index.html'), 'renderer');

    expect(verifyPackageArtifacts({
      releaseDir,
      distDir,
      asarEntries: [
        'dist/main/index.js',
        'dist/preload.js',
        'dist/renderer/index.html',
        'node_modules/better-sqlite3/lib/index.js',
        'node_modules/bindings/bindings.js',
        'node_modules/file-uri-to-path/index.js',
        'node_modules/p-limit/index.js',
        'node_modules/yocto-queue/index.js',
      ],
    })).toMatchObject({
      entries: [
        'dist/main/index.js',
        'dist/preload.js',
        'dist/renderer/index.html',
      ],
      runtimeDependencies: [
        'node_modules/better-sqlite3/lib/index.js',
        'node_modules/bindings/bindings.js',
        'node_modules/file-uri-to-path/index.js',
        'node_modules/p-limit/index.js',
        'node_modules/yocto-queue/index.js',
      ],
    });
  });

  it('accepts Windows-style asar entry paths', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'shuhai-package-'));
    const releaseDir = join(tempDir, 'release');
    const distDir = join(tempDir, 'dist');

    mkdirSync(join(releaseDir, 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release'), { recursive: true });
    mkdirSync(join(distDir, 'main'), { recursive: true });
    mkdirSync(join(distDir, 'renderer'), { recursive: true });

    writeFileSync(join(releaseDir, 'ShuHai Setup.exe'), Buffer.alloc(1_000_000));
    writeFileSync(join(releaseDir, 'win-unpacked', 'resources', 'app.asar'), Buffer.alloc(10_000));
    writeFileSync(
      join(releaseDir, 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
      Buffer.alloc(50_000),
    );
    writeFileSync(join(distDir, 'main', 'index.js'), 'main');
    writeFileSync(join(distDir, 'preload.js'), 'preload');
    writeFileSync(join(distDir, 'renderer', 'index.html'), 'renderer');

    expect(verifyPackageArtifacts({
      releaseDir,
      distDir,
      asarEntries: [
        '\\dist\\main\\index.js',
        '\\dist\\preload.js',
        '\\dist\\renderer\\index.html',
        '\\node_modules\\better-sqlite3\\lib\\index.js',
        '\\node_modules\\bindings\\bindings.js',
        '\\node_modules\\file-uri-to-path\\index.js',
        '\\node_modules\\p-limit\\index.js',
        '\\node_modules\\yocto-queue\\index.js',
      ],
    })).toMatchObject({
      entries: [
        'dist/main/index.js',
        'dist/preload.js',
        'dist/renderer/index.html',
      ],
    });
  });
});
