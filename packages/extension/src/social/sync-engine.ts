import {
  makeSyncRecordKey,
  parseSocialItem,
  type SocialItem,
  type SyncJob,
  type SyncJobItem,
  type SyncRecord,
  type WriteIntent,
  type WriteOutcome,
} from './sync-schema.js';
import type {
  CommitWriteIntentResult,
  ListWriteIntentsOptions,
  PutWriteIntentInput,
} from './sync-store.js';
import {
  MAX_FRONTMATTER_BYTES,
  parseSyncFrontmatter,
  renderSafeSocialMarkdown,
} from '../vault/safe-markdown.js';
import { buildSafeVaultPath } from '../vault/vault-index.js';
import {
  readVaultTextPrefix,
  writeVaultFileSafely,
  type VaultFileOutcome,
} from '../utils/vault-writer.js';

export interface SyncEngineStorePort {
  getJob(jobId: string): Promise<SyncJob | undefined>;
  getJobItem(jobId: string, sourceItemId: string): Promise<SyncJobItem | undefined>;
  getRecordByKey(recordKey: string): Promise<SyncRecord | undefined>;
  putWriteIntent(input: PutWriteIntentInput): Promise<WriteIntent>;
  listWriteIntents(options?: ListWriteIntentsOptions): Promise<WriteIntent[]>;
  commitWriteIntent(
    intentId: string,
    outcome: unknown,
    committedAt?: string,
  ): Promise<CommitWriteIntentResult>;
}

export interface PreparedSyncContent {
  pathSegments: string[];
  markdown: string;
}

export interface SyncMarkdownIdentity {
  source: SocialItem['source'];
  sourceItemId: string;
  canonicalUrl: string;
  contentHash: string;
  completeness: SocialItem['completeness'];
  extractorVersion: number;
}

export interface SyncEngineContentPort {
  parseItem(input: unknown): SocialItem;
  prepare(item: SocialItem, directoryPrefix: string, fileToken?: string): PreparedSyncContent;
  parseIdentity(markdownPrefix: string): SyncMarkdownIdentity;
}

export interface SyncEngineWriterPort {
  write(pathSegments: readonly string[], markdown: string): Promise<VaultFileOutcome>;
  readPrefix(pathSegments: readonly string[], maxBytes: number): Promise<string | null>;
}

export interface SyncEngineResult {
  outcome: WriteOutcome;
  reconciled: boolean;
  intentPending: boolean;
  diagnostic?: string;
}

export interface SyncEngineOptions {
  now?: () => Date;
  randomId?: () => string;
  frontmatterReadLimit?: number;
}

const DEFAULT_FRONTMATTER_READ_LIMIT = 8 * 1024;

export const defaultSyncContentPort: SyncEngineContentPort = {
  parseItem: parseSocialItem,
  prepare: (item, directoryPrefix, fileToken) => ({
    pathSegments: buildSafeVaultPath(item, directoryPrefix, fileToken),
    markdown: renderSafeSocialMarkdown(item),
  }),
  parseIdentity: (markdownPrefix) => {
    const parsed = parseSyncFrontmatter(markdownPrefix);
    if (!parsed.ok) {
      throw new Error(`${parsed.code}: ${parsed.error}`);
    }
    return parsed.properties;
  },
};

export function createVaultWriterPort(handle: FileSystemDirectoryHandle): SyncEngineWriterPort {
  return {
    write: (pathSegments, markdown) => writeVaultFileSafely(handle, pathSegments, markdown),
    readPrefix: (pathSegments, maxBytes) => readVaultTextPrefix(handle, pathSegments, maxBytes),
  };
}

function safeDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown sync engine error';
  return message.slice(0, 500);
}

function intentIdentityMatches(identity: SyncMarkdownIdentity, intent: WriteIntent): boolean {
  return (
    identity.source === intent.source &&
    identity.sourceItemId === intent.sourceItemId &&
    identity.canonicalUrl === intent.canonicalUrl &&
    identity.contentHash === intent.contentHash &&
    identity.completeness === intent.completeness &&
    identity.extractorVersion === intent.extractorVersion
  );
}

function intentMatchesSocialItem(intent: WriteIntent, item: SocialItem): boolean {
  return (
    intent.source === item.source &&
    intent.sourceItemId === item.sourceItemId &&
    intent.canonicalUrl === item.canonicalUrl &&
    intent.contentHash === item.contentHash &&
    intent.completeness === item.completeness &&
    intent.extractorVersion === item.extractorVersion
  );
}

