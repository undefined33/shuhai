import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const rendererUrl = 'http://127.0.0.1:5173';
const isWindows = process.platform === 'win32';
const children = new Set();

function spawnCommand(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    shell: isWindows,
    stdio: 'inherit',
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

async function waitForRenderer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(rendererUrl);
      if (response.ok) return;
    } catch {
      await delay(500);
    }
  }
  throw new Error(`Vite dev server did not start at ${rendererUrl}`);
}

function shutdown(exitCode = 0) {
  for (const child of children) {
    child.kill();
  }
  process.exit(exitCode);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const vite = spawnCommand('pnpm', ['exec', 'vite', '--host', '127.0.0.1']);

try {
  await waitForRenderer();
} catch (error) {
  console.error(error);
  shutdown(1);
}

const nodeOptions = [process.env.NODE_OPTIONS, '--import tsx'].filter(Boolean).join(' ');
const electron = spawnCommand('pnpm', ['exec', 'electron', 'src/main/index.ts'], {
  NODE_OPTIONS: nodeOptions,
  SHUHAI_RENDERER_DEV_SERVER_URL: rendererUrl,
});

electron.once('exit', (code) => {
  vite.kill();
  shutdown(code ?? 0);
});
