import { createHash } from 'node:crypto';
import { lstatSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type BrowserContext, type Worker } from '@playwright/test';

import {
  AcceptanceMetadataSchema,
  EXPECTED_EXTENSION_ID,
  PRODUCTION_RELEASE_RUNTIME,
  assertNormalFile,
  assertSafeExistingPathChain,
  ensureNormalDirectoryChain,
  isPathWithin,
  pathEntryExists,
  validateReleaseId,
  verifyRelease,
  type AcceptanceMetadata,
  type ReleaseRuntime,
  type VerifiedRelease,
} from './dogfood-release.js';

const ACCEPTANCE_CACHE_ROOT = path.join(
  PRODUCTION_RELEASE_RUNTIME.worktreeRoot,
  'node_modules',
  '.cache',
  'shuhai-dogfood-acceptance',
);

export const ACCEPTANCE_WORKER_EXPRESSIONS = {
  serviceWorkerBundleHash: `(async () => {
    const response = await fetch(chrome.runtime.getURL('background/service-worker.js'), {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('service_worker_bundle_unavailable');
    const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
    return [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  })()`,
  bookmarkDigest: `(async () => {
    const tree = await new Promise((resolve, reject) => {
      chrome.bookmarks.getTree((nodes) => {
        if (chrome.runtime.lastError) {
          reject(new Error('bookmark_digest_unavailable'));
          return;
        }
        resolve(nodes);
      });
    });
    const rows = [];
    const visit = (nodes, parent = '') => {
      for (const node of nodes) {
        rows.push(
          JSON.stringify([parent, node.id, node.index ?? null, node.title, node.url ?? null]),
        );
        visit(node.children ?? [], node.id);
      }
    };
    visit(tree);
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(rows.join('\\n')),
    );
    return {
      digest: [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join(''),
      nodeCount: rows.length,
    };
  })()`,
  xPermissionGranted: `new Promise((resolve) => {
    chrome.permissions.contains({ origins: ['https://x.com/*'] }, (granted) => {
      resolve(!chrome.runtime.lastError && granted === true);
    });
  })`,
} as const;

export interface AcceptanceObservation {
  readonly chromiumVersion: string;
  readonly serviceWorkerSha256: string;
  readonly bookmarkBefore: { readonly digest: string; readonly nodeCount: number };
  readonly bookmarkAfter: { readonly digest: string; readonly nodeCount: number };
  readonly permissionBefore: boolean;
  readonly permissionAfter: boolean;
  readonly observedPageHttpRequests: number;
  readonly abortedPageHttpRequests: number;
  readonly unexpectedPageNetworkFailures: number;
  readonly consoleErrors: number;
  readonly pageErrors: number;
}

export type AcceptanceRunner = (
  release: VerifiedRelease,
  profileRoot: string,
) => Promise<AcceptanceObservation>;

export interface AcceptReleaseOptions {
  readonly runtime?: ReleaseRuntime;
  readonly cacheRoot?: string;
  readonly runAcceptance?: AcceptanceRunner;
}

