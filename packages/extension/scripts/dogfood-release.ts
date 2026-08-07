import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import {
  constants as fsConstants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

export const WORKTREE_ROOT = path.resolve(scriptDirectory, '../../..');
export const EXTENSION_ROOT = path.join(WORKTREE_ROOT, 'packages', 'extension');
export const DIST_ROOT = path.join(EXTENSION_ROOT, 'dist');
export const RELEASES_ROOT = path.join(WORKTREE_ROOT, 'dogfood', 'releases');
export const EXPECTED_EXTENSION_ID = 'jdjmpeogiojjhdabdjmpeclcbjcekbje';
export const BUILD_COMMAND = 'node scripts/host-command/shuhai-command.cjs extension-build';

const LOCKFILE_PATH = path.join(WORKTREE_ROOT, 'pnpm-lock.yaml');
const SOURCE_MANIFEST_PATH = path.join(EXTENSION_ROOT, 'manifest.json');
const EXTENSION_PACKAGE_PATH = path.join(EXTENSION_ROOT, 'package.json');
const SOURCE_REF = 'refs/heads/main at implementation PR merge';
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const OID_PATTERN = /^[0-9a-f]{40}$/u;
const RELEASE_ID_PATTERN =
  /^shuhai-v[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}-[0-9a-f]{12}$/u;
const PNPM_VERSION_PATTERN =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;

const ManifestVersionSchema = z
  .string()
  .regex(/^[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}$/u)
  .refine((value) => value.split('.').every((part) => Number(part) <= 65_535));

const MinimumChromeVersionSchema = z
  .string()
  .regex(/^[0-9]{1,5}(?:\.[0-9]{1,5}){0,3}$/u)
  .refine((value) => value.split('.').every((part) => Number(part) <= 65_535));

const ExtensionManifestSchema = z
  .object({
    manifest_version: z.literal(3),
    version: ManifestVersionSchema,
    minimum_chrome_version: MinimumChromeVersionSchema,
    key: z.string().min(1),
    background: z.object({
      service_worker: z.string().min(1),
    }),
  })
  .passthrough();

const InventoryFileSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .refine((value) => !path.isAbsolute(value))
      .refine((value) => !value.includes('\\'))
      .refine((value) => !value.split('/').includes('..')),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(SHA256_PATTERN),
  })
  .strict();

export const ReleaseMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    releaseId: z.string().regex(RELEASE_ID_PATTERN),
    createdAt: z.string().datetime(),
    sourceCommit: z.string().regex(OID_PATTERN),
    sourceRef: z.literal(SOURCE_REF),
    lockfileSha256: z.string().regex(SHA256_PATTERN),
    extensionId: z.literal(EXPECTED_EXTENSION_ID),
    manifestVersion: ManifestVersionSchema,
    manifestVersionNumber: z.literal(3),
    minimumChromeVersion: MinimumChromeVersionSchema,
    nodeVersion: z.string().min(1),
    pnpmVersion: z.string().regex(PNPM_VERSION_PATTERN),
    viteVersion: z.string().min(1),
    platform: z.string().min(1),
    arch: z.string().min(1),
    buildCommand: z.literal(BUILD_COMMAND),
    files: z.array(InventoryFileSchema).min(1),
  })
  .strict();

const AcceptanceMetadataBaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    releaseId: z.string().regex(RELEASE_ID_PATTERN),
    acceptedAt: z.string().datetime(),
    sourceCommit: z.string().regex(OID_PATTERN),
    extensionId: z.literal(EXPECTED_EXTENSION_ID),
    chromiumVersion: z.string().min(1),
    serviceWorkerSha256: z.string().regex(SHA256_PATTERN),
    profileKind: z.literal('fresh-project-owned'),
    offline: z.literal(true),
    bookmarkDigest: z
      .object({
        before: z.string().regex(SHA256_PATTERN),
        after: z.string().regex(SHA256_PATTERN),
        nodeCountBefore: z.number().int().nonnegative(),
        nodeCountAfter: z.number().int().nonnegative(),
        unchanged: z.literal(true),
      })
      .strict(),
    xPermission: z
      .object({
        before: z.literal(false),
        after: z.literal(false),
      })
      .strict(),
    network: z
      .object({
        observedPageHttpRequests: z.number().int().nonnegative(),
        abortedPageHttpRequests: z.number().int().nonnegative(),
        unexpectedPageNetworkFailures: z.literal(0),
      })
      .strict(),
    diagnostics: z
      .object({
        consoleErrors: z.literal(0),
        pageErrors: z.literal(0),
      })
      .strict(),
    overall: z.literal('PASS'),
  })
  .strict();

