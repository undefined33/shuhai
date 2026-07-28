import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AcceptanceMetadataSchema,
  BUILD_COMMAND,
  EXPECTED_EXTENSION_ID,
  RELEASES_ROOT,
  ReleaseMetadataSchema,
  WORKTREE_ROOT,
  assertSafeExistingPathChain,
  compareInventories,
  createRelease,
  extensionIdFromPublicKey,
  inventoryDirectory,
  isPathWithin,
  parseReleaseCliArguments,
  releaseRootFor,
  validateExpectedOid,
  validateReleaseId,
  validateSourceIdentity,
  verifyRelease,
  type AcceptanceMetadata,
  type InventoryFile,
  type ReleaseMetadata,
  type ReleaseRuntime,
  type VerifiedRelease,
} from '../scripts/dogfood-release.js';
import {
  acceptRelease,
  parseAcceptanceCliArguments,
  type AcceptanceObservation,
} from '../scripts/dogfood-acceptance.js';

const SOURCE_OID = 'a'.repeat(40);
const OTHER_OID = 'f'.repeat(40);
const RELEASE_ID = `shuhai-v0.1.0-${SOURCE_OID.slice(0, 12)}`;
const SERVICE_WORKER_HASH = 'b'.repeat(64);
const MANIFEST_HASH = 'c'.repeat(64);
const FIXTURE_CACHE_ROOT = path.join(
  WORKTREE_ROOT,
  'node_modules',
  '.cache',
  'shuhai-dogfood-tests',
);
const FIXED_TIME = '2026-07-28T00:00:00.000Z';
const SOURCE_MANIFEST = JSON.parse(
  readFileSync(path.join(WORKTREE_ROOT, 'packages', 'extension', 'manifest.json'), 'utf8'),
) as Record<string, unknown>;

interface FixtureOptions {
  readonly branch?: string;
  readonly status?: string;
  readonly head?: string;
  readonly secondBuildMutation?: 'hash' | 'missing' | 'extra';
  readonly randomIds?: readonly string[];
  readonly failFirstPublish?: boolean;
}

interface Fixture {
  readonly root: string;
  readonly runtime: ReleaseRuntime;
  readonly buildCalls: () => number;
  readonly publishCalls: () => number;
}

function sha256(body: Buffer | string): string {
  return createHash('sha256').update(body).digest('hex');
}

function createFixture(options: FixtureOptions = {}): Fixture {
  const root = path.join(FIXTURE_CACHE_ROOT, randomUUID());
  const extensionRoot = path.join(root, 'packages', 'extension');
  const distRoot = path.join(extensionRoot, 'dist');
  const releasesRoot = path.join(root, 'dogfood', 'releases');
  const lockfilePath = path.join(root, 'pnpm-lock.yaml');
  const sourceManifestPath = path.join(extensionRoot, 'manifest.json');
  const extensionPackagePath = path.join(extensionRoot, 'package.json');
  mkdirSync(extensionRoot, { recursive: true });
  writeFileSync(lockfilePath, 'lockfileVersion: test\n');
  writeFileSync(sourceManifestPath, `${JSON.stringify(SOURCE_MANIFEST, null, 2)}\n`);
  writeFileSync(
    extensionPackagePath,
    `${JSON.stringify({ devDependencies: { vite: '6.4.3' } }, null, 2)}\n`,
  );

  let buildCalls = 0;
  let publishCalls = 0;
  let randomIndex = 0;
  const runtime: ReleaseRuntime = {
    worktreeRoot: root,
    extensionRoot,
    distRoot,
    releasesRoot,
    lockfilePath,
    sourceManifestPath,
    extensionPackagePath,
    enforceCwd: false,
    nodeVersion: 'v24.14.1',
    platform: 'test',
    arch: 'x64',
    readSourceIdentity: (expectedOid) => ({
      expectedOid,
      head: options.head ?? SOURCE_OID,
      status: options.status ?? '',
      branch: options.branch ?? '',
    }),
    runBuild: () => {
      buildCalls += 1;
      mkdirSync(path.join(distRoot, 'background'), { recursive: true });
      writeFileSync(path.join(distRoot, 'manifest.json'), `${JSON.stringify(SOURCE_MANIFEST)}\n`);
      writeFileSync(
        path.join(distRoot, 'background', 'service-worker.js'),
        options.secondBuildMutation === 'hash' && buildCalls === 2
          ? 'second-build\n'
          : 'stable-build\n',
      );
      if (options.secondBuildMutation === 'missing' && buildCalls === 2) {
        unlinkSync(path.join(distRoot, 'manifest.json'));
      }
      if (options.secondBuildMutation === 'extra' && buildCalls === 2) {
        writeFileSync(path.join(distRoot, 'extra.js'), 'second-only\n');
      }
    },
    readPnpmVersion: () => '11.3.0',
    now: () => FIXED_TIME,
    randomId: () => options.randomIds?.[randomIndex++] ?? randomUUID(),
    publish: (stagingRoot, finalRoot) => {
      publishCalls += 1;
      if (options.failFirstPublish && publishCalls === 1) {
        throw new Error('simulated_publish_failure');
      }
      renameSync(stagingRoot, finalRoot);
    },
  };
  return {
    root,
    runtime,
    buildCalls: () => buildCalls,
    publishCalls: () => publishCalls,
  };
}