function comparablePath(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function sha256(input: Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

async function extensionWorker(context: BrowserContext): Promise<Worker> {
  const existing = context
    .serviceWorkers()
    .find((worker) => new URL(worker.url()).host === EXPECTED_EXTENSION_ID);
  if (existing) return existing;
  return context.waitForEvent('serviceworker', {
    predicate: (worker) => new URL(worker.url()).host === EXPECTED_EXTENSION_ID,
    timeout: 15_000,
  });
}

async function serviceWorkerBundleHash(worker: Worker): Promise<string> {
  return worker.evaluate<string>(ACCEPTANCE_WORKER_EXPRESSIONS.serviceWorkerBundleHash);
}

async function bookmarkDigest(
  worker: Worker,
): Promise<{ readonly digest: string; readonly nodeCount: number }> {
  return worker.evaluate<{ readonly digest: string; readonly nodeCount: number }>(
    ACCEPTANCE_WORKER_EXPRESSIONS.bookmarkDigest,
  );
}

function xPermissionGranted(worker: Worker): Promise<boolean> {
  return worker.evaluate<boolean>(ACCEPTANCE_WORKER_EXPRESSIONS.xPermissionGranted);
}

export async function runChromiumAcceptance(
  release: VerifiedRelease,
  profileRoot: string,
): Promise<AcceptanceObservation> {
  const executablePath = chromium.executablePath();
  assertNormalFile(executablePath, 'playwright_chromium');
  if (lstatSync(executablePath).isSymbolicLink()) {
    throw new Error('playwright_chromium_redirect_rejected');
  }

  const expectedServiceWorker = release.metadata.files.find(
    (file) => file.path === 'background/service-worker.js',
  );
  if (!expectedServiceWorker) {
    throw new Error('release_service_worker_missing');
  }

  let context: BrowserContext | undefined;
  let contextClosed = false;
  let observedPageHttpRequests = 0;
  let abortedPageHttpRequests = 0;
  let unexpectedPageNetworkFailures = 0;
  let consoleErrors = 0;
  let pageErrors = 0;
  let chromiumVersion = 'unknown';
  let serviceWorkerSha256 = '';
  let bookmarkBefore = { digest: '', nodeCount: 0 };
  let bookmarkAfter = { digest: '', nodeCount: 0 };
  let permissionBefore = true;
  let permissionAfter = true;

  try {
    context = await chromium.launchPersistentContext(profileRoot, {
      executablePath,
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      offline: true,
      reducedMotion: 'reduce',
      viewport: { width: 420, height: 600 },
      args: [
        `--disable-extensions-except=${release.extensionRoot}`,
        `--load-extension=${release.extensionRoot}`,
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-domain-reliability',
        '--disable-sync',
        '--metrics-recording-only',
        '--no-first-run',
      ],
    });
    chromiumVersion = context.browser()?.version() ?? 'unknown';
    await context.route('**/*', async (route) => {
      if (!/^https?:/u.test(route.request().url())) {
        await route.continue();
        return;
      }
      observedPageHttpRequests += 1;
      try {
        await route.abort();
        abortedPageHttpRequests += 1;
      } catch {
        unexpectedPageNetworkFailures += 1;
      }
    });

    const worker = await extensionWorker(context);
    if (new URL(worker.url()).host !== EXPECTED_EXTENSION_ID) {
      throw new Error('acceptance_extension_id_mismatch');
    }
    serviceWorkerSha256 = await serviceWorkerBundleHash(worker);
    if (serviceWorkerSha256 !== expectedServiceWorker.sha256) {
      throw new Error('acceptance_service_worker_hash_mismatch');
    }

    bookmarkBefore = await bookmarkDigest(worker);
    permissionBefore = await xPermissionGranted(worker);
    if (permissionBefore) {
      throw new Error('acceptance_x_permission_pregranted');
    }

    const popup = await context.newPage();
    popup.on('console', (message) => {
      if (message.type() === 'error') consoleErrors += 1;
    });
    popup.on('pageerror', () => {
      pageErrors += 1;
    });
    await popup.goto(`chrome-extension://${EXPECTED_EXTENSION_ID}/popup/index.html`);
    await popup.getByText('ShuHai', { exact: true }).first().waitFor({
      state: 'visible',
      timeout: 10_000,
    });
    await popup.close();

    bookmarkAfter = await bookmarkDigest(worker);
    permissionAfter = await xPermissionGranted(worker);
    if (
      bookmarkBefore.digest !== bookmarkAfter.digest ||
      bookmarkBefore.nodeCount !== bookmarkAfter.nodeCount
    ) {
      throw new Error('acceptance_bookmark_digest_changed');
    }
    if (permissionAfter) {
      throw new Error('acceptance_x_permission_changed');
    }
    if (
      observedPageHttpRequests !== abortedPageHttpRequests ||
      unexpectedPageNetworkFailures !== 0 ||
      consoleErrors !== 0 ||
      pageErrors !== 0
    ) {
      throw new Error('acceptance_diagnostics_failed');
    }
  } finally {
    if (context) {
      await context.close();
      contextClosed = true;
    }
  }

  if (!contextClosed) {
    throw new Error('acceptance_context_not_closed');
  }
  return {
    chromiumVersion,
    serviceWorkerSha256,
    bookmarkBefore,
    bookmarkAfter,
    permissionBefore,
    permissionAfter,
    observedPageHttpRequests,
    abortedPageHttpRequests,
    unexpectedPageNetworkFailures,
    consoleErrors,
    pageErrors,
  };
}

function inventoryDigest(release: VerifiedRelease): string {
  return sha256(
    Buffer.from(
      JSON.stringify(release.metadata.files.map((file) => [file.path, file.bytes, file.sha256])),
    ),
  );
}

export async function acceptRelease(
  releaseIdInput: string,
  options: AcceptReleaseOptions = {},
): Promise<AcceptanceMetadata> {
  const runtime = options.runtime ?? PRODUCTION_RELEASE_RUNTIME;
  if (
    runtime.enforceCwd &&
    comparablePath(process.cwd()) !== comparablePath(runtime.worktreeRoot)
  ) {
    throw new Error('dogfood_wrong_worktree');
  }
  const releaseId = validateReleaseId(releaseIdInput);
  const release = verifyRelease(releaseId, { runtime });
  const acceptancePath = path.join(release.releaseRoot, 'acceptance.json');
  if (pathEntryExists(acceptancePath)) {
    throw new Error('release_acceptance_already_exists');
  }
  assertSafeExistingPathChain(runtime.releasesRoot, acceptancePath);

  const allowedCacheRoot = path.join(runtime.worktreeRoot, 'node_modules', '.cache');
  const cacheRoot =
    options.cacheRoot ??
    (runtime === PRODUCTION_RELEASE_RUNTIME
      ? ACCEPTANCE_CACHE_ROOT
      : path.join(allowedCacheRoot, 'shuhai-dogfood-acceptance'));
  if (!isPathWithin(allowedCacheRoot, cacheRoot, true)) {
    throw new Error('acceptance_cache_outside_worktree');
  }
  ensureNormalDirectoryChain(runtime.worktreeRoot, cacheRoot);
  const randomId = runtime.randomId().toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(randomId)
  ) {
    throw new Error('invalid_acceptance_random_id');
  }
  const runRoot = path.join(cacheRoot, `${releaseId}-${randomId}`);
  if (!isPathWithin(cacheRoot, runRoot) || pathEntryExists(runRoot)) {
    throw new Error('acceptance_run_root_conflict');
  }
  ensureNormalDirectoryChain(cacheRoot, runRoot);
  const profileRoot = path.join(runRoot, 'profile');
  if (!isPathWithin(runRoot, profileRoot) || pathEntryExists(profileRoot)) {
    throw new Error('acceptance_profile_conflict');
  }

  const observation = await (options.runAcceptance ?? runChromiumAcceptance)(release, profileRoot);
  const after = verifyRelease(releaseId, { runtime });
  const expectedServiceWorker = release.metadata.files.find(
    (file) => file.path === 'background/service-worker.js',
  );
  const actualServiceWorker = after.metadata.files.find(
    (file) => file.path === 'background/service-worker.js',
  );
  if (
    !expectedServiceWorker ||
    !actualServiceWorker ||
    actualServiceWorker.sha256 !== expectedServiceWorker.sha256 ||
    observation.serviceWorkerSha256 !== expectedServiceWorker.sha256 ||
    inventoryDigest(after) !== inventoryDigest(release)
  ) {
    throw new Error('acceptance_release_changed');
  }

  const acceptance = {
    schemaVersion: 1,
    releaseId,
    acceptedAt: runtime.now(),
    sourceCommit: release.metadata.sourceCommit,
    extensionId: EXPECTED_EXTENSION_ID,
    chromiumVersion: observation.chromiumVersion,
    serviceWorkerSha256: observation.serviceWorkerSha256,
    profileKind: 'fresh-project-owned',
    offline: true,
    bookmarkDigest: {
      before: observation.bookmarkBefore.digest,
      after: observation.bookmarkAfter.digest,
      nodeCountBefore: observation.bookmarkBefore.nodeCount,
      nodeCountAfter: observation.bookmarkAfter.nodeCount,
      unchanged: true,
    },
    xPermission: {
      before: observation.permissionBefore,
      after: observation.permissionAfter,
    },
    network: {
      observedPageHttpRequests: observation.observedPageHttpRequests,
      abortedPageHttpRequests: observation.abortedPageHttpRequests,
      unexpectedPageNetworkFailures: observation.unexpectedPageNetworkFailures,
    },
    diagnostics: {
      consoleErrors: observation.consoleErrors,
      pageErrors: observation.pageErrors,
    },
    overall: 'PASS',
  };
  const validatedAcceptance = AcceptanceMetadataSchema.parse(acceptance);
  writeFileSync(acceptancePath, `${JSON.stringify(validatedAcceptance, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  verifyRelease(releaseId, { requireAcceptance: true, runtime });
  return validatedAcceptance;
}

export function parseAcceptanceCliArguments(args: readonly string[]): string {
  if (args.length !== 1) {
    throw new Error('invalid_cli_arguments');
  }
  return validateReleaseId(args[0] as string);
}

async function main(): Promise<void> {
  const releaseId = parseAcceptanceCliArguments(process.argv.slice(2));
  const acceptance = await acceptRelease(releaseId);
  console.log(`DOGFOOD_RELEASE_ACCEPTED ${acceptance.releaseId}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && comparablePath(invokedPath) === comparablePath(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'dogfood_acceptance_failed');
    process.exitCode = 1;
  });
}