export const AcceptanceMetadataSchema = AcceptanceMetadataBaseSchema.superRefine(
  (acceptance, context) => {
    if (
      acceptance.bookmarkDigest.before !== acceptance.bookmarkDigest.after ||
      acceptance.bookmarkDigest.nodeCountBefore !== acceptance.bookmarkDigest.nodeCountAfter
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'acceptance_bookmark_digest_changed',
        path: ['bookmarkDigest'],
      });
    }
    if (
      acceptance.network.observedPageHttpRequests !== acceptance.network.abortedPageHttpRequests
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'acceptance_page_network_not_fully_aborted',
        path: ['network'],
      });
    }
  },
);

export type InventoryFile = z.infer<typeof InventoryFileSchema>;
export type ReleaseMetadata = z.infer<typeof ReleaseMetadataSchema>;
export type AcceptanceMetadata = z.infer<typeof AcceptanceMetadataSchema>;

export interface SourceIdentity {
  readonly expectedOid: string;
  readonly head: string;
  readonly status: string;
  readonly branch: string;
}

export interface VerifiedRelease {
  readonly releaseRoot: string;
  readonly extensionRoot: string;
  readonly metadata: ReleaseMetadata;
  readonly acceptance?: AcceptanceMetadata;
}

export interface ReleaseRuntime {
  readonly worktreeRoot: string;
  readonly extensionRoot: string;
  readonly distRoot: string;
  readonly releasesRoot: string;
  readonly lockfilePath: string;
  readonly sourceManifestPath: string;
  readonly extensionPackagePath: string;
  readonly enforceCwd: boolean;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly arch: string;
  readSourceIdentity(expectedOid: string): SourceIdentity;
  runBuild(): void;
  readPnpmVersion(): string;
  now(): string;
  randomId(): string;
  publish(stagingRoot: string, finalRoot: string): void;
}

export interface VerifyReleaseOptions {
  readonly requireAcceptance?: boolean;
  readonly runtime?: ReleaseRuntime;
}

function comparablePath(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function pathEntryExists(candidate: string): boolean {
  return lstatSync(candidate, { throwIfNoEntry: false }) !== undefined;
}

export function isPathWithin(root: string, candidate: string, allowEqual = false): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === '') return allowEqual;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function validateExpectedOid(value: string): string {
  if (!OID_PATTERN.test(value)) {
    throw new Error('invalid_source_oid');
  }
  return value;
}

export function validateReleaseId(value: string): string {
  if (!RELEASE_ID_PATTERN.test(value)) {
    throw new Error('invalid_release_id');
  }
  return value;
}

export function validateSourceIdentity(identity: SourceIdentity): void {
  validateExpectedOid(identity.expectedOid);
  if (!OID_PATTERN.test(identity.head) || identity.head !== identity.expectedOid) {
    throw new Error('source_oid_mismatch');
  }
  if (identity.branch.trim().length > 0) {
    throw new Error('source_checkout_not_detached');
  }
  if (identity.status.trim().length > 0) {
    throw new Error('source_worktree_dirty');
  }
}

function sha256(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    throw new Error('invalid_json_file');
  }
}

export function assertNormalFile(filePath: string, label: string): void {
  const metadata = lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label}_not_normal_file`);
  }
}

function assertNormalDirectory(directory: string, label: string): void {
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label}_not_normal_directory`);
  }
}

function assertRealpathWithin(root: string, candidate: string, allowEqual = false): void {
  const realRoot = realpathSync.native(root);
  const realCandidate = realpathSync.native(candidate);
  if (!isPathWithin(realRoot, realCandidate, allowEqual)) {
    throw new Error('realpath_outside_root');
  }
}

export function assertSafeExistingPathChain(root: string, candidate: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (!isPathWithin(resolvedRoot, resolvedCandidate, true)) {
    throw new Error('path_outside_root');
  }

  assertNormalDirectory(resolvedRoot, 'path_root');
  assertRealpathWithin(resolvedRoot, resolvedRoot, true);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative === '') return;

  let current = resolvedRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const metadata = lstatSync(current, { throwIfNoEntry: false });
    if (!metadata) break;
    if (metadata.isSymbolicLink()) {
      throw new Error('path_redirect_rejected');
    }
    assertRealpathWithin(resolvedRoot, current, true);
  }
}