function inventory(): InventoryFile[] {
  return [
    {
      path: 'background/service-worker.js',
      bytes: 128,
      sha256: SERVICE_WORKER_HASH,
    },
    {
      path: 'manifest.json',
      bytes: 64,
      sha256: MANIFEST_HASH,
    },
  ];
}

function releaseMetadata(): ReleaseMetadata {
  return {
    schemaVersion: 1,
    releaseId: RELEASE_ID,
    createdAt: FIXED_TIME,
    sourceCommit: SOURCE_OID,
    sourceRef: 'refs/heads/main at implementation PR merge',
    lockfileSha256: 'd'.repeat(64),
    extensionId: EXPECTED_EXTENSION_ID,
    manifestVersion: '0.1.0',
    manifestVersionNumber: 3,
    minimumChromeVersion: '116',
    nodeVersion: 'v24.14.1',
    pnpmVersion: '11.3.0',
    viteVersion: '6.4.3',
    platform: 'win32',
    arch: 'x64',
    buildCommand: BUILD_COMMAND,
    files: inventory(),
  };
}

function acceptanceMetadata(): AcceptanceMetadata {
  return {
    schemaVersion: 1,
    releaseId: RELEASE_ID,
    acceptedAt: '2026-07-28T00:01:00.000Z',
    sourceCommit: SOURCE_OID,
    extensionId: EXPECTED_EXTENSION_ID,
    chromiumVersion: 'test-chromium',
    serviceWorkerSha256: SERVICE_WORKER_HASH,
    profileKind: 'fresh-project-owned',
    offline: true,
    bookmarkDigest: {
      before: 'e'.repeat(64),
      after: 'e'.repeat(64),
      nodeCountBefore: 3,
      nodeCountAfter: 3,
      unchanged: true,
    },
    xPermission: {
      before: false,
      after: false,
    },
    network: {
      observedPageHttpRequests: 0,
      abortedPageHttpRequests: 0,
      unexpectedPageNetworkFailures: 0,
    },
    diagnostics: {
      consoleErrors: 0,
      pageErrors: 0,
    },
    overall: 'PASS',
  };
}

function serviceWorkerHash(release: VerifiedRelease): string {
  const file = release.metadata.files.find(
    (candidate) => candidate.path === 'background/service-worker.js',
  );
  if (!file) throw new Error('test_service_worker_missing');
  return file.sha256;
}

function validObservation(release: VerifiedRelease): AcceptanceObservation {
  return {
    chromiumVersion: 'test-chromium',
    serviceWorkerSha256: serviceWorkerHash(release),
    bookmarkBefore: { digest: 'e'.repeat(64), nodeCount: 3 },
    bookmarkAfter: { digest: 'e'.repeat(64), nodeCount: 3 },
    permissionBefore: false,
    permissionAfter: false,
    observedPageHttpRequests: 0,
    abortedPageHttpRequests: 0,
    unexpectedPageNetworkFailures: 0,
    consoleErrors: 0,
    pageErrors: 0,
  };
}

function acceptanceFor(release: VerifiedRelease): AcceptanceMetadata {
  return {
    ...acceptanceMetadata(),
    releaseId: release.metadata.releaseId,
    sourceCommit: release.metadata.sourceCommit,
    serviceWorkerSha256: serviceWorkerHash(release),
  };
}

