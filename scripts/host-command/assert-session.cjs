'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  OPERATION_ID,
  REPO_ROOT,
  SAFE_TOKEN,
  assertNoReparse,
  isContained,
  loadRegistry,
  validateDynamicArgs,
} = require('./shuhai-command.cjs');

function blocked(reason, code = 64) {
  const safe = String(reason).replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 160);
  process.stderr.write(`${JSON.stringify({ status: 'blocked', reason: safe })}\n`);
  process.exitCode = code;
}

function resolvePnpmEntrypoint() {
  const candidates = [];
  if (process.env.npm_execpath) candidates.push(process.env.npm_execpath);
  if (process.env.PNPM_HOME) {
    candidates.push(path.join(process.env.PNPM_HOME, 'pnpm.cjs'));
    candidates.push(path.join(process.env.PNPM_HOME, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'));
  }
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'));
  }
  const nodeHome = path.dirname(process.execPath);
  candidates.push(path.join(nodeHome, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'));
  candidates.push(path.join(nodeHome, 'node_modules', 'corepack', 'dist', 'pnpm.js'));
  for (const entry of (process.env.PATH || '').split(path.delimiter)) {
    if (!entry) continue;
    candidates.push(path.join(entry, 'pnpm.cjs'));
    candidates.push(path.join(entry, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'));
    candidates.push(path.join(entry, 'node_modules', 'corepack', 'dist', 'pnpm.js'));
  }
  for (const candidate of candidates) {
    const normalized = candidate.replaceAll('\\', '/').toLowerCase();
    const recognized = normalized.endsWith('/pnpm.cjs') || normalized.endsWith('/pnpm.js') ||
      normalized.endsWith('/pnpm/bin/pnpm.cjs') || normalized.endsWith('/corepack/dist/pnpm.js');
    if (!recognized || !path.isAbsolute(candidate) ||
        !['.js', '.cjs'].includes(path.extname(candidate).toLowerCase())) continue;
    try {
      if (fs.statSync(candidate).isFile()) return fs.realpathSync.native(candidate);
    } catch {
      // Try the next fixed candidate.
    }
  }
  throw new Error('pnpm_javascript_entrypoint_not_found');
}

function resolveNodeScript(repoRelative) {
  if (typeof repoRelative !== 'string' || repoRelative.includes('\\') ||
      path.posix.isAbsolute(repoRelative) || path.posix.normalize(repoRelative) !== repoRelative ||
      repoRelative.startsWith('../') || repoRelative.includes('/../') ||
      !['.js', '.cjs', '.mjs'].includes(path.posix.extname(repoRelative))) {
    throw new Error('raw_node_script_invalid');
  }
  const absolute = path.resolve(REPO_ROOT, ...repoRelative.split('/'));
  if (!isContained(REPO_ROOT, absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error('raw_node_script_forbidden');
  }
  assertNoReparse(REPO_ROOT, absolute);
  return absolute;
}

function spawnAndWait(argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, {
      cwd: REPO_ROOT,
      env: process.env,
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (Number.isInteger(code)) resolve(code);
      else resolve(signal === 'SIGINT' ? 130 : 70);
    });
  });
}

async function executeStep(step, dynamicArgs) {
  const appended = step.appendDynamicArgs === true ? dynamicArgs : [];
  if (step.kind === 'pnpm') {
    return spawnAndWait([resolvePnpmEntrypoint(), ...step.args, ...appended]);
  }
  if (step.kind === 'node') {
    return spawnAndWait([resolveNodeScript(step.script), ...step.args, ...appended]);
  }
  throw new Error('raw_step_kind_invalid');
}

async function executeRaw(raw, dynamicArgs) {
  if (raw.kind === 'noop') return 0;
  if (raw.kind === 'pnpm' || raw.kind === 'node') return executeStep(raw, dynamicArgs);
  if (raw.kind === 'sequence') {
    for (const step of raw.steps) {
      const code = await executeStep(step, dynamicArgs);
      if (code !== 0) return code;
    }
    return 0;
  }
  if (raw.kind === 'nested') {
    return spawnAndWait([__filename, raw.rawOperation, ...dynamicArgs]);
  }
  throw new Error('raw_operation_kind_invalid');
}

function validateSession(rawId, raw, registry) {
  const ciLifecycle = process.platform !== 'win32' && process.env.CI === 'true' &&
    raw.ciLifecycle === true && process.env.SHUHAI_BOUND_SESSION !== '1';
  if (ciLifecycle) return;
  if (process.env.SHUHAI_BOUND_SESSION !== '1' ||
      !SAFE_TOKEN.test(process.env.SHUHAI_SESSION_TOKEN || '') ||
      !OPERATION_ID.test(process.env.SHUHAI_SESSION_ROOT || '')) {
    throw new Error('sealed_session_required');
  }
  const declaredRoot = fs.realpathSync.native(process.env.SHUHAI_REPO_ROOT || '');
  if (declaredRoot !== fs.realpathSync.native(REPO_ROOT)) {
    throw new Error('sealed_session_root_mismatch');
  }
  const operation = registry.operations[process.env.SHUHAI_SESSION_ROOT];
  if (!operation || operation.blockedReason || !operation.allowedRaw.includes(rawId)) {
    throw new Error('sealed_session_operation_forbidden');
  }
  if (rawId === operation.rawOperation &&
      (operation.dynamicArgPolicy || '') !== (raw.dynamicArgPolicy || '')) {
    throw new Error('sealed_session_dynamic_policy_mismatch');
  }
}

function validateSealedDynamicArgs(raw, argv) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('raw_operation_shape_invalid');
  }
  return validateDynamicArgs(raw.dynamicArgPolicy, argv);
}

async function main(argv = process.argv.slice(2)) {
  try {
    const rawId = argv.shift();
    if (!rawId || !OPERATION_ID.test(rawId)) throw new Error('raw_operation_id_invalid');
    const registry = loadRegistry();
    const raw = registry.rawOperations[rawId];
    if (!raw) throw new Error('raw_operation_unknown');
    validateSession(rawId, raw, registry);
    const dynamicArgs = validateSealedDynamicArgs(raw, argv);
    process.exitCode = await executeRaw(raw, dynamicArgs);
  } catch (error) {
    blocked(error && error.message ? error.message : 'sealed_dispatch_failed');
  }
}

module.exports = { validateSealedDynamicArgs };

if (require.main === module) main();
