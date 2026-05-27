import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const VALID_RUNTIMES = new Set(['node', 'electron']);

export function getTargetVersion(runtime, versions, electronVersion) {
  return runtime === 'electron' ? electronVersion : versions.node;
}

export function getPrebuildInstallBin(sqlitePackageDir, platform = process.platform) {
  const executable = platform === 'win32' ? 'prebuild-install.CMD' : 'prebuild-install';
  return join(sqlitePackageDir, 'node_modules', '.bin', executable);
}

export function getPrebuildInstallCommand(sqlitePackageDir, platform = process.platform) {
  const pnpmScript = resolve(
    sqlitePackageDir,
    'node_modules',
    '.bin',
    '..',
    '..',
    '..',
    'prebuild-install',
    'bin.js',
  );

  if (existsSync(pnpmScript)) {
    return {
      command: process.execPath,
      args: [pnpmScript],
      shell: false,
    };
  }

  return {
    command: getPrebuildInstallBin(sqlitePackageDir, platform),
    args: [],
    shell: platform === 'win32',
  };
}

async function run() {
  const runtime = process.argv[2];
  if (!VALID_RUNTIMES.has(runtime)) {
    throw new Error('Usage: node scripts/ensure-sqlite-runtime.mjs <node|electron>');
  }

  const sqlitePackageDir = dirname(require.resolve('better-sqlite3/package.json'));
  const electronVersion = require('electron/package.json').version;
  const target = getTargetVersion(runtime, process.versions, electronVersion);
  const prebuildInstall = getPrebuildInstallCommand(sqlitePackageDir);

  await spawnPrebuildInstall(prebuildInstall, sqlitePackageDir, runtime, target);
}

function spawnPrebuildInstall(prebuildInstall, cwd, runtime, target) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(prebuildInstall.command, [
      ...prebuildInstall.args,
      '--runtime',
      runtime,
      '--target',
      target,
    ], {
      cwd,
      env: process.env,
      shell: prebuildInstall.shell,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`prebuild-install failed for ${runtime}@${target} with exit ${code}`));
    });
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
