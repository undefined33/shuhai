import { describe, expect, it } from 'vitest';

describe('ensure-sqlite-runtime script helpers', () => {
  it('selects the Node or Electron target version for prebuild-install', async () => {
    const { getTargetVersion } = await import('../scripts/ensure-sqlite-runtime.mjs');

    expect(getTargetVersion('node', { node: '24.14.1' }, '41.6.1')).toBe('24.14.1');
    expect(getTargetVersion('electron', { node: '24.14.1' }, '41.6.1')).toBe('41.6.1');
  });

  it('uses the platform-specific prebuild-install executable', async () => {
    const { getPrebuildInstallBin, getPrebuildInstallCommand } = await import(
      '../scripts/ensure-sqlite-runtime.mjs'
    );

    expect(getPrebuildInstallBin('C:/pkg/better-sqlite3', 'win32')).toMatch(
      /better-sqlite3[\\/]node_modules[\\/]\.bin[\\/]prebuild-install\.CMD$/,
    );
    expect(getPrebuildInstallBin('/pkg/better-sqlite3', 'linux')).toMatch(
      /better-sqlite3[\\/]node_modules[\\/]\.bin[\\/]prebuild-install$/,
    );
    expect(getPrebuildInstallCommand('/pkg/better-sqlite3', 'linux')).toMatchObject({
      args: [],
      shell: false,
    });
    expect(getPrebuildInstallCommand('/pkg/better-sqlite3', 'linux').command).toMatch(
      /better-sqlite3[\\/]node_modules[\\/]\.bin[\\/]prebuild-install$/,
    );
  });
});