function writeAcceptance(release: VerifiedRelease, acceptance: unknown): void {
  writeFileSync(
    path.join(release.releaseRoot, 'acceptance.json'),
    `${JSON.stringify(acceptance, null, 2)}\n`,
  );
}

function rewriteReleaseInventory(release: VerifiedRelease): void {
  const metadataPath = path.join(release.releaseRoot, 'release.json');
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as ReleaseMetadata;
  writeFileSync(
    metadataPath,
    `${JSON.stringify(
      { ...metadata, files: inventoryDirectory(release.extensionRoot) },
      null,
      2,
    )}\n`,
  );
}

describe('dogfood source identity and CLI boundaries', () => {
  it('requires an exact clean detached source OID', () => {
    expect(() =>
      validateSourceIdentity({
        expectedOid: SOURCE_OID,
        head: SOURCE_OID,
        status: '',
        branch: '',
      }),
    ).not.toThrow();
    expect(() =>
      validateSourceIdentity({
        expectedOid: SOURCE_OID,
        head: OTHER_OID,
        status: '',
        branch: '',
      }),
    ).toThrow('source_oid_mismatch');
    expect(() =>
      validateSourceIdentity({
        expectedOid: SOURCE_OID,
        head: SOURCE_OID,
        status: '',
        branch: 'main',
      }),
    ).toThrow('source_checkout_not_detached');
    expect(() =>
      validateSourceIdentity({
        expectedOid: SOURCE_OID,
        head: SOURCE_OID,
        status: '?? untracked.ts',
        branch: '',
      }),
    ).toThrow('source_worktree_dirty');
    expect(() => validateExpectedOid('abc')).toThrow('invalid_source_oid');
  });

  it('pins release IDs and rejects path or argument overrides', () => {
    expect(validateReleaseId(RELEASE_ID)).toBe(RELEASE_ID);
    expect(releaseRootFor(RELEASE_ID)).toBe(path.join(RELEASES_ROOT, RELEASE_ID));
    expect(() => validateReleaseId('../escape')).toThrow('invalid_release_id');
    expect(isPathWithin(RELEASES_ROOT, path.join(RELEASES_ROOT, RELEASE_ID))).toBe(true);
    expect(isPathWithin(RELEASES_ROOT, WORKTREE_ROOT)).toBe(false);
    expect(parseReleaseCliArguments(['create', SOURCE_OID])).toEqual({
      command: 'create',
      value: SOURCE_OID,
    });
    expect(() => parseReleaseCliArguments(['create', SOURCE_OID, 'extra'])).toThrow(
      'invalid_cli_arguments',
    );
    expect(() => parseReleaseCliArguments(['unknown', RELEASE_ID])).toThrow('invalid_cli_command');
    expect(() => parseAcceptanceCliArguments(['..\\release'])).toThrow('invalid_release_id');
    expect(() => parseAcceptanceCliArguments([RELEASE_ID, 'extra'])).toThrow(
      'invalid_cli_arguments',
    );
  });

  it('rejects redirected ancestors and paths outside the worktree', () => {
    const pnpmJunction = path.join(WORKTREE_ROOT, 'packages', 'extension', 'node_modules', 'zod');
    expect(() => assertSafeExistingPathChain(WORKTREE_ROOT, pnpmJunction)).toThrow(
      'path_redirect_rejected',
    );
    const fixture = createFixture();
    const brokenJunction = path.join(fixture.root, 'broken-junction');
    symlinkSync(path.join(fixture.root, 'missing-target'), brokenJunction, 'junction');
    expect(() =>
      assertSafeExistingPathChain(fixture.root, path.join(brokenJunction, 'file.txt')),
    ).toThrow('path_redirect_rejected');
    expect(() => assertSafeExistingPathChain(WORKTREE_ROOT, path.dirname(WORKTREE_ROOT))).toThrow(
      'path_outside_root',
    );
  });
});

