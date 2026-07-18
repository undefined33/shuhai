import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookmarkOperation } from '../src/shared/bookmark-types.js';
import {
  BOOKMARK_OPERATION_MAX_BYTES,
  BOOKMARK_OPERATION_RESERVE_BASE_BYTES,
  BOOKMARK_OPERATION_RESERVE_ITEM_BYTES,
  createBookmarkExecutionPayloadIdentity,
  parseBookmarkOperationJournalEnvelope,
  summarizeBookmarkOperationItems,
} from '../src/shared/bookmark-types.js';
import {
  AI_PROVIDER_SECRETS_KEY,
  AI_PUBLIC_SETTINGS_VERSION,
  BOOKMARK_OPERATIONS_KEY,
  DEFAULT_SETTINGS,
  LEGACY_PENDING_MAX_BYTES,
  PENDING_CAPTURE_KEY,
  SETTINGS_KEY,
  URL_HEALTH_RECORDS_KEY,
  BookmarkOperationStorageError,
  clearLegacyPendingCapture,
  discardLegacyAiConfiguration,
  getAiProviderSecretForUse,
  getBookmarkOperationJournal,
  getBookmarkOperationReserveBytes,
  getOnboarded,
  getSettings,
  getUrlHealthRecords,
  inspectLegacyPendingCapture,
  insertBookmarkOperation,
  pruneBookmarkOperations,
  saveSettings,
  saveBookmarkOperation,
  saveBookmarkOperationJournal,
  saveOnboarded,
  saveUrlHealthRecords,
  setAiProviderSecret,
  setLocalValues,
} from '../src/utils/storage.js';
import {
  getStorageMocks,
  getStorageSnapshot,
  setRuntimeLastError,
  setStorageSnapshot,
} from './setup.js';