export function ensureNormalDirectoryChain(root: string, candidate: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  assertSafeExistingPathChain(resolvedRoot, resolvedCandidate);

  const relative = path.relative(resolvedRoot, resolvedCandidate);
  let current = resolvedRoot;
  for (const segment of relative === '' ? [] : relative.split(path.sep)) {
    current = path.join(current, segment);
    if (!pathEntryExists(current)) {
      mkdirSync(current);
    }
    assertNormalDirectory(current, 'created_directory');
    assertRealpathWithin(resolvedRoot, current, true);
  }
}

function safeRelativePath(root: string, relativePath: string): string {
  if (
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.includes('\\') ||
    relativePath.split('/').includes('..')
  ) {
    throw new Error('unsafe_relative_path');
  }
  const candidate = path.resolve(root, ...relativePath.split('/'));
  if (!isPathWithin(root, candidate)) {
    throw new Error('relative_path_outside_root');
  }
  return candidate;
}

export function inventoryDirectory(root: string): InventoryFile[] {
  const resolvedRoot = path.resolve(root);
  assertNormalDirectory(resolvedRoot, 'inventory_root');
  assertRealpathWithin(resolvedRoot, resolvedRoot, true);
  const files: InventoryFile[] = [];

  const visit = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name, 'en'),
    )) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const candidate = safeRelativePath(resolvedRoot, relativePath);
      const metadata = lstatSync(candidate);
      if (metadata.isSymbolicLink()) {
        throw new Error('inventory_redirect_rejected');
      }
      assertRealpathWithin(resolvedRoot, candidate);

      if (metadata.isDirectory()) {
        visit(candidate, relativePath);
        continue;
      }
      if (!metadata.isFile()) {
        throw new Error('inventory_special_file_rejected');
      }
      const body = readFileSync(candidate);
      files.push({
        path: relativePath,
        bytes: body.byteLength,
        sha256: sha256(body),
      });
    }
  };

  visit(resolvedRoot, '');
  return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

export function compareInventories(
  expected: readonly InventoryFile[],
  actual: readonly InventoryFile[],
): void {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error('release_inventory_mismatch');
  }
}

export function extensionIdFromPublicKey(publicKeyBase64: string): string {
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(publicKeyBase64)) {
    throw new Error('invalid_extension_public_key');
  }
  const publicKeyDer = Buffer.from(publicKeyBase64, 'base64');
  if (publicKeyDer.toString('base64') !== publicKeyBase64) {
    throw new Error('invalid_extension_public_key');
  }
  const publicKey = createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
  if (
    publicKey.asymmetricKeyType !== 'rsa' ||
    publicKey.asymmetricKeyDetails?.modulusLength !== 2048
  ) {
    throw new Error('invalid_extension_public_key');
  }

  const alphabet = 'abcdefghijklmnop';
  return [...createHash('sha256').update(publicKeyDer).digest().subarray(0, 16)]
    .map((byte) => alphabet.charAt(byte >> 4) + alphabet.charAt(byte & 0x0f))
    .join('');
}

function parseExtensionManifest(filePath: string) {
  assertNormalFile(filePath, 'extension_manifest');
  return ExtensionManifestSchema.parse(readJson(filePath));
}

function git(args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd: WORKTREE_ROOT,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}

function sourceIdentity(expectedOid: string): SourceIdentity {
  return {
    expectedOid,
    head: git(['rev-parse', 'HEAD']),
    status: git(['status', '--porcelain=v1', '--untracked-files=all']),
    branch: git(['branch', '--show-current']),
  };
}

function pnpmVersion(): string {
  const userAgent = process.env.npm_config_user_agent;
  if (
    typeof userAgent !== 'string' ||
    Buffer.byteLength(userAgent, 'utf8') > 512 ||
    /[^\x20-\x7e]/u.test(userAgent)
  ) {
    throw new Error('invalid_pnpm_user_agent');
  }
  const pnpmTokens = userAgent.split(' ').filter((token) => token.startsWith('pnpm/'));
  if (pnpmTokens.length !== 1) {
    throw new Error('invalid_pnpm_user_agent');
  }
  const version = pnpmTokens[0]?.slice('pnpm/'.length) ?? '';
  if (!PNPM_VERSION_PATTERN.test(version)) {
    throw new Error('invalid_pnpm_version');
  }
  return version;
}

function viteVersion(runtime: ReleaseRuntime): string {
  assertNormalFile(runtime.extensionPackagePath, 'extension_package');
  const extensionPackage = z
    .object({
      devDependencies: z.object({ vite: z.string().min(1) }),
    })
    .parse(readJson(runtime.extensionPackagePath));
  return extensionPackage.devDependencies.vite;
}