describe('dogfood release transaction', () => {
  it('publishes a reproducible release through staging and verifies it', () => {
    const fixture = createFixture();
    const release = createRelease(SOURCE_OID, fixture.runtime);
    expect(release.releaseRoot).toBe(releaseRootFor(RELEASE_ID, fixture.runtime));
    expect(fixture.buildCalls()).toBe(2);
    expect(fixture.publishCalls()).toBe(1);
    expect(verifyRelease(RELEASE_ID, { runtime: fixture.runtime }).metadata).toEqual(
      release.metadata,
    );
    expect(
      readdirSync(fixture.runtime.releasesRoot).filter((entry) => entry.startsWith('.staging-')),
    ).toEqual([]);
  });

  it('rejects attached, dirty, mismatched, and pre-existing final sources before build', () => {
    const attached = createFixture({ branch: 'main' });
    expect(() => createRelease(SOURCE_OID, attached.runtime)).toThrow(
      'source_checkout_not_detached',
    );
    expect(attached.buildCalls()).toBe(0);

    const dirty = createFixture({ status: ' M tracked.ts' });
    expect(() => createRelease(SOURCE_OID, dirty.runtime)).toThrow('source_worktree_dirty');
    expect(dirty.buildCalls()).toBe(0);

    const mismatched = createFixture({ head: OTHER_OID });
    expect(() => createRelease(SOURCE_OID, mismatched.runtime)).toThrow('source_oid_mismatch');
    expect(mismatched.buildCalls()).toBe(0);

    const existing = createFixture();
    mkdirSync(releaseRootFor(RELEASE_ID, existing.runtime), { recursive: true });
    expect(() => createRelease(SOURCE_OID, existing.runtime)).toThrow('release_already_exists');
    expect(existing.buildCalls()).toBe(0);
  });

  it('rejects a fixed staging conflict without overwriting it', () => {
    const fixedId = '11111111-1111-4111-8111-111111111111';
    const fixture = createFixture({ randomIds: [fixedId] });
    const stagingRoot = path.join(
      fixture.runtime.releasesRoot,
      `.staging-${RELEASE_ID}-${fixedId}`,
    );
    mkdirSync(stagingRoot, { recursive: true });
    writeFileSync(path.join(stagingRoot, 'sentinel.txt'), 'keep');
    expect(() => createRelease(SOURCE_OID, fixture.runtime)).toThrow('release_staging_conflict');
    expect(readFileSync(path.join(stagingRoot, 'sentinel.txt'), 'utf8')).toBe('keep');
    expect(existsSync(releaseRootFor(RELEASE_ID, fixture.runtime))).toBe(false);
  });

  it.each(['hash', 'missing', 'extra'] as const)(
    'leaves no final release when the second build has %s drift',
    (secondBuildMutation) => {
      const fixture = createFixture({ secondBuildMutation });
      expect(() => createRelease(SOURCE_OID, fixture.runtime)).toThrow(
        'release_inventory_mismatch',
      );
      expect(fixture.buildCalls()).toBe(2);
      expect(existsSync(releaseRootFor(RELEASE_ID, fixture.runtime))).toBe(false);
    },
  );

  it('preserves failed staging and retries with a new staging directory', () => {
    const firstId = '11111111-1111-4111-8111-111111111111';
    const secondId = '22222222-2222-4222-8222-222222222222';
    const fixture = createFixture({
      randomIds: [firstId, secondId],
      failFirstPublish: true,
    });
    expect(() => createRelease(SOURCE_OID, fixture.runtime)).toThrow('simulated_publish_failure');
    const failedStaging = path.join(
      fixture.runtime.releasesRoot,
      `.staging-${RELEASE_ID}-${firstId}`,
    );
    expect(existsSync(failedStaging)).toBe(true);
    expect(existsSync(releaseRootFor(RELEASE_ID, fixture.runtime))).toBe(false);

    const release = createRelease(SOURCE_OID, fixture.runtime);
    expect(existsSync(failedStaging)).toBe(true);
    expect(existsSync(release.releaseRoot)).toBe(true);
    expect(fixture.publishCalls()).toBe(2);
  });

  it('rejects a dist junction before invoking the build', () => {
    const fixture = createFixture();
    const target = path.join(fixture.root, 'redirect-target');
    mkdirSync(target);
    symlinkSync(target, fixture.runtime.distRoot, 'junction');
    expect(() => createRelease(SOURCE_OID, fixture.runtime)).toThrow('path_redirect_rejected');
    expect(fixture.buildCalls()).toBe(0);
  });
});

