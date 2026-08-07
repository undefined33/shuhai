'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REGISTRY_PATH = path.join(__dirname, 'host-command-registry.json');
const TEST_ROOT = path.join(REPO_ROOT, '.tmp', 'host-stability-narrow-v1', 'test');
const OPERATION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_TOKEN = /^[a-f0-9]{64}$/;
const GIT_OID = /^[0-9a-f]{40}$/;
const RELEASE_ID = /^shuhai-v[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}-[0-9a-f]{12}$/;
const SHELL_META = /[;&|<>`$\r\n\0]/;
const DYNAMIC_POLICIES = new Set([
  'prettier-paths',
  'typescript-paths',
  'document-paths',
  'git-oid',
  'release-id',
]);
const PATH_DYNAMIC_POLICIES = new Set([
  'prettier-paths',
  'typescript-paths',
  'document-paths',
]);
const PROFILE_LIMITS = Object.freeze({
  wallMilliseconds: 1800000,
  idleMilliseconds: 300000,
  stdoutBytes: 1048576,
  stderrBytes: 1048576,
  aggregateBytes: 1572864,
  processMemoryBytes: 2147483648,
  jobMemoryBytes: 4294967296,
  processCount: 32,
  mutexWaitMilliseconds: 5000,
  cleanupMilliseconds: 30000,
  chunkBytes: 65536,
  ringBytes: 8192,
});

function fail(reason, exitCode = 64) {
  const safeReason = String(reason).replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 160);
  process.stderr.write(`${JSON.stringify({ status: 'blocked', reason: safeReason })}\n`);
  process.exitCode = exitCode;
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, required, optional = []) {
  if (!plainObject(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function safeString(value, max = 512) {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    !SHELL_META.test(value);
}

function validateStep(step, label, rawLevel = false) {
  if (!plainObject(step) || !['pnpm', 'node'].includes(step.kind)) {
    throw new Error(`${label}_kind_invalid`);
  }
  const required = step.kind === 'node' ? ['kind', 'script', 'args'] : ['kind', 'args'];
  const optional = ['appendDynamicArgs'];
  if (rawLevel) optional.push('dynamicArgPolicy', 'ciLifecycle');
  if (!exactKeys(step, required, optional)) {
    throw new Error(`${label}_shape_invalid`);
  }
  if (step.kind === 'node' && !safeString(step.script)) {
    throw new Error(`${label}_script_invalid`);
  }
  if (!Array.isArray(step.args) || step.args.length > 64 ||
      !step.args.every((arg) => safeString(arg))) {
    throw new Error(`${label}_args_invalid`);
  }
  if (Object.hasOwn(step, 'appendDynamicArgs') && step.appendDynamicArgs !== true) {
    throw new Error(`${label}_append_invalid`);
  }
}

function validateRegistry(registry) {
  if (!exactKeys(
    registry,
    ['schemaVersion', 'mutexName', 'receipt', 'profiles', 'operations', 'rawOperations'],
  )) {
    throw new Error('registry_shape_invalid');
  }
  if (registry.schemaVersion !== 1) throw new Error('registry_schema_version_invalid');
  if (registry.mutexName !== 'Local\\CodexHostHeavyLane-v1') {
    throw new Error('registry_mutex_invalid');
  }
  if (!exactKeys(registry.receipt, ['path', 'maxBytes']) ||
      registry.receipt.path !== '.tmp/host-command/current.json' ||
      registry.receipt.maxBytes !== 32768) {
    throw new Error('registry_receipt_invalid');
  }
  if (!plainObject(registry.profiles) || Object.keys(registry.profiles).length === 0) {
    throw new Error('registry_profiles_invalid');
  }
  for (const [name, profile] of Object.entries(registry.profiles)) {
    if (!OPERATION_ID.test(name) || !exactKeys(
      profile,
      ['classification', ...Object.keys(PROFILE_LIMITS)],
    )) {
      throw new Error(`profile_${name}_shape_invalid`);
    }
    if (!['quick', 'heavy'].includes(profile.classification)) {
      throw new Error(`profile_${name}_classification_invalid`);
    }
    for (const [field, maximum] of Object.entries(PROFILE_LIMITS)) {
      const value = profile[field];
      if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
        throw new Error(`profile_${name}_${field}_invalid`);
      }
    }
    if (profile.processMemoryBytes > profile.jobMemoryBytes ||
        profile.aggregateBytes > profile.stdoutBytes + profile.stderrBytes ||
        profile.ringBytes > profile.aggregateBytes || profile.chunkBytes > profile.aggregateBytes) {
      throw new Error(`profile_${name}_relationship_invalid`);
    }
  }
  if (!plainObject(registry.rawOperations) || !plainObject(registry.operations)) {
    throw new Error('registry_operations_invalid');
  }
  for (const [name, raw] of Object.entries(registry.rawOperations)) {
    if (!OPERATION_ID.test(name) || !plainObject(raw)) {
      throw new Error(`raw_${name}_invalid`);
    }
    const optional = ['args', 'script', 'steps', 'rawOperation', 'appendDynamicArgs',
      'dynamicArgPolicy', 'ciLifecycle'];
    if (!exactKeys(raw, ['kind'], optional) ||
        !['noop', 'pnpm', 'node', 'sequence', 'nested'].includes(raw.kind)) {
      throw new Error(`raw_${name}_shape_invalid`);
    }
    if (Object.hasOwn(raw, 'dynamicArgPolicy') &&
        !DYNAMIC_POLICIES.has(raw.dynamicArgPolicy)) {
      throw new Error(`raw_${name}_dynamic_policy_invalid`);
    }
    if (Object.hasOwn(raw, 'ciLifecycle') && raw.ciLifecycle !== true) {
      throw new Error(`raw_${name}_ci_lifecycle_invalid`);
    }
    if (raw.kind === 'pnpm' || raw.kind === 'node') validateStep(raw, `raw_${name}`, true);
    if (raw.kind === 'noop' && Object.keys(raw).some((key) => !['kind', 'ciLifecycle'].includes(key))) {
      throw new Error(`raw_${name}_noop_invalid`);
    }
    if (raw.kind === 'sequence') {
      if (!Array.isArray(raw.steps) || raw.steps.length === 0 || raw.steps.length > 8) {
        throw new Error(`raw_${name}_steps_invalid`);
      }
      raw.steps.forEach((step, index) => validateStep(step, `raw_${name}_step_${index}`));
    }
    if (raw.kind === 'nested' &&
        (!OPERATION_ID.test(raw.rawOperation || '') || Object.keys(raw).length !== 2)) {
      throw new Error(`raw_${name}_nested_invalid`);
    }
    if (Object.hasOwn(raw, 'appendDynamicArgs') && raw.appendDynamicArgs !== true) {
      throw new Error(`raw_${name}_append_invalid`);
    }
  }
  for (const [name, operation] of Object.entries(registry.operations)) {
    if (!OPERATION_ID.test(name) || !plainObject(operation)) {
      throw new Error(`operation_${name}_invalid`);
    }
    if (Object.hasOwn(operation, 'blockedReason')) {
      if (!exactKeys(operation, ['blockedReason']) || !safeString(operation.blockedReason)) {
        throw new Error(`operation_${name}_blocked_invalid`);
      }
      continue;
    }
    if (!exactKeys(
      operation,
      ['profile', 'rawOperation', 'allowedRaw'],
      ['dynamicArgPolicy', 'cancelAfterMilliseconds', 'parentExceptionAfterMilliseconds'],
    )) {
      throw new Error(`operation_${name}_shape_invalid`);
    }
    if (!Object.hasOwn(registry.profiles, operation.profile) ||
        !Object.hasOwn(registry.rawOperations, operation.rawOperation) ||
        !Array.isArray(operation.allowedRaw) || operation.allowedRaw.length === 0 ||
        operation.allowedRaw.length > 16 || !operation.allowedRaw.includes(operation.rawOperation) ||
        !operation.allowedRaw.every((id) => Object.hasOwn(registry.rawOperations, id))) {
      throw new Error(`operation_${name}_reference_invalid`);
    }
    if (Object.hasOwn(operation, 'dynamicArgPolicy') &&
        !DYNAMIC_POLICIES.has(operation.dynamicArgPolicy)) {
      throw new Error(`operation_${name}_dynamic_policy_invalid`);
    }
    for (const field of ['cancelAfterMilliseconds', 'parentExceptionAfterMilliseconds']) {
      if (Object.hasOwn(operation, field) &&
          (!Number.isSafeInteger(operation[field]) || operation[field] <= 0 ||
           operation[field] >= registry.profiles[operation.profile].wallMilliseconds)) {
        throw new Error(`operation_${name}_${field}_invalid`);
      }
    }
  }
  for (const [name, raw] of Object.entries(registry.rawOperations)) {
    if (raw.kind === 'nested' && !Object.hasOwn(registry.rawOperations, raw.rawOperation)) {
      throw new Error(`raw_${name}_nested_reference_invalid`);
    }
  }
  return registry;
}

function loadRegistry(registryPath = REGISTRY_PATH) {
  const bytes = fs.readFileSync(registryPath);
  if (bytes.length === 0 || bytes.length > 256 * 1024) throw new Error('registry_size_invalid');
  return validateRegistry(JSON.parse(bytes.toString('utf8')));
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' &&
    !path.isAbsolute(relative);
}

function assertNoReparse(root, candidate) {
  const relative = path.relative(root, candidate);
  let current = root;
  for (const part of relative.split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error('path_reparse_forbidden');
  }
  if (fs.realpathSync.native(candidate) !== path.resolve(candidate)) {
    throw new Error('path_reparse_forbidden');
  }
}

function validateDynamicArgs(policy, args) {
  if (!policy) {
    if (args.length !== 0) throw new Error('operation_arguments_forbidden');
    return [];
  }
  if (policy === 'git-oid' || policy === 'release-id') {
    if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== 'string') {
      throw new Error('operation_scalar_argument_count_invalid');
    }
    const value = args[0];
    const byteLength = Buffer.byteLength(value, 'utf8');
    const ascii = !/[^\x20-\x7e]/.test(value);
    if (policy === 'git-oid' &&
        (byteLength !== 40 || !ascii || !GIT_OID.test(value))) {
      throw new Error('operation_git_oid_invalid');
    }
    if (policy === 'release-id' &&
        (byteLength > 38 || !ascii || !RELEASE_ID.test(value))) {
      throw new Error('operation_release_id_invalid');
    }
    return [value];
  }
  if (!PATH_DYNAMIC_POLICIES.has(policy)) {
    throw new Error('operation_dynamic_policy_invalid');
  }
  if (!Array.isArray(args) || args.length === 0 || args.length > 32) {
    throw new Error('operation_path_count_invalid');
  }
  const extensions = {
    'prettier-paths': new Set(['.ts', '.tsx', '.js', '.cjs', '.mjs', '.json', '.md', '.yml', '.yaml', '.css', '.html']),
    'typescript-paths': new Set(['.ts', '.tsx']),
    'document-paths': new Set(['.json', '.md', '.yml', '.yaml']),
  }[policy];
  return args.map((arg) => {
    if (!safeString(arg, 260) || arg.includes('\\') || path.posix.isAbsolute(arg) ||
        path.posix.normalize(arg) !== arg || arg === '.' || arg.startsWith('../') ||
        arg.includes('/../') || !extensions.has(path.posix.extname(arg).toLowerCase())) {
      throw new Error('operation_path_invalid');
    }
    const absolute = path.resolve(REPO_ROOT, ...arg.split('/'));
    if (!isContained(REPO_ROOT, absolute)) throw new Error('operation_path_escape');
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile()) throw new Error('operation_path_not_file');
    assertNoReparse(REPO_ROOT, absolute);
    return arg;
  });
}

function validateTestRegistryPath(candidate) {
  const absolute = path.resolve(candidate);
  if (path.extname(absolute).toLowerCase() !== '.json' || !isContained(TEST_ROOT, absolute)) {
    throw new Error('test_registry_path_forbidden');
  }
  assertNoReparse(REPO_ROOT, absolute);
  return absolute;
}

function powershellPath() {
  const candidates = [];
  if (process.env.ProgramFiles) {
    candidates.push(path.join(process.env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe'));
  }
  if (process.env.SystemRoot) {
    candidates.push(path.join(
      process.env.SystemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    ));
  }
  const selected = candidates.find((candidate) => fs.existsSync(candidate));
  if (!selected) throw new Error('powershell_not_found');
  return selected;
}

function runChild(executable, argv, env) {
  const child = spawn(executable, argv, {
    cwd: REPO_ROOT,
    env,
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  });
  let settled = false;
  const abandon = (signal) => {
    if (settled) return;
    settled = true;
    process.stderr.write(`${JSON.stringify({ status: 'cancelled', reason: signal })}\n`);
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', abandon);
  process.once('SIGTERM', abandon);
  child.once('error', (error) => {
    if (settled) return;
    settled = true;
    process.removeListener('SIGINT', abandon);
    process.removeListener('SIGTERM', abandon);
    fail(`runner_spawn_${error.code || 'error'}`, 70);
  });
  child.once('exit', (code, signal) => {
    if (settled) return;
    settled = true;
    process.removeListener('SIGINT', abandon);
    process.removeListener('SIGTERM', abandon);
    process.exitCode = Number.isInteger(code) ? code : signal === 'SIGINT' ? 130 : 70;
  });
}

function main(argv = process.argv.slice(2)) {
  try {
    if (argv[0] === '--validate-registry') {
      if (argv.length !== 2) throw new Error('validate_registry_arguments_invalid');
      const candidate = validateTestRegistryPath(argv[1]);
      loadRegistry(candidate);
      process.stdout.write(`${JSON.stringify({ status: 'ok', reason: 'registry_valid' })}\n`);
      return;
    }
    const operationId = argv.shift();
    if (!operationId || !OPERATION_ID.test(operationId)) throw new Error('operation_id_invalid');
    const registry = loadRegistry();
    const operation = registry.operations[operationId];
    if (!operation) throw new Error('operation_unknown');
    if (operation.blockedReason) {
      fail(operation.blockedReason, 64);
      return;
    }
    const dynamicArgs = validateDynamicArgs(operation.dynamicArgPolicy, argv);
    if (process.platform === 'win32') {
      const script = path.join(__dirname, 'Invoke-ShuHaiBoundedCommand.ps1');
      runChild(powershellPath(), [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-File',
        script,
        '-OperationId',
        operationId,
        '-ParentPid',
        String(process.pid),
        ...dynamicArgs,
      ], process.env);
      return;
    }
    if (process.env.CI !== 'true') throw new Error('non_windows_interactive_blocked');
    const token = crypto.randomBytes(32).toString('hex');
    if (!SAFE_TOKEN.test(token)) throw new Error('session_token_generation_failed');
    const env = {
      ...process.env,
      SHUHAI_BOUND_SESSION: '1',
      SHUHAI_SESSION_TOKEN: token,
      SHUHAI_SESSION_ROOT: operationId,
      SHUHAI_REPO_ROOT: fs.realpathSync.native(REPO_ROOT),
      SHUHAI_CI_COMPAT: '1',
    };
    runChild(process.execPath, [
      path.join(__dirname, 'assert-session.cjs'),
      operation.rawOperation,
      ...dynamicArgs,
    ], env);
  } catch (error) {
    fail(error && error.message ? error.message : 'command_router_failed');
  }
}

module.exports = {
  GIT_OID,
  OPERATION_ID,
  RELEASE_ID,
  REPO_ROOT,
  REGISTRY_PATH,
  SAFE_TOKEN,
  assertNoReparse,
  isContained,
  loadRegistry,
  validateDynamicArgs,
  validateRegistry,
};

if (require.main === module) main();
