'use strict';

const fs = require('node:fs');
const net = require('node:net');
const dgram = require('node:dgram');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TEST_ROOT = path.join(REPO_ROOT, '.tmp', 'host-stability-narrow-v1', 'test');

function testPath(repoRelative) {
  if (typeof repoRelative !== 'string' || repoRelative.includes('\\') ||
      path.posix.isAbsolute(repoRelative) || path.posix.normalize(repoRelative) !== repoRelative) {
    throw new Error('hostile_marker_path_invalid');
  }
  const absolute = path.resolve(REPO_ROOT, ...repoRelative.split('/'));
  const relative = path.relative(TEST_ROOT, absolute);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)) {
    throw new Error('hostile_marker_path_forbidden');
  }
  return absolute;
}

function hold(milliseconds) {
  setTimeout(() => process.exit(0), milliseconds);
}

async function grandchild(marker, behavior) {
  const tcp = net.createServer();
  const udp = dgram.createSocket('udp4');
  await new Promise((resolve, reject) => {
    tcp.once('error', reject);
    tcp.listen(0, '127.0.0.1', resolve);
  });
  await new Promise((resolve, reject) => {
    udp.once('error', reject);
    udp.bind(0, '127.0.0.1', resolve);
  });
  const payload = {
    pid: process.pid,
    parentPid: process.ppid,
    tcpPort: tcp.address().port,
    udpPort: udp.address().port,
  };
  fs.writeFileSync(testPath(marker), `${JSON.stringify(payload)}\n`, { flag: 'w' });
  if (behavior === 'overflow') process.stdout.write(Buffer.alloc(5000, 0x58));
  hold(5000);
}

async function main() {
  const [mode, first, second] = process.argv.slice(2);
  switch (mode) {
    case 'green':
      process.stdout.write('green\n');
      return;
    case 'stdout-overflow':
      process.stdout.write(Buffer.alloc(4097, 0x41));
      return;
    case 'stderr-overflow':
      process.stderr.write(Buffer.alloc(4097, 0x42));
      return;
    case 'mixed-invalid': {
      const stdout = Buffer.alloc(2048, 0x43);
      const stderr = Buffer.alloc(2048, 0x44);
      stdout[13] = 0xff;
      stdout[1023] = 0xc0;
      stderr[17] = 0xfe;
      stderr[1025] = 0x80;
      process.stdout.write(stdout);
      process.stderr.write(stderr);
      return;
    }
    case 'idle':
      hold(5000);
      return;
    case 'wall': {
      const timer = setInterval(() => process.stdout.write(Buffer.from([0x2e])), 40);
      setTimeout(() => {
        clearInterval(timer);
        process.exit(0);
      }, 5000);
      return;
    }
    case 'tree-parent':
      if (!first || !['silent', 'overflow'].includes(second)) {
        throw new Error('tree_parent_arguments_invalid');
      }
      spawn(process.execPath, [__filename, 'tree-grandchild', first, second], {
        cwd: REPO_ROOT,
        env: process.env,
        shell: false,
        stdio: 'inherit',
        windowsHide: true,
      });
      hold(5000);
      return;
    case 'tree-grandchild':
      await grandchild(first, second);
      return;
    case 'lane-hold': {
      const marker = testPath(first);
      fs.appendFileSync(marker, `${process.pid}\n`);
      const timer = setInterval(() => process.stdout.write('.'), 80);
      setTimeout(() => {
        clearInterval(timer);
        process.exit(0);
      }, 1600);
      return;
    }
    case 'mark-green':
      fs.appendFileSync(testPath(first), `${process.pid}\n`);
      process.stdout.write('nested-green\n');
      return;
    default:
      throw new Error('hostile_mode_unknown');
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error.message || error).slice(0, 120)}\n`);
  process.exitCode = 64;
});