function runBuild(): void {
  const sessionGuard = path.join(
    WORKTREE_ROOT,
    'scripts',
    'host-command',
    'assert-session.cjs',
  );
  assertNormalFile(sessionGuard, 'host_command_session_guard');
  const result = spawnSync(process.execPath, [sessionGuard, 'extension-build-raw'], {
    cwd: WORKTREE_ROOT,
    stdio: 'inherit',
    windowsHide: true,
    shell: false,
  });
  if (result.error || result.signal !== null || result.status !== 0) {
    throw new Error('extension_build_failed');
  }
}

export const PRODUCTION_RELEASE_RUNTIME: ReleaseRuntime = {
  worktreeRoot: WORKTREE_ROOT,
  extensionRoot: EXTENSION_ROOT,
  distRoot: DIST_ROOT,
  releasesRoot: RELEASES_ROOT,
  lockfilePath: LOCKFILE_PATH,
  sourceManifestPath: SOURCE_MANIFEST_PATH,
  extensionPackagePath: EXTENSION_PACKAGE_PATH,
  enforceCwd: true,
  nodeVersion: process.version,
  platform: process.platform,
  arch: process.arch,
  readSourceIdentity: sourceIdentity,
  runBuild,
  readPnpmVersion: pnpmVersion,
  now: () => new Date().toISOString(),
  randomId: () => randomUUID().toLowerCase(),
  publish: (stagingRoot, finalRoot) => {
    renameSync(stagingRoot, finalRoot);
  },
};

function releaseIdFor(manifestVersion: string, sourceCommit: string): string {
  return validateReleaseId(`shuhai-v${manifestVersion}-${sourceCommit.slice(0, 12)}`);
}

function copyInventory(
  sourceRoot: string,
  destinationRoot: string,
  inventory: readonly InventoryFile[],
): void {
  for (const file of inventory) {
    const source = safeRelativePath(sourceRoot, file.path);
    assertNormalFile(source, 'release_source');
    const destination = safeRelativePath(destinationRoot, file.path);
    ensureNormalDirectoryChain(destinationRoot, path.dirname(destination));
    copyFileSync(source, destination, fsConstants.COPYFILE_EXCL);
    assertNormalFile(destination, 'release_destination');
  }
}

export function releaseRootFor(
  releaseId: string,
  runtime: ReleaseRuntime = PRODUCTION_RELEASE_RUNTIME,
): string {
  const validated = validateReleaseId(releaseId);
  const candidate = path.resolve(runtime.releasesRoot, validated);
  if (!isPathWithin(runtime.releasesRoot, candidate)) {
    throw new Error('release_path_outside_root');
  }
  return candidate;
}

function validateReleaseRootEntries(releaseRoot: string, allowAcceptance: boolean): void {
  const allowed = new Set(['extension', 'release.json']);
  if (allowAcceptance) allowed.add('acceptance.json');
  const unexpected = readdirSync(releaseRoot)
    .filter((entry) => !allowed.has(entry))
    .sort((a, b) => a.localeCompare(b, 'en'));
  if (unexpected.length > 0) {
    throw new Error('unexpected_release_root_entry');
  }
}