async function preparedOperation(suffix: string): Promise<BookmarkOperation> {
  const timestamp = new Date(0).toISOString();
  const requestId = `request-${suffix}`;
  const bookmarkId = `bookmark-${suffix}`;
  const payloadIdentity = await createBookmarkExecutionPayloadIdentity(
    'update_bookmark_urls',
    [{ id: bookmarkId, url: `https://example.com/${suffix}/new` }],
    'manual',
  );
  const items: BookmarkOperation['items'] = [
    {
      kind: 'update_url',
      bookmarkId,
      title: `Bookmark ${suffix}`,
      original: {
        title: `Bookmark ${suffix}`,
        url: `https://example.com/${suffix}/old`,
        parentId: 'parent-1',
        index: 0,
      },
      oldUrl: `https://example.com/${suffix}/old`,
      newUrl: `https://example.com/${suffix}/new`,
      executionStatus: 'pending',
      restoreStatus: 'not_needed',
      executionAttemptCount: 0,
      restoreAttemptCount: 0,
    },
  ];
  return {
    id: `operation-${suffix}`,
    requestId,
    payloadIdentity,
    version: 1,
    type: 'update_bookmark_urls',
    status: 'prepared',
    source: 'manual',
    createdAt: timestamp,
    updatedAt: timestamp,
    requestedCount: items.length,
    items,
    summary: summarizeBookmarkOperationItems(items),
    commands: [
      {
        requestId,
        action: 'execute',
        payloadIdentity,
        status: 'pending',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };
}

async function preparedMoveOperation(suffix: string): Promise<BookmarkOperation> {
  const timestamp = new Date(0).toISOString();
  const requestId = `move-request-${suffix}`;
  const bookmarkId = `move-bookmark-${suffix}`;
  const targetFolder = 'Target';
  const payloadIdentity = await createBookmarkExecutionPayloadIdentity(
    'move_bookmarks',
    [{ bookmarkId, targetFolder }],
    'classification',
  );
  const items: BookmarkOperation['items'] = [
    {
      kind: 'move',
      bookmarkId,
      title: `Move ${suffix}`,
      original: {
        title: `Move ${suffix}`,
        url: `https://example.com/${suffix}`,
        parentId: 'parent-1',
        index: 0,
      },
      targetFolder,
      targetStatus: 'pending',
      folderResolution: [],
      executionStatus: 'pending',
      restoreStatus: 'not_needed',
      executionAttemptCount: 0,
      restoreAttemptCount: 0,
    },
  ];
  return {
    id: `move-operation-${suffix}`,
    requestId,
    payloadIdentity,
    version: 1,
    type: 'move_bookmarks',
    status: 'prepared',
    source: 'classification',
    createdAt: timestamp,
    updatedAt: timestamp,
    requestedCount: items.length,
    items,
    summary: summarizeBookmarkOperationItems(items),
    commands: [
      {
        requestId,
        action: 'execute',
        payloadIdentity,
        status: 'pending',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };
}

function operationReserve(operation: BookmarkOperation): number {
  return getBookmarkOperationReserveBytes(operation);
}

describe('storage helpers', () => {
  it('defaults onboarding to false', async () => {
    await expect(getOnboarded()).resolves.toBe(false);
  });

  it('persists onboarding state', async () => {
    await saveOnboarded(true);

    expect(getStorageSnapshot()).toMatchObject({
      onboarded: true,
    });
    await expect(getOnboarded()).resolves.toBe(true);
  });

  it('stores URL health records', async () => {
    await saveUrlHealthRecords([
      {
        bookmarkId: '1',
        bookmarkTitle: 'Missing',
        bookmarkUrl: 'https://example.com/missing',
        checkedAt: new Date(0).toISOString(),
        durationMs: 12,
        httpStatus: 404,
        parentPath: 'Bookmarks Bar',
        status: 'dead',
      },
    ]);

    await expect(getUrlHealthRecords()).resolves.toEqual([
      expect.objectContaining({ bookmarkId: '1', status: 'dead' }),
    ]);
  });

  it('omits malformed historical health records without rewriting trusted storage', async () => {
    const validRecord = {
      bookmarkId: 'valid-1',
      bookmarkTitle: 'Valid old result',
      bookmarkUrl: 'https://example.com/valid',
      checkedAt: new Date(0).toISOString(),
      durationMs: 12,
      httpStatus: 404,
      parentPath: 'Bookmarks Bar',
      status: 'dead',
    };
    const rawRecords = [
      validRecord,
      { ...validRecord, bookmarkId: 'invalid-status', status: 'unknown' },
      {
        ...validRecord,
        bookmarkId: 'invalid-url',
        bookmarkUrl: 'javascript:alert(1)',
      },
    ];
    setStorageSnapshot({ [URL_HEALTH_RECORDS_KEY]: rawRecords });
    const before = getStorageSnapshot();

    await expect(getUrlHealthRecords()).resolves.toEqual([
      validRecord,
      expect.objectContaining({
        bookmarkId: 'invalid-url',
        bookmarkUrl: 'javascript:alert(1)',
      }),
    ]);
    expect(getStorageSnapshot()).toEqual(before);
    expect(getStorageMocks().set).not.toHaveBeenCalled();
    expect(getStorageMocks().remove).not.toHaveBeenCalled();
  });

  it('migrates one valid legacy DeepSeek key into the isolated secret envelope', async () => {
    await setLocalValues({
      [SETTINGS_KEY]: {
        deepSeekApiKey: 'legacy-key',
        deepSeekModel: 'deepseek-reasoner',
        useAi: true,
        defaultClassifyMode: 'full',
        exportDirectory: 'Knowledge',
      },
    });

    const settings = await getSettings();
    expect(settings).toMatchObject({
      useAi: true,
      activeProviderId: 'deepseek-default',
      defaultClassifyMode: 'full',
      exportDirectory: 'Knowledge',
      aiProviders: [
        expect.objectContaining({
          id: 'deepseek-default',
          provider: 'deepseek',
          hasApiKey: true,
          model: 'deepseek-reasoner',
        }),
        expect.objectContaining({ provider: 'kimi' }),
        expect.objectContaining({ provider: 'glm' }),
      ],
    });
    expect(JSON.stringify(settings)).not.toContain('legacy-key');
    expect(JSON.stringify(settings)).not.toContain('baseUrl');
    await expect(getAiProviderSecretForUse('deepseek')).resolves.toEqual({
      provider: 'deepseek',
      origin: 'https://api.deepseek.com',
      apiKey: 'legacy-key',
    });

    const snapshot = getStorageSnapshot();
    expect(snapshot[SETTINGS_KEY]).toMatchObject({
      version: AI_PUBLIC_SETTINGS_VERSION,
      settings: {
        activeProviderId: 'deepseek-default',
      },
    });
    expect(JSON.stringify(snapshot[SETTINGS_KEY])).not.toContain('legacy-key');
    expect(snapshot[AI_PROVIDER_SECRETS_KEY]).toEqual({
      version: 1,
      providers: [
        {
          provider: 'deepseek',
          origin: 'https://api.deepseek.com',
          apiKey: 'legacy-key',
        },
      ],
    });
  });

  it('quarantines duplicate built-in and custom legacy keys until explicit discard', async () => {
    const legacy = {
      useAi: true,
      exportDirectory: 'Knowledge',
      aiProviders: [
        {
          id: 'legacy-deepseek-a',
          name: 'DeepSeek A',
          provider: 'deepseek',
          enabled: true,
          apiKey: 'legacy-a',
          baseUrl: 'https://attacker.invalid',
          model: 'deepseek-reasoner',
        },
        {
          id: 'legacy-deepseek-b',
          name: 'DeepSeek B',
          provider: 'deepseek',
          enabled: true,
          apiKey: 'legacy-b',
          baseUrl: 'https://api.deepseek.com',
          model: 'deepseek-reasoner',
        },
        {
          id: 'legacy-custom',
          name: 'Custom',
          provider: 'openai-compatible',
          enabled: true,
          apiKey: 'custom-secret',
          baseUrl: 'https://custom.invalid',
          model: 'custom-model',
        },
      ],
    };
    setStorageSnapshot({ [SETTINGS_KEY]: legacy });

    const quarantined = await getSettings();
    expect(quarantined.useAi).toBe(false);
    expect(quarantined.aiLegacySummary).toEqual({
      builtInConflicts: ['deepseek'],
      customState: 'conflict_has_key',
    });
    expect(quarantined.aiProviders.every((provider) => !provider.hasApiKey)).toBe(true);
    expect(getStorageSnapshot()).toEqual({ [SETTINGS_KEY]: legacy });
    await expect(saveSettings(quarantined)).rejects.toThrow('legacy_ai_config_conflict');
    expect(getStorageSnapshot()).toEqual({ [SETTINGS_KEY]: legacy });

    const discarded = await discardLegacyAiConfiguration();
    expect(discarded.useAi).toBe(false);
    expect(discarded.exportDirectory).toBe('Knowledge');
    expect(discarded.aiLegacySummary).toEqual({
      builtInConflicts: [],
      customState: 'absent',
    });
    const persisted = getStorageSnapshot();
    expect(JSON.stringify(persisted[SETTINGS_KEY])).not.toMatch(
      /legacy-a|legacy-b|custom-secret|attacker|custom\.invalid/u,
    );
    expect(persisted).not.toHaveProperty(AI_PROVIDER_SECRETS_KEY);
  });

  it('does not overwrite a corrupt secret envelope through public reads or secret writes', async () => {
    const corruptSecrets = {
      version: 1,
      providers: [
        {
          provider: 'deepseek',
          origin: 'https://attacker.invalid',
          apiKey: 'private-existing-key',
        },
      ],
    };
    setStorageSnapshot({
      [SETTINGS_KEY]: {
        version: AI_PUBLIC_SETTINGS_VERSION,
        settings: structuredClone(DEFAULT_SETTINGS),
      },
      [AI_PROVIDER_SECRETS_KEY]: corruptSecrets,
    });

    const settings = await getSettings();
    expect(settings.aiProviders.every((provider) => !provider.hasApiKey)).toBe(true);
    expect(JSON.stringify(settings)).not.toContain('private-existing-key');
    await expect(setAiProviderSecret('deepseek', 'replacement-key')).rejects.toThrow(
      'secret_unavailable',
    );
    expect(getStorageSnapshot()[AI_PROVIDER_SECRETS_KEY]).toEqual(corruptSecrets);
  });

  it('inspects bounded legacy pending data without exposing its content', async () => {
    const legacyCapture = {
      id: 'legacy-1',
      source: 'article',
      title: 'private title',
      url: 'https://private.example/path?token=secret',
      text: 'private body',
      media: [],
      tags: ['private'],
      capturedAt: new Date(0).toISOString(),
    };

    await expect(inspectLegacyPendingCapture()).resolves.toEqual({
      present: false,
      count: 0,
      approximateBytes: 0,
      state: 'absent',
    });

    setStorageSnapshot({ [PENDING_CAPTURE_KEY]: legacyCapture });
    const single = await inspectLegacyPendingCapture();
    expect(single).toMatchObject({ present: true, count: 1, state: 'valid' });
    expect(JSON.stringify(single)).not.toMatch(/private|https?:|token|body/u);

    setStorageSnapshot({
      [PENDING_CAPTURE_KEY]: Array.from({ length: 20 }, (_, index) => ({
        ...legacyCapture,
        id: `legacy-${index}`,
      })),
    });
    await expect(inspectLegacyPendingCapture()).resolves.toMatchObject({
      present: true,
      count: 20,
      state: 'valid',
    });

    setStorageSnapshot({
      [PENDING_CAPTURE_KEY]: Array.from({ length: 21 }, (_, index) => ({
        ...legacyCapture,
        id: `legacy-${index}`,
      })),
    });
    await expect(inspectLegacyPendingCapture()).resolves.toMatchObject({
      present: true,
      count: null,
      state: 'invalid',
    });
  });

  it('does not read legacy pending content after the byte preflight is over budget', async () => {
    getStorageMocks().getBytesInUse.mockImplementationOnce(
      (_key: string, callback: (bytes: number) => void) => callback(LEGACY_PENDING_MAX_BYTES + 1),
    );

    await expect(inspectLegacyPendingCapture()).resolves.toEqual({
      present: true,
      count: null,
      approximateBytes: LEGACY_PENDING_MAX_BYTES + 1,
      state: 'oversize',
    });
    expect(getStorageMocks().get).not.toHaveBeenCalled();
  });

  it('treats accessor-bearing legacy pending data as invalid without rewriting it', async () => {
    const getter = vi.fn(() => 'private title');
    const capture = {
      id: 'legacy-accessor',
      source: 'article',
      url: 'https://private.example',
      text: 'private body',
      media: [],
      tags: [],
      capturedAt: new Date(0).toISOString(),
    };
    Object.defineProperty(capture, 'title', { enumerable: true, get: getter });
    getStorageMocks().getBytesInUse.mockImplementationOnce(
      (_key: string, callback: (bytes: number) => void) => callback(128),
    );
    getStorageMocks().get.mockImplementationOnce(
      (_key: string, callback: (value: Record<string, unknown>) => void) =>
        callback({ [PENDING_CAPTURE_KEY]: capture }),
    );

    await expect(inspectLegacyPendingCapture()).resolves.toMatchObject({
      present: true,
      count: null,
      state: 'invalid',
    });
    expect(getter).not.toHaveBeenCalled();
    expect(getStorageMocks().set).not.toHaveBeenCalled();
    expect(getStorageMocks().remove).not.toHaveBeenCalled();
  });

  it('clears only the legacy pending key after explicit confirmation at the message boundary', async () => {
    setStorageSnapshot({
      [PENDING_CAPTURE_KEY]: { private: 'legacy' },
      unrelated: 'preserve',
    });

    await clearLegacyPendingCapture();

    expect(getStorageSnapshot()).toEqual({ unrelated: 'preserve' });
    expect(getStorageMocks().remove).toHaveBeenCalledWith(
      [PENDING_CAPTURE_KEY],
      expect.any(Function),
    );
  });

  it('initializes only a missing bookmark journal key', async () => {
    await expect(getBookmarkOperationJournal()).resolves.toEqual({
      version: 1,
      revision: 0,
      operations: [],
    });
    expect(getStorageMocks().set).not.toHaveBeenCalled();
  });

  it('maps synchronous journal storage failures to stable error codes', async () => {
    getStorageMocks().get.mockImplementationOnce(() => {
      throw new Error('context invalidated');
    });
    await expect(getBookmarkOperationJournal()).rejects.toMatchObject({
      code: 'storage_read_failed',
    });

    const operation = await preparedOperation('sync-write-error');
    getStorageMocks().set.mockImplementationOnce(() => {
      throw new Error('context invalidated');
    });
    await expect(
      insertBookmarkOperation(operation, operationReserve(operation)),
    ).rejects.toMatchObject({
      code: 'storage_write_failed',
    });
  });

  it.each([
    null,
    [],
    { version: 2, revision: 0, operations: [] },
    { version: 1, revision: 0, operations: [], unknown: true },
  ])('fails closed for a present corrupt journal %#', async (value) => {
    setStorageSnapshot({ [BOOKMARK_OPERATIONS_KEY]: value });

    await expect(getBookmarkOperationJournal()).rejects.toMatchObject({
      code: 'journal_corrupt',
    });
    expect(getStorageSnapshot()[BOOKMARK_OPERATIONS_KEY]).toEqual(value);
    expect(getStorageMocks().set).not.toHaveBeenCalled();
  });

  it('rejects semantic corruption in summaries, URLs, and status combinations', async () => {
    const operation = await preparedOperation('semantic');
    const variants: unknown[] = [];

    const wrongSummary = structuredClone(operation);
    wrongSummary.summary.pending = 0;
    variants.push({ version: 1, revision: 1, operations: [wrongSummary] });

    const invalidUrl = structuredClone(operation);
    const invalidUrlItem = invalidUrl.items[0];
    if (invalidUrlItem?.kind === 'update_url' && invalidUrlItem.original) {
      invalidUrlItem.original.url = 'javascript:alert(1)';
      invalidUrlItem.oldUrl = 'javascript:alert(1)';
    }
    variants.push({ version: 1, revision: 1, operations: [invalidUrl] });

    const impossibleStatus = structuredClone(operation);
    impossibleStatus.status = 'complete';
    variants.push({ version: 1, revision: 1, operations: [impossibleStatus] });

    const mismatchedReceipt = structuredClone(operation);
    const mismatchedItem = mismatchedReceipt.items[0];
    const mismatchedCommand = mismatchedReceipt.commands[0];
    if (mismatchedItem && mismatchedCommand) {
      const timestamp = mismatchedReceipt.updatedAt;
      mismatchedItem.executionStatus = 'succeeded';
      mismatchedItem.restoreStatus = 'pending';
      mismatchedItem.executionAttemptCount = 1;
      mismatchedItem.executionAttemptedAt = timestamp;
      mismatchedItem.executionCompletedAt = timestamp;
      mismatchedReceipt.status = 'complete';
      mismatchedReceipt.summary = summarizeBookmarkOperationItems(mismatchedReceipt.items);
      mismatchedCommand.status = 'succeeded';
      mismatchedCommand.result = {
        ok: true,
        operationStatus: 'resolved',
        summary: structuredClone(mismatchedReceipt.summary),
        completedAt: timestamp,
      };
    }
    variants.push({ version: 1, revision: 1, operations: [mismatchedReceipt] });

    for (const value of variants) {
      setStorageSnapshot({ [BOOKMARK_OPERATIONS_KEY]: value });
      await expect(getBookmarkOperationJournal()).rejects.toMatchObject({
        code: 'journal_corrupt',
      });
      expect(getStorageSnapshot()[BOOKMARK_OPERATIONS_KEY]).toEqual(value);
    }
    expect(getStorageMocks().set).not.toHaveBeenCalled();
  });

  it('serializes concurrent inserts without losing either operation', async () => {
    const first = await preparedOperation('concurrent-a');
    const second = await preparedOperation('concurrent-b');

    await Promise.all([
      insertBookmarkOperation(first, operationReserve(first)),
      insertBookmarkOperation(second, operationReserve(second)),
    ]);

    const journal = await getBookmarkOperationJournal();
    expect(journal.revision).toBe(2);
    expect(journal.operations.map((operation) => operation.id).sort()).toEqual([
      first.id,
      second.id,
    ]);
  });

  it('rejects a stale envelope revision instead of overwriting a newer write', async () => {
    const operation = await preparedOperation('revision');
    await insertBookmarkOperation(operation, operationReserve(operation));
    const stale = await getBookmarkOperationJournal();

    await saveBookmarkOperationJournal(stale, stale.revision);
    await expect(saveBookmarkOperationJournal(stale, stale.revision)).rejects.toMatchObject({
      code: 'journal_revision_conflict',
    });
    expect((await getBookmarkOperationJournal()).revision).toBe(2);
  });

  it('rejects an active operation without enough safe-integer revision headroom', async () => {
    const operation = await preparedOperation('revision-headroom');
    setStorageSnapshot({
      [BOOKMARK_OPERATIONS_KEY]: {
        version: 1,
        revision: Number.MAX_SAFE_INTEGER - 1,
        operations: [],
      },
    });

    await expect(
      insertBookmarkOperation(operation, operationReserve(operation)),
    ).rejects.toMatchObject({
      code: 'journal_reserve_exceeded',
    });
    expect(getStorageMocks().set).not.toHaveBeenCalled();
  });

  it('rejects immutable operation identity changes', async () => {
    const operation = await preparedOperation('immutable');
    await insertBookmarkOperation(operation, operationReserve(operation));
    const journal = await getBookmarkOperationJournal();
    const changed = structuredClone(journal.operations[0]);
    if (!changed) {
      throw new Error('missing operation');
    }
    const item = changed.items[0];
    if (item?.kind === 'update_url') {
      item.newUrl = 'https://example.com/changed';
    }

    await expect(saveBookmarkOperation(changed, journal.revision)).rejects.toMatchObject({
      code: 'journal_corrupt',
    });
    expect((await getBookmarkOperationJournal()).revision).toBe(journal.revision);
  });

  it.each([
    {
      name: 'three duplicate baseline IDs',
      baselineIds: ['duplicate-a', 'duplicate-b', 'duplicate-c'],
    },
    {
      name: 'one duplicate baseline ID',
      baselineIds: ['duplicate-a'],
    },
    {
      name: 'a callback on a no-attempt conflict',
      baselineIds: ['duplicate-a', 'duplicate-b'],
      callbackId: 'unexpected-callback',
    },
  ])('rejects invalid folder evidence: $name', async ({ baselineIds, callbackId }) => {
    const operation = await preparedMoveOperation(`invalid-folder-${baselineIds.length}`);
    await insertBookmarkOperation(operation, operationReserve(operation));
    const journal = await getBookmarkOperationJournal();
    const changed = structuredClone(journal.operations[0] as BookmarkOperation);
    const item = changed.items[0];
    if (item?.kind !== 'move') {
      throw new Error('Expected move operation fixture');
    }
    item.targetStatus = 'resolving';
    item.folderResolution.push({
      path: 'Target',
      title: 'Target',
      parentId: 'parent-1',
      baselineIds,
      status: 'conflict',
      attemptCount: 0,
      errorCode: 'target_folder_conflict',
      ...(callbackId ? { callbackId } : {}),
    });
    getStorageMocks().set.mockClear();

    await expect(saveBookmarkOperation(changed, journal.revision)).rejects.toMatchObject({
      code: 'journal_corrupt',
    });
    expect(getStorageMocks().set).not.toHaveBeenCalled();
    expect((await getBookmarkOperationJournal()).revision).toBe(journal.revision);
  });

  it('retains active operations and caps retention at one hundred envelopes', () => {
    const operations = Array.from({ length: 105 }, (_, index) => ({
      id: `operation-${index}`,
      status: index < 3 ? 'running' : 'complete',
      updatedAt: new Date(index * 1_000).toISOString(),
    })) as BookmarkOperation[];

    const retained = pruneBookmarkOperations(operations, Date.now());

    expect(retained).toHaveLength(23);
    expect(retained.filter((operation) => operation.status === 'running')).toHaveLength(3);
  });

  it('rejects capacity overflow instead of evicting retained receipts', () => {
    const now = Date.parse('2026-01-31T00:00:00.000Z');
    const protectedStatuses: BookmarkOperation['status'][] = [
      'prepared',
      'running',
      'partial',
      'restoring',
      'restore_partial',
    ];
    const protectedOperations = protectedStatuses.map((status, index) => ({
      id: `protected-${index}`,
      status,
      updatedAt: new Date(0).toISOString(),
    }));
    const terminalOperations = Array.from({ length: 100 }, (_, index) => ({
      id: `terminal-${index}`,
      status: 'complete',
      updatedAt: new Date(now - index * 1_000).toISOString(),
    }));

    let failure: unknown;
    try {
      pruneBookmarkOperations(
        [...protectedOperations, ...terminalOperations] as BookmarkOperation[],
        now,
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toEqual(
      expect.objectContaining<Partial<BookmarkOperationStorageError>>({
        code: 'journal_capacity_exceeded',
      }),
    );
  });

  it('enforces outcome reserve before the first mutation-sized write', async () => {
    const timestamp = new Date(0).toISOString();
    const updates = Array.from({ length: 250 }, (_, index) => ({
      id: `large-${index}`,
      url: `https://example.com/${'a'.repeat(1_700)}${index}`,
    }));
    const payloadIdentity = await createBookmarkExecutionPayloadIdentity(
      'update_bookmark_urls',
      updates,
      'manual',
    );
    const items: BookmarkOperation['items'] = updates.map((update, index) => ({
      kind: 'update_url',
      bookmarkId: update.id,
      title: '',
      original: {
        title: '',
        url: `https://example.com/old/${index}`,
        parentId: 'parent-1',
        index,
      },
      oldUrl: `https://example.com/old/${index}`,
      newUrl: update.url,
      executionStatus: 'pending',
      restoreStatus: 'not_needed',
      executionAttemptCount: 0,
      restoreAttemptCount: 0,
    }));
    const operation: BookmarkOperation = {
      id: 'operation-large',
      requestId: 'request-large',
      payloadIdentity,
      version: 1,
      type: 'update_bookmark_urls',
      status: 'prepared',
      source: 'manual',
      createdAt: timestamp,
      updatedAt: timestamp,
      requestedCount: items.length,
      items,
      summary: summarizeBookmarkOperationItems(items),
      commands: [
        {
          requestId: 'request-large',
          action: 'execute',
          payloadIdentity,
          status: 'pending',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    };

    await expect(
      insertBookmarkOperation(
        operation,
        BOOKMARK_OPERATION_RESERVE_BASE_BYTES +
          items.length * BOOKMARK_OPERATION_RESERVE_ITEM_BYTES,
      ),
    ).rejects.toMatchObject({ code: 'journal_reserve_exceeded' });
    expect(getStorageMocks().set).not.toHaveBeenCalled();
  });

  it('reserves the remaining per-operation byte budget for active operations', async () => {
    const operation = await preparedOperation('remaining-capacity');
    const operationBytes = new TextEncoder().encode(JSON.stringify(operation)).byteLength;

    expect(getBookmarkOperationReserveBytes(operation)).toBe(
      BOOKMARK_OPERATION_MAX_BYTES - operationBytes,
    );
    await expect(
      insertBookmarkOperation(
        operation,
        BOOKMARK_OPERATION_RESERVE_BASE_BYTES +
          operation.requestedCount * BOOKMARK_OPERATION_RESERVE_ITEM_BYTES,
      ),
    ).rejects.toMatchObject({ code: 'journal_reserve_exceeded' });
    expect(getStorageMocks().set).not.toHaveBeenCalled();
  });

  it('rejects a valid envelope above four MiB without overwriting it', async () => {
    const timestamp = new Date(0).toISOString();
    const operations = Array.from({ length: 100 }, (_, operationIndex) => {
      const payloadIdentity = `sha256:${operationIndex.toString(16).padStart(64, '0')}`;
      const items: BookmarkOperation['items'] = Array.from({ length: 12 }, (_, itemIndex) => {
        const bookmarkId = `large-${operationIndex}-${itemIndex}`;
        return {
          kind: 'update_url',
          bookmarkId,
          title: '',
          original: {
            title: '',
            url: `https://example.com/old/${'a'.repeat(1_800)}${operationIndex}/${itemIndex}`,
            parentId: 'parent-1',
            index: itemIndex,
          },
          oldUrl: `https://example.com/old/${'a'.repeat(1_800)}${operationIndex}/${itemIndex}`,
          newUrl: `https://example.com/new/${'b'.repeat(1_800)}${operationIndex}/${itemIndex}`,
          executionStatus: 'pending',
          restoreStatus: 'not_needed',
          executionAttemptCount: 0,
          restoreAttemptCount: 0,
        };
      });
      const requestId = `large-envelope-request-${operationIndex}`;
      return {
        id: `large-envelope-operation-${operationIndex}`,
        requestId,
        payloadIdentity,
        version: 1,
        type: 'update_bookmark_urls',
        status: 'prepared',
        source: 'manual',
        createdAt: timestamp,
        updatedAt: timestamp,
        requestedCount: items.length,
        items,
        summary: summarizeBookmarkOperationItems(items),
        commands: [
          {
            requestId,
            action: 'execute',
            payloadIdentity,
            status: 'pending',
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
      } satisfies BookmarkOperation;
    });
    const oversized = { version: 1, revision: 1, operations };
    expect(() => parseBookmarkOperationJournalEnvelope(oversized)).toThrow(
      'invalid_bookmark_operation_journal',
    );
    setStorageSnapshot({ [BOOKMARK_OPERATIONS_KEY]: oversized });

    await expect(getBookmarkOperationJournal()).rejects.toMatchObject({
      code: 'journal_too_large',
    });
    expect(getStorageSnapshot()[BOOKMARK_OPERATIONS_KEY]).toEqual(oversized);
    expect(getStorageMocks().set).not.toHaveBeenCalled();
  });

  it('counts reserve for every active operation in the envelope', async () => {
    const base = await preparedOperation('aggregate-reserve');
    const operations = Array.from({ length: 64 }, (_, index) => {
      const operation = structuredClone(base);
      const suffix = `aggregate-${index}`;
      operation.id = `operation-${suffix}`;
      operation.requestId = `request-${suffix}`;
      operation.payloadIdentity = `sha256:${(index + 1).toString(16).padStart(64, '0')}`;
      operation.commands[0] = {
        ...operation.commands[0]!,
        requestId: operation.requestId,
        payloadIdentity: operation.payloadIdentity,
      };
      const item = operation.items[0];
      if (item?.kind === 'update_url' && item.original) {
        item.bookmarkId = `bookmark-${suffix}`;
        item.original.url = `https://example.com/${suffix}/old`;
        item.oldUrl = item.original.url;
        item.newUrl = `https://example.com/${suffix}/new`;
      }
      return operation;
    });
    const value = { version: 1, revision: 1, operations };
    setStorageSnapshot({ [BOOKMARK_OPERATIONS_KEY]: value });

    await expect(getBookmarkOperationJournal()).rejects.toMatchObject({
      code: 'journal_reserve_exceeded',
    });
    expect(getStorageSnapshot()[BOOKMARK_OPERATIONS_KEY]).toEqual(value);
    expect(getStorageMocks().set).not.toHaveBeenCalled();
  });

  it('returns a stable quota write error and does not claim a journal revision', async () => {
    const operation = await preparedOperation('quota');
    getStorageMocks().set.mockImplementationOnce(
      (_items: Record<string, unknown>, callback?: () => void) => {
        setRuntimeLastError('QUOTA_BYTES exceeded');
        callback?.();
        setRuntimeLastError(undefined);
      },
    );

    await expect(insertBookmarkOperation(operation, operationReserve(operation))).rejects.toEqual(
      expect.objectContaining<Partial<BookmarkOperationStorageError>>({
        code: 'storage_write_failed',
      }),
    );
    expect(getStorageSnapshot()[BOOKMARK_OPERATIONS_KEY]).toBeUndefined();
  });
});

describe('trusted local storage access', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('shares one initialization across ten concurrent callers', async () => {
    const mocks = getStorageMocks();
    let release: (() => void) | undefined;
    mocks.setAccessLevel.mockImplementation((_options: unknown, callback: () => void) => {
      release = callback;
    });
    const { ensureTrustedLocalStorageAccess } = await import('../src/utils/storage.js');

    const pending = Array.from({ length: 10 }, () => ensureTrustedLocalStorageAccess());
    expect(mocks.setAccessLevel).toHaveBeenCalledTimes(1);
    expect(mocks.setAccessLevel).toHaveBeenCalledWith(
      { accessLevel: 'TRUSTED_CONTEXTS' },
      expect.any(Function),
    );

    release?.();
    await expect(Promise.all(pending)).resolves.toEqual(
      Array.from({ length: 10 }, () => undefined),
    );
  });

  it('fails closed when setAccessLevel is unavailable', async () => {
    const mocks = getStorageMocks();
    const original = chrome.storage.local.setAccessLevel;
    Object.defineProperty(chrome.storage.local, 'setAccessLevel', {
      configurable: true,
      value: undefined,
    });

    try {
      const { getLocalValue } = await import('../src/utils/storage.js');
      await expect(getLocalValue('secret', 'fallback')).rejects.toThrow(
        'trusted_storage_access_unavailable',
      );
      expect(mocks.get).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(chrome.storage.local, 'setAccessLevel', {
        configurable: true,
        value: original,
      });
    }
  });

  it('fails closed when setAccessLevel rejects', async () => {
    const mocks = getStorageMocks();
    mocks.setAccessLevel.mockImplementation(() => Promise.reject(new Error('private detail')));
    const { getLocalValue, removeLocalValues, setLocalValues } = await import(
      '../src/utils/storage.js'
    );

    await expect(getLocalValue('secret', 'fallback')).rejects.toThrow(
      'trusted_storage_access_unavailable',
    );
    await expect(setLocalValues({ secret: true })).rejects.toThrow(
      'trusted_storage_access_unavailable',
    );
    await expect(removeLocalValues(['secret'])).rejects.toThrow(
      'trusted_storage_access_unavailable',
    );
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it.each([undefined, null])(
    'fails closed when setAccessLevel rejects with a falsy reason: %s',
    async (reason) => {
      const mocks = getStorageMocks();
      mocks.setAccessLevel.mockImplementation(() => Promise.reject(reason));
      const { ensureTrustedLocalStorageAccess } = await import('../src/utils/storage.js');

      await expect(ensureTrustedLocalStorageAccess()).rejects.toThrow(
        'trusted_storage_access_unavailable',
      );
    },
  );

  it('fails closed on callback runtime errors', async () => {
    const mocks = getStorageMocks();
    mocks.setAccessLevel.mockImplementation((_options: unknown, callback: () => void) => {
      setRuntimeLastError('private runtime detail');
      callback();
      setRuntimeLastError(undefined);
    });
    const { ensureTrustedLocalStorageAccess } = await import('../src/utils/storage.js');

    await expect(ensureTrustedLocalStorageAccess()).rejects.toThrow(
      'trusted_storage_access_unavailable',
    );
  });

  it('fails closed on callback runtime errors with an empty message', async () => {
    const mocks = getStorageMocks();
    mocks.setAccessLevel.mockImplementation((_options: unknown, callback: () => void) => {
      setRuntimeLastError('');
      callback();
      setRuntimeLastError(undefined);
    });
    const { ensureTrustedLocalStorageAccess } = await import('../src/utils/storage.js');

    await expect(ensureTrustedLocalStorageAccess()).rejects.toThrow(
      'trusted_storage_access_unavailable',
    );
  });

  it('does not touch stored data when initialization fails', async () => {
    const mocks = getStorageMocks();
    setStorageSnapshot({ secret: 'unchanged' });
    mocks.setAccessLevel.mockImplementation(() => {
      throw new Error('private detail');
    });
    const { getLocalValue, removeLocalValues, setLocalValues } = await import(
      '../src/utils/storage.js'
    );

    await expect(getLocalValue('secret', 'fallback')).rejects.toThrow();
    await expect(setLocalValues({ secret: 'changed' })).rejects.toThrow();
    await expect(removeLocalValues(['secret'])).rejects.toThrow();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