function recordIdentityMatches(identity: SyncMarkdownIdentity, record: SyncRecord): boolean {
  return (
    identity.source === record.source &&
    identity.sourceItemId === record.sourceItemId &&
    identity.canonicalUrl === record.canonicalUrl &&
    identity.contentHash === record.contentHash &&
    identity.completeness === record.completeness &&
    identity.extractorVersion === record.extractorVersion
  );
}

function recordSourceIdentityMatches(identity: SyncMarkdownIdentity, record: SyncRecord): boolean {
  return (
    identity.source === record.source &&
    identity.sourceItemId === record.sourceItemId &&
    identity.canonicalUrl === record.canonicalUrl
  );
}

function sameSocialItem(left: SocialItem, right: SocialItem): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pendingResult(intent: WriteIntent, code: string, diagnostic?: string): SyncEngineResult {
  return {
    outcome: { status: 'error', relativePath: intent.relativePath, code },
    reconciled: false,
    intentPending: true,
    ...(diagnostic ? { diagnostic } : {}),
  };
}

export class SyncEngine {
  private readonly now: () => Date;
  private readonly randomId: () => string;
  private readonly frontmatterReadLimit: number;

  constructor(
    private readonly store: SyncEngineStorePort,
    private readonly writer: SyncEngineWriterPort,
    private readonly content: SyncEngineContentPort = defaultSyncContentPort,
    options: SyncEngineOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.randomId = options.randomId ?? (() => crypto.randomUUID());
    this.frontmatterReadLimit = options.frontmatterReadLimit ?? DEFAULT_FRONTMATTER_READ_LIMIT;
    if (
      !Number.isSafeInteger(this.frontmatterReadLimit) ||
      this.frontmatterReadLimit < 1 ||
      this.frontmatterReadLimit > MAX_FRONTMATTER_BYTES
    ) {
      throw new RangeError(
        `frontmatterReadLimit must be an integer from 1 to ${MAX_FRONTMATTER_BYTES}`,
      );
    }
  }

  async writeItem(
    jobId: string,
    input: unknown,
    directoryPrefix: string,
  ): Promise<SyncEngineResult> {
    const job = await this.store.getJob(jobId);
    if (!job) {
      throw new Error('Sync job was not found');
    }
    if (job.status !== 'writing') {
      throw new Error('Sync job is not in the writing state');
    }

    const parsedItem = this.content.parseItem(input);
    if (parsedItem.source !== job.source) {
      throw new Error('Social item source does not match the sync job');
    }
    const persistedJobItem = await this.store.getJobItem(jobId, parsedItem.sourceItemId);
    if (!persistedJobItem) {
      throw new Error('Social item was not persisted in the sync job');
    }
    if (!sameSocialItem(persistedJobItem.item, parsedItem)) {
      throw new Error('Social item does not match the persisted sync job item');
    }
    if (
      job.authorizedReviewRevision === undefined ||
      job.authorizedReviewRevision !== job.reviewRevision ||
      persistedJobItem.reviewDecision !== 'selected' ||
      persistedJobItem.reviewRevision !== job.authorizedReviewRevision ||
      persistedJobItem.classification !== 'new'
    ) {
      throw new Error('Social item is not covered by the persisted review authorization');
    }
    const item = persistedJobItem.item;
    const recordKey = makeSyncRecordKey(item.source, item.sourceItemId);
    const existingRecord = await this.store.getRecordByKey(recordKey);
    if (persistedJobItem.outcome && persistedJobItem.outcome.status !== 'error') {
      if (
        (persistedJobItem.outcome.status === 'created' ||
          persistedJobItem.outcome.status === 'already_exists') &&
        !existingRecord
      ) {
        throw new Error('Committed sync item is missing its catalog record');
      }
      return {
        outcome: persistedJobItem.outcome,
        reconciled: false,
        intentPending: false,
      };
    }
    const pendingIntents = (await this.store.listWriteIntents({ jobId })).filter(
      (intent) => intent.sourceItemId === item.sourceItemId,
    );
    if (pendingIntents.length > 1) {
      throw new Error('Multiple pending write intents exist for the same sync item');
    }
    const pendingIntent = pendingIntents[0];
    if (pendingIntent) {
      if (
        (existingRecord !== undefined &&
          pendingIntent.relativePath !== existingRecord.relativePath) ||
        !intentMatchesSocialItem(pendingIntent, item) ||
        pendingIntent.reviewRevision !== job.authorizedReviewRevision
      ) {
        throw new Error('Pending write intent does not match the persisted sync item');
      }
      const reconciliation = await this.reconcileIntent(pendingIntent);
      if (!reconciliation.intentPending) {
        return reconciliation;
      }
      if (
        reconciliation.outcome.status !== 'error' ||
        reconciliation.outcome.code !== 'vault_file_missing'
      ) {
        return reconciliation;
      }
      if (existingRecord) {
        return this.resolveCatalogHit(pendingIntent, existingRecord);
      }
      const resumedContent = this.content.prepare(item, directoryPrefix, pendingIntent.id);
      return this.writePreparedIntent(pendingIntent, {
        ...resumedContent,
        pathSegments: pendingIntent.relativePath.split('/'),
      });
    }

    const intentId = this.randomId();
    const prepared = existingRecord
      ? undefined
      : this.content.prepare(item, directoryPrefix, intentId);
    const retryPath =
      persistedJobItem.outcome?.status === 'error'
        ? persistedJobItem.outcome.relativePath
        : undefined;
    const relativePath =
      existingRecord?.relativePath ?? retryPath ?? prepared!.pathSegments.join('/');
    const intent = await this.store.putWriteIntent({
      id: intentId,
      jobId,
      sourceItemId: item.sourceItemId,
      relativePath,
      reviewRevision: job.authorizedReviewRevision,
      createdAt: this.now().toISOString(),
    });

    if (existingRecord) {
      return this.resolveCatalogHit(intent, existingRecord);
    }

    return this.writePreparedIntent(intent, {
      ...prepared!,
      pathSegments: intent.relativePath.split('/'),
    });
  }