function verifyReleaseAt(
  releaseRoot: string,
  releaseId: string,
  options: { readonly requireAcceptance: boolean; readonly staging: boolean },
  runtime: ReleaseRuntime,
): VerifiedRelease {
  validateReleaseId(releaseId);
  assertSafeExistingPathChain(runtime.releasesRoot, releaseRoot);
  assertNormalDirectory(releaseRoot, 'release_root');
  assertRealpathWithin(runtime.releasesRoot, releaseRoot);
  if (!options.staging && path.basename(releaseRoot) !== releaseId) {
    throw new Error('release_root_name_mismatch');
  }

  validateReleaseRootEntries(releaseRoot, true);
  const metadataPath = path.join(releaseRoot, 'release.json');
  assertNormalFile(metadataPath, 'release_metadata');
  const metadata = ReleaseMetadataSchema.parse(readJson(metadataPath));
  if (metadata.releaseId !== releaseId) {
    throw new Error('release_metadata_id_mismatch');
  }

  validateSourceIdentity(runtime.readSourceIdentity(metadata.sourceCommit));
  assertNormalFile(runtime.lockfilePath, 'workspace_lockfile');
  if (sha256(readFileSync(runtime.lockfilePath)) !== metadata.lockfileSha256) {
    throw new Error('release_lockfile_mismatch');
  }
  if (metadata.viteVersion !== viteVersion(runtime)) {
    throw new Error('release_vite_version_mismatch');
  }

  const extensionRoot = path.join(releaseRoot, 'extension');
  assertNormalDirectory(extensionRoot, 'release_extension');
  const actualInventory = inventoryDirectory(extensionRoot);
  compareInventories(metadata.files, actualInventory);

  const manifest = parseExtensionManifest(path.join(extensionRoot, 'manifest.json'));
  const sourceManifest = parseExtensionManifest(runtime.sourceManifestPath);
  const extensionId = extensionIdFromPublicKey(manifest.key);
  if (
    extensionId !== EXPECTED_EXTENSION_ID ||
    metadata.extensionId !== extensionId ||
    manifest.version !== metadata.manifestVersion ||
    manifest.manifest_version !== metadata.manifestVersionNumber ||
    manifest.minimum_chrome_version !== metadata.minimumChromeVersion ||
    sourceManifest.version !== manifest.version ||
    sourceManifest.key !== manifest.key ||
    releaseIdFor(manifest.version, metadata.sourceCommit) !== releaseId
  ) {
    throw new Error('release_manifest_identity_mismatch');
  }

  let acceptance: AcceptanceMetadata | undefined;
  const acceptancePath = path.join(releaseRoot, 'acceptance.json');
  if (pathEntryExists(acceptancePath)) {
    assertNormalFile(acceptancePath, 'release_acceptance');
    acceptance = AcceptanceMetadataSchema.parse(readJson(acceptancePath));
    const serviceWorker = metadata.files.find(
      (file) => file.path === manifest.background.service_worker,
    );
    if (
      !serviceWorker ||
      acceptance.releaseId !== releaseId ||
      acceptance.sourceCommit !== metadata.sourceCommit ||
      acceptance.extensionId !== metadata.extensionId ||
      acceptance.serviceWorkerSha256 !== serviceWorker.sha256
    ) {
      throw new Error('release_acceptance_identity_mismatch');
    }
  }
  if (options.requireAcceptance && !acceptance) {
    throw new Error('release_acceptance_required');
  }

  return { releaseRoot, extensionRoot, metadata, acceptance };
}

export function verifyRelease(
  releaseId: string,
  options: VerifyReleaseOptions = {},
): VerifiedRelease {
  const runtime = options.runtime ?? PRODUCTION_RELEASE_RUNTIME;
  const releaseRoot = releaseRootFor(releaseId, runtime);
  if (!pathEntryExists(releaseRoot)) {
    throw new Error('release_missing');
  }
  return verifyReleaseAt(
    releaseRoot,
    releaseId,
    {
      requireAcceptance: options.requireAcceptance === true,
      staging: false,
    },
    runtime,
  );
}

function buildInventory(runtime: ReleaseRuntime): InventoryFile[] {
  assertSafeExistingPathChain(runtime.extensionRoot, runtime.distRoot);
  if (pathEntryExists(runtime.distRoot)) {
    assertNormalDirectory(runtime.distRoot, 'extension_dist');
    assertRealpathWithin(runtime.extensionRoot, runtime.distRoot);
  }
  runtime.runBuild();
  return inventoryDirectory(runtime.distRoot);
}