describe('dogfood verification and evidence integrity', () => {
  it('rejects extra files and redirected entries in a published extension', () => {
    const extraFixture = createFixture();
    const extraRelease = createRelease(SOURCE_OID, extraFixture.runtime);
    writeFileSync(path.join(extraRelease.extensionRoot, 'extra.txt'), 'tamper');
    expect(() => verifyRelease(RELEASE_ID, { runtime: extraFixture.runtime })).toThrow(
      'release_inventory_mismatch',
    );

    const redirectFixture = createFixture();
    const redirectRelease = createRelease(SOURCE_OID, redirectFixture.runtime);
    const target = path.join(redirectRelease.extensionRoot, 'target');
    mkdirSync(target);
    symlinkSync(target, path.join(redirectRelease.extensionRoot, 'linked'), 'junction');
    expect(() => verifyRelease(RELEASE_ID, { runtime: redirectFixture.runtime })).toThrow(
      'inventory_redirect_rejected',
    );

    const missingFixture = createFixture();
    const missingRelease = createRelease(SOURCE_OID, missingFixture.runtime);
    unlinkSync(path.join(missingRelease.extensionRoot, 'manifest.json'));
    expect(() => verifyRelease(RELEASE_ID, { runtime: missingFixture.runtime })).toThrow(
      'release_inventory_mismatch',
    );

    const hashFixture = createFixture();
    const hashRelease = createRelease(SOURCE_OID, hashFixture.runtime);
    writeFileSync(
      path.join(hashRelease.extensionRoot, 'background', 'service-worker.js'),
      'tampered\n',
    );
    expect(() => verifyRelease(RELEASE_ID, { runtime: hashFixture.runtime })).toThrow(
      'release_inventory_mismatch',
    );
  });

  it('rejects manifest identity and workspace lockfile drift', () => {
    const manifestFixture = createFixture();
    const manifestRelease = createRelease(SOURCE_OID, manifestFixture.runtime);
    const manifestPath = path.join(manifestRelease.extensionRoot, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, version: '0.1.1' })}\n`);
    rewriteReleaseInventory(manifestRelease);
    expect(() => verifyRelease(RELEASE_ID, { runtime: manifestFixture.runtime })).toThrow(
      'release_manifest_identity_mismatch',
    );

    const lockFixture = createFixture();
    createRelease(SOURCE_OID, lockFixture.runtime);
    writeFileSync(lockFixture.runtime.lockfilePath, 'changed\n');
    expect(() => verifyRelease(RELEASE_ID, { runtime: lockFixture.runtime })).toThrow(
      'release_lockfile_mismatch',
    );
  });

  it('requires present, self-consistent, identity-matched acceptance evidence', () => {
    const missingFixture = createFixture();
    createRelease(SOURCE_OID, missingFixture.runtime);
    expect(() =>
      verifyRelease(RELEASE_ID, {
        runtime: missingFixture.runtime,
        requireAcceptance: true,
      }),
    ).toThrow('release_acceptance_required');

    const identityFixture = createFixture();
    const identityRelease = createRelease(SOURCE_OID, identityFixture.runtime);
    writeAcceptance(identityRelease, {
      ...acceptanceFor(identityRelease),
      sourceCommit: OTHER_OID,
    });
    expect(() =>
      verifyRelease(RELEASE_ID, {
        runtime: identityFixture.runtime,
        requireAcceptance: true,
      }),
    ).toThrow('release_acceptance_identity_mismatch');

    const hashFixture = createFixture();
    const hashRelease = createRelease(SOURCE_OID, hashFixture.runtime);
    writeAcceptance(hashRelease, {
      ...acceptanceFor(hashRelease),
      serviceWorkerSha256: '8'.repeat(64),
    });
    expect(() =>
      verifyRelease(RELEASE_ID, {
        runtime: hashFixture.runtime,
        requireAcceptance: true,
      }),
    ).toThrow('release_acceptance_identity_mismatch');

    const nonPassFixture = createFixture();
    const nonPassRelease = createRelease(SOURCE_OID, nonPassFixture.runtime);
    writeAcceptance(nonPassRelease, {
      ...acceptanceFor(nonPassRelease),
      overall: 'FAIL',
    });
    expect(() =>
      verifyRelease(RELEASE_ID, {
        runtime: nonPassFixture.runtime,
        requireAcceptance: true,
      }),
    ).toThrow();

    const bookmarkFixture = createFixture();
    const bookmarkRelease = createRelease(SOURCE_OID, bookmarkFixture.runtime);
    const bookmarkAcceptance = acceptanceFor(bookmarkRelease);
    writeAcceptance(bookmarkRelease, {
      ...bookmarkAcceptance,
      bookmarkDigest: {
        ...bookmarkAcceptance.bookmarkDigest,
        after: '9'.repeat(64),
      },
    });
    expect(() =>
      verifyRelease(RELEASE_ID, {
        runtime: bookmarkFixture.runtime,
        requireAcceptance: true,
      }),
    ).toThrow();

    const networkFixture = createFixture();
    const networkRelease = createRelease(SOURCE_OID, networkFixture.runtime);
    const networkAcceptance = acceptanceFor(networkRelease);
    writeAcceptance(networkRelease, {
      ...networkAcceptance,
      network: {
        ...networkAcceptance.network,
        observedPageHttpRequests: 1,
      },
    });
    expect(() =>
      verifyRelease(RELEASE_ID, {
        runtime: networkFixture.runtime,
        requireAcceptance: true,
      }),
    ).toThrow();
  });

  it('does not write acceptance after runner failure or contradictory observation', async () => {
    const runnerFixture = createFixture();
    const runnerRelease = createRelease(SOURCE_OID, runnerFixture.runtime);
    await expect(
      acceptRelease(RELEASE_ID, {
        runtime: runnerFixture.runtime,
        runAcceptance: async () => {
          throw new Error('simulated_runner_failure');
        },
      }),
    ).rejects.toThrow('simulated_runner_failure');
    expect(existsSync(path.join(runnerRelease.releaseRoot, 'acceptance.json'))).toBe(false);

    const invalidFixture = createFixture();
    const invalidRelease = createRelease(SOURCE_OID, invalidFixture.runtime);
    await expect(
      acceptRelease(RELEASE_ID, {
        runtime: invalidFixture.runtime,
        runAcceptance: async (release) => ({
          ...validObservation(release),
          bookmarkAfter: { digest: '9'.repeat(64), nodeCount: 3 },
        }),
      }),
    ).rejects.toThrow();
    expect(existsSync(path.join(invalidRelease.releaseRoot, 'acceptance.json'))).toBe(false);
  });

  it('writes valid fake-runner evidence and passes accepted verification', async () => {
    const fixture = createFixture();
    const release = createRelease(SOURCE_OID, fixture.runtime);
    const acceptance = await acceptRelease(RELEASE_ID, {
      runtime: fixture.runtime,
      cacheRoot: path.join(
        fixture.root,
        'node_modules',
        '.cache',
        'shuhai-dogfood-tests',
        'acceptance',
      ),
      runAcceptance: async (candidate) => validObservation(candidate),
    });
    expect(acceptance.overall).toBe('PASS');
    expect(
      verifyRelease(RELEASE_ID, {
        runtime: fixture.runtime,
        requireAcceptance: true,
      }).acceptance,
    ).toEqual(acceptance);
    expect(existsSync(path.join(release.releaseRoot, 'acceptance.json'))).toBe(true);
  });
});

describe('dogfood metadata schemas', () => {
  it('locks release and acceptance schemas to bounded, coherent fields', () => {
    expect(ReleaseMetadataSchema.parse(releaseMetadata())).toEqual(releaseMetadata());
    expect(AcceptanceMetadataSchema.parse(acceptanceMetadata())).toEqual(acceptanceMetadata());
    expect(() =>
      ReleaseMetadataSchema.parse({
        ...releaseMetadata(),
        files: [{ path: '../escape', bytes: 1, sha256: 'f'.repeat(64) }],
      }),
    ).toThrow();
    expect(() =>
      AcceptanceMetadataSchema.parse({
        ...acceptanceMetadata(),
        overall: 'FAIL',
      }),
    ).toThrow();
  });

  it('derives the fixed unpacked ID from the committed public key only', () => {
    expect(extensionIdFromPublicKey(SOURCE_MANIFEST.key as string)).toBe(EXPECTED_EXTENSION_ID);
    expect(() => extensionIdFromPublicKey('not-base64')).toThrow('invalid_extension_public_key');
  });

  it('detects inventory size and hash drift', () => {
    const expected = inventory();
    expect(() => compareInventories(expected, inventory())).not.toThrow();
    expect(() => compareInventories(expected, expected.slice(0, 1))).toThrow(
      'release_inventory_mismatch',
    );
    expect(() =>
      compareInventories(expected, [
        { ...(expected[0] as InventoryFile), sha256: sha256('changed') },
        expected[1] as InventoryFile,
      ]),
    ).toThrow('release_inventory_mismatch');
  });
});