  private async writePreparedIntent(
    intent: WriteIntent,
    prepared: PreparedSyncContent,
  ): Promise<SyncEngineResult> {
    await this.assertIntentAuthorized(intent);
    let writerResult: VaultFileOutcome;
    try {
      writerResult = await this.writer.write(prepared!.pathSegments, prepared!.markdown);
    } catch (error) {
      const outcome: WriteOutcome = {
        status: 'error',
        relativePath: intent.relativePath,
        code: 'vault_exception',
      };
      await this.commitIntent(intent, outcome);
      return {
        outcome,
        reconciled: false,
        intentPending: false,
        diagnostic: safeDiagnostic(error),
      };
    }

    if (writerResult.relativePath !== intent.relativePath) {
      const outcome: WriteOutcome = {
        status: 'error',
        relativePath: intent.relativePath,
        code: 'writer_path_mismatch',
      };
      await this.commitIntent(intent, outcome);
      return { outcome, reconciled: false, intentPending: false };
    }

    if (writerResult.status === 'created') {
      const outcome: WriteOutcome = {
        status: 'created',
        relativePath: intent.relativePath,
        bytes: new TextEncoder().encode(prepared!.markdown).byteLength,
      };
      await this.commitIntent(intent, outcome);
      return { outcome, reconciled: false, intentPending: false };
    }

    if (writerResult.status === 'already_exists') {
      return this.reconcileIntent(intent);
    }

    const outcome: WriteOutcome =
      writerResult.status === 'skipped'
        ? {
            status: 'skipped',
            relativePath: intent.relativePath,
            reason: 'writer_skipped',
          }
        : {
            status: 'error',
            relativePath: intent.relativePath,
            code: writerResult.errorCode ?? 'vault_error',
          };
    await this.commitIntent(intent, outcome);
    return {
      outcome,
      reconciled: false,
      intentPending: false,
      ...(writerResult.error ? { diagnostic: writerResult.error.slice(0, 500) } : {}),
    };
  }

  async reconcilePendingIntents(jobId?: string): Promise<SyncEngineResult[]> {
    const intents = await this.store.listWriteIntents(jobId ? { jobId } : {});
    const results: SyncEngineResult[] = [];
    for (const intent of intents) {
      results.push(await this.reconcileIntent(intent));
    }
    return results;
  }