export function createRelease(
  expectedOidInput: string,
  runtime: ReleaseRuntime = PRODUCTION_RELEASE_RUNTIME,
): VerifiedRelease {
  if (
    runtime.enforceCwd &&
    comparablePath(process.cwd()) !== comparablePath(runtime.worktreeRoot)
  ) {
    throw new Error('dogfood_wrong_worktree');
  }
  const expectedOid = validateExpectedOid(expectedOidInput);
  validateSourceIdentity(runtime.readSourceIdentity(expectedOid));
  assertNormalFile(runtime.lockfilePath, 'workspace_lockfile');

  const sourceManifest = parseExtensionManifest(runtime.sourceManifestPath);
  const extensionId = extensionIdFromPublicKey(sourceManifest.key);
  if (extensionId !== EXPECTED_EXTENSION_ID) {
    throw new Error('unexpected_extension_id');
  }
  const releaseId = releaseIdFor(sourceManifest.version, expectedOid);
  const finalRoot = releaseRootFor(releaseId, runtime);
  assertSafeExistingPathChain(runtime.worktreeRoot, finalRoot);
  if (pathEntryExists(finalRoot)) {
    throw new Error('release_already_exists');
  }

  const firstInventory = buildInventory(runtime);
  validateSourceIdentity(runtime.readSourceIdentity(expectedOid));
  const secondInventory = buildInventory(runtime);
  compareInventories(firstInventory, secondInventory);
  validateSourceIdentity(runtime.readSourceIdentity(expectedOid));

  ensureNormalDirectoryChain(runtime.worktreeRoot, runtime.releasesRoot);
  if (pathEntryExists(finalRoot)) {
    throw new Error('release_already_exists');
  }
  const randomId = runtime.randomId().toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(randomId)
  ) {
    throw new Error('invalid_release_random_id');
  }
  const stagingRoot = path.join(runtime.releasesRoot, `.staging-${releaseId}-${randomId}`);
  if (!isPathWithin(runtime.releasesRoot, stagingRoot) || pathEntryExists(stagingRoot)) {
    throw new Error('release_staging_conflict');
  }
  mkdirSync(stagingRoot);
  assertNormalDirectory(stagingRoot, 'release_staging');
  assertRealpathWithin(runtime.releasesRoot, stagingRoot);

  const extensionRoot = path.join(stagingRoot, 'extension');
  mkdirSync(extensionRoot);
  copyInventory(runtime.distRoot, extensionRoot, secondInventory);
  compareInventories(secondInventory, inventoryDirectory(extensionRoot));

  const copiedManifest = parseExtensionManifest(path.join(extensionRoot, 'manifest.json'));
  if (
    copiedManifest.version !== sourceManifest.version ||
    extensionIdFromPublicKey(copiedManifest.key) !== EXPECTED_EXTENSION_ID
  ) {
    throw new Error('staging_manifest_identity_mismatch');
  }

  const metadata: ReleaseMetadata = {
    schemaVersion: 1,
    releaseId,
    createdAt: runtime.now(),
    sourceCommit: expectedOid,
    sourceRef: SOURCE_REF,
    lockfileSha256: sha256(readFileSync(runtime.lockfilePath)),
    extensionId: EXPECTED_EXTENSION_ID,
    manifestVersion: copiedManifest.version,
    manifestVersionNumber: copiedManifest.manifest_version,
    minimumChromeVersion: copiedManifest.minimum_chrome_version,
    nodeVersion: runtime.nodeVersion,
    pnpmVersion: runtime.readPnpmVersion(),
    viteVersion: viteVersion(runtime),
    platform: runtime.platform,
    arch: runtime.arch,
    buildCommand: BUILD_COMMAND,
    files: secondInventory,
  };
  ReleaseMetadataSchema.parse(metadata);
  writeFileSync(path.join(stagingRoot, 'release.json'), `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });

  verifyReleaseAt(stagingRoot, releaseId, { requireAcceptance: false, staging: true }, runtime);
  if (pathEntryExists(finalRoot)) {
    throw new Error('release_already_exists');
  }
  runtime.publish(stagingRoot, finalRoot);
  return verifyRelease(releaseId, { runtime });
}

export type ReleaseCliCommand =
  | { readonly command: 'create'; readonly value: string }
  | { readonly command: 'verify'; readonly value: string }
  | { readonly command: 'verify-accepted'; readonly value: string };

export function parseReleaseCliArguments(args: readonly string[]): ReleaseCliCommand {
  if (args.length !== 2) {
    throw new Error('invalid_cli_arguments');
  }
  const [command, value] = args;
  if (command === 'create') {
    return { command, value: validateExpectedOid(value as string) };
  }
  if (command === 'verify' || command === 'verify-accepted') {
    return { command, value: validateReleaseId(value as string) };
  }
  throw new Error('invalid_cli_command');
}

async function main(): Promise<void> {
  const parsed = parseReleaseCliArguments(process.argv.slice(2));
  if (parsed.command === 'create') {
    const release = createRelease(parsed.value);
    console.log(`DOGFOOD_RELEASE_CREATED ${release.metadata.releaseId}`);
    console.log(`DOGFOOD_EXTENSION_PATH ${release.extensionRoot}`);
    return;
  }
  const release = verifyRelease(parsed.value, {
    requireAcceptance: parsed.command === 'verify-accepted',
  });
  console.log(
    `${parsed.command === 'verify-accepted' ? 'DOGFOOD_RELEASE_ACCEPTED' : 'DOGFOOD_RELEASE_VERIFIED'} ${release.metadata.releaseId}`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && comparablePath(invokedPath) === comparablePath(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'dogfood_release_failed');
    process.exitCode = 1;
  });
}