  private async resolveCatalogHit(
    intent: WriteIntent,
    record: SyncRecord,
  ): Promise<SyncEngineResult> {
    await this.assertIntentAuthorized(intent);
    if (
      record.canonicalUrl !== intent.canonicalUrl ||
      record.contentHash !== intent.contentHash ||
      record.completeness !== intent.completeness ||
      record.extractorVersion !== intent.extractorVersion
    ) {
      const outcome: WriteOutcome = {
        status: 'skipped',
        relativePath: intent.relativePath,
        reason: 'content_changed',
      };
      await this.commitIntent(intent, outcome);
      return { outcome, reconciled: false, intentPending: false };
    }

    let markdownPrefix: string | null;
    try {
      markdownPrefix = await this.writer.readPrefix(
        intent.relativePath.split('/'),
        this.frontmatterReadLimit,
      );
    } catch (error) {
      const outcome: WriteOutcome = {
        status: 'error',
        relativePath: intent.relativePath,
        code: 'vault_read_failed',
      };
      await this.commitIntent(intent, outcome);
      return {
        outcome,
        reconciled: false,
        intentPending: false,
        diagnostic: safeDiagnostic(error),
      };
    }

    if (markdownPrefix === null) {
      const outcome: WriteOutcome = {
        status: 'error',
        relativePath: intent.relativePath,
        code: 'catalog_orphan',
      };
      await this.commitIntent(intent, outcome);
      return { outcome, reconciled: false, intentPending: false };
    }

    let identity: SyncMarkdownIdentity;
    try {
      identity = this.content.parseIdentity(markdownPrefix);
    } catch (error) {
      const outcome: WriteOutcome = {
        status: 'error',
        relativePath: intent.relativePath,
        code: 'catalog_conflict',
      };
      await this.commitIntent(intent, outcome);
      return {
        outcome,
        reconciled: false,
        intentPending: false,
        diagnostic: safeDiagnostic(error),
      };
    }

    const outcome: WriteOutcome = !recordSourceIdentityMatches(identity, record)
      ? { status: 'error', relativePath: intent.relativePath, code: 'catalog_conflict' }
      : !recordIdentityMatches(identity, record)
        ? { status: 'skipped', relativePath: intent.relativePath, reason: 'content_changed' }
        : { status: 'already_exists', relativePath: intent.relativePath };
    await this.commitIntent(intent, outcome);
    return { outcome, reconciled: false, intentPending: false };
  }

  private async reconcileIntent(intent: WriteIntent): Promise<SyncEngineResult> {
    await this.assertIntentAuthorized(intent);
    let markdownPrefix: string | null;
    try {
      markdownPrefix = await this.writer.readPrefix(
        intent.relativePath.split('/'),
        this.frontmatterReadLimit,
      );
    } catch (error) {
      return pendingResult(intent, 'vault_read_failed', safeDiagnostic(error));
    }

    if (markdownPrefix === null) {
      return pendingResult(intent, 'vault_file_missing');
    }

    let identity: SyncMarkdownIdentity;
    try {
      identity = this.content.parseIdentity(markdownPrefix);
    } catch (error) {
      const outcome: WriteOutcome = {
        status: 'error',
        relativePath: intent.relativePath,
        code: 'path_conflict',
      };
      await this.commitIntent(intent, outcome);
      return {
        outcome,
        reconciled: true,
        intentPending: false,
        diagnostic: safeDiagnostic(error),
      };
    }

    if (!intentIdentityMatches(identity, intent)) {
      const outcome: WriteOutcome = {
        status: 'error',
        relativePath: intent.relativePath,
        code: 'path_conflict',
      };
      await this.commitIntent(intent, outcome);
      return { outcome, reconciled: true, intentPending: false };
    }

    const outcome: WriteOutcome = {
      status: 'already_exists',
      relativePath: intent.relativePath,
    };
    await this.commitIntent(intent, outcome);
    return { outcome, reconciled: true, intentPending: false };
  }

  private async commitIntent(intent: WriteIntent, outcome: WriteOutcome): Promise<void> {
    await this.store.commitWriteIntent(intent.id, outcome, this.now().toISOString());
  }

  private async assertIntentAuthorized(intent: WriteIntent): Promise<void> {
    const [job, item] = await Promise.all([
      this.store.getJob(intent.jobId),
      this.store.getJobItem(intent.jobId, intent.sourceItemId),
    ]);
    if (!job || !item) {
      throw new Error('Write intent authorization state was not found');
    }
    if (
      job.status !== 'writing' ||
      job.authorizedReviewRevision !== intent.reviewRevision ||
      job.reviewRevision !== intent.reviewRevision ||
      item.reviewDecision !== 'selected' ||
      item.reviewRevision !== intent.reviewRevision ||
      item.classification !== 'new' ||
      !intentMatchesSocialItem(intent, item.item)
    ) {
      throw new Error('Write intent is not covered by the persisted review authorization');
    }
  }
}

export function createVaultSyncEngine(
  store: SyncEngineStorePort,
  handle: FileSystemDirectoryHandle,
  options: SyncEngineOptions = {},
): SyncEngine {
  return new SyncEngine(store, createVaultWriterPort(handle), defaultSyncContentPort, options);
}
