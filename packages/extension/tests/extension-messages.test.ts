import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BOOKMARK_OPERATION_JOURNAL_MAX_BYTES,
  BOOKMARK_OPERATION_MAX_BYTES,
  summarizeBookmarkOperationItems,
  type BookmarkOperation,
  type BookmarkOperationCommandResponse,
} from '../src/shared/bookmark-types.js';
import {
  EXTENSION_MESSAGE_LIMITS,
  StructuredInputError,
  UrlHealthRecordSchema,
  cloneBoundedStructuredValue,
  makeLegacyError,
  parseBookmarkOperationMessageResponse,
  parseClassificationPortMessage,
  parseClassificationPortRequest,
  parseExtensionRequest,
  parseLegacyResponse,
  validateExtensionUiSender,
  type ExtensionRequest,
  type StructuredInputLimits,
} from '../src/shared/extension-messages.js';

const EXTENSION_ID = 'a'.repeat(32);
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const textEncoder = new TextEncoder();

const permissiveLimits: StructuredInputLimits = {
  maxBytes: 1_024,
  maxDepth: 16,
  maxNodes: 64,
  maxStringBytes: 1_024,
};

function expectStructuredError(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error('expected parser to reject');
  } catch (error) {
    expect(error).toBeInstanceOf(StructuredInputError);
    expect(error).toMatchObject({ code });
  }
}

function asciiPayloadAtSerializedBytes(
  targetBytes: number,
  maxStringBytes: number,
): { chunks: string[] } {
  const chunkCount = Math.ceil((targetBytes - 12) / (maxStringBytes + 3));
  let remainingContentBytes = targetBytes - 12 - chunkCount * 3;
  const chunks = Array.from({ length: chunkCount }, () => {
    const length = Math.min(maxStringBytes, remainingContentBytes);
    remainingContentBytes -= length;
    return 'x'.repeat(length);
  });
  if (remainingContentBytes !== 0) {
    throw new Error('Unable to construct the exact serialized fixture size');
  }
  const payload = { chunks };
  if (textEncoder.encode(JSON.stringify(payload)).byteLength !== targetBytes) {
    throw new Error('Serialized fixture size does not match its requested budget');
  }
  return payload;
}

function settings() {
  return {
    useAi: false,
    activeProviderId: 'deepseek-default',
    aiProviders: [],
    customRules: [],
    templates: [],
    activeTemplateIds: {},
    defaultClassifyMode: 'safe' as const,
    exportDirectory: 'Bookmarks',
  };
}

function provider() {
  return {
    id: 'provider-deepseek',
    name: 'DeepSeek',
    provider: 'deepseek' as const,
    enabled: true,
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  };
}

function capture() {
  return {
    id: 'capture-1',
    source: 'article' as const,
    title: 'Article',
    url: 'https://example.com/article',
    text: 'Body',
    media: [],
    tags: [],
    capturedAt: new Date(0).toISOString(),
  };
}

function densePreparedOperation(operationIndex: number): BookmarkOperation {
  const timestamp = new Date(0).toISOString();
  const requestId = `bulk-request-${operationIndex.toString().padStart(3, '0')}`;
  const payloadIdentity = `sha256:${operationIndex.toString(16).padStart(64, '0')}`;
  const padding = 'a'.repeat(1_800);
  const items: BookmarkOperation['items'] = Array.from({ length: 12 }, (_, itemIndex) => {
    const bookmarkId = `bulk-bookmark-${operationIndex}-${itemIndex}`;
    const oldUrl = `https://example.com/old/${padding}/${operationIndex}/${itemIndex}`;
    return {
      kind: 'update_url',
      bookmarkId,
      title: '',
      original: {
        title: '',
        url: oldUrl,
        parentId: `bulk-parent-${operationIndex}`,
        index: itemIndex,
      },
      oldUrl,
      newUrl: `https://example.com/new/${padding}/${operationIndex}/${itemIndex}`,
      executionStatus: 'pending',
      restoreStatus: 'not_needed',
      executionAttemptCount: 0,
      restoreAttemptCount: 0,
    };
  });
  return {
    id: `bulk-operation-${operationIndex.toString().padStart(3, '0')}`,
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

function nearJournalLimitOperations(): BookmarkOperation[] {
  const operations: BookmarkOperation[] = [];
  for (let index = 0; index < 100; index += 1) {
    const operation = densePreparedOperation(index);
    expect(textEncoder.encode(JSON.stringify(operation)).byteLength).toBeLessThanOrEqual(
      BOOKMARK_OPERATION_MAX_BYTES,
    );
    const candidate = [...operations, operation];
    const candidateBytes = textEncoder.encode(
      JSON.stringify({ version: 1, revision: 1, operations: candidate }),
    ).byteLength;
    if (candidateBytes > BOOKMARK_OPERATION_JOURNAL_MAX_BYTES) {
      break;
    }
    operations.push(operation);
  }
  return operations;
}

function nodeDensePreparedOperation(operationIndex: number): BookmarkOperation {
  const timestamp = new Date(0).toISOString();
  const requestId = `dense-request-${operationIndex.toString().padStart(3, '0')}`;
  const payloadIdentity = `sha256:${(operationIndex + 1).toString(16).padStart(64, '0')}`;
  const items: BookmarkOperation['items'] = Array.from({ length: 250 }, (_, itemIndex) => {
    const bookmarkId = `dense-${operationIndex}-${itemIndex}`;
    const oldUrl = `https://e.co/o/${operationIndex}/${itemIndex}`;
    return {
      kind: 'update_url',
      bookmarkId,
      title: '',
      original: {
        title: '',
        url: oldUrl,
        parentId: `p-${operationIndex}`,
        index: itemIndex,
      },
      oldUrl,
      newUrl: `https://e.co/n/${operationIndex}/${itemIndex}`,
      executionStatus: 'pending',
      restoreStatus: 'not_needed',
      executionAttemptCount: 0,
      restoreAttemptCount: 0,
    };
  });
  return {
    id: `dense-operation-${operationIndex.toString().padStart(3, '0')}`,
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

function nodeDenseNearJournalLimitOperations(): BookmarkOperation[] {
  const operations: BookmarkOperation[] = [];
  for (let index = 0; index < 100; index += 1) {
    const operation = nodeDensePreparedOperation(index);
    expect(textEncoder.encode(JSON.stringify(operation)).byteLength).toBeLessThanOrEqual(
      BOOKMARK_OPERATION_MAX_BYTES,
    );
    const candidate = [...operations, operation];
    const candidateBytes = textEncoder.encode(
      JSON.stringify({ version: 1, revision: 1, operations: candidate }),
    ).byteLength;
    if (candidateBytes > BOOKMARK_OPERATION_JOURNAL_MAX_BYTES) {
      break;
    }
    operations.push(operation);
  }
  return operations;
}

function completedOperationResponse(): BookmarkOperationCommandResponse {
  const timestamp = new Date(0).toISOString();
  const payloadIdentity = `sha256:${'a'.repeat(64)}`;
  const oldUrl = 'https://example.com/old';
  const items: BookmarkOperation['items'] = [
    {
      kind: 'update_url',
      bookmarkId: 'bookmark-completed',
      title: 'Completed',
      original: {
        title: 'Completed',
        url: oldUrl,
        parentId: 'parent-completed',
        index: 0,
      },
      oldUrl,
      newUrl: 'https://example.com/new',
      executionStatus: 'succeeded',
      restoreStatus: 'pending',
      executionAttemptedAt: timestamp,
      executionCompletedAt: timestamp,
      executionAttemptCount: 1,
      restoreAttemptCount: 0,
    },
  ];
  const summary = summarizeBookmarkOperationItems(items);
  const receipt = {
    requestId: 'completed-request',
    action: 'execute' as const,
    payloadIdentity,
    status: 'succeeded' as const,
    createdAt: timestamp,
    updatedAt: timestamp,
    result: {
      ok: true,
      operationStatus: 'complete' as const,
      summary,
      completedAt: timestamp,
    },
  };
  return {
    receipt,
    operation: {
      id: 'completed-operation',
      requestId: receipt.requestId,
      payloadIdentity,
      version: 1,
      type: 'update_bookmark_urls',
      status: 'complete',
      source: 'manual',
      createdAt: timestamp,
      updatedAt: timestamp,
      requestedCount: items.length,
      items,
      summary,
      commands: [receipt],
    },
  };
}

function sender(
  surface: 'popup' | 'sidepanel',
  overrides: Partial<chrome.runtime.MessageSender> = {},
): chrome.runtime.MessageSender {
  return {
    id: EXTENSION_ID,
    origin: EXTENSION_ORIGIN,
    url: `${EXTENSION_ORIGIN}/${surface}/index.html`,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal('chrome', {
    runtime: {
      id: EXTENSION_ID,
      getURL: (path: string) => `${EXTENSION_ORIGIN}/${path.replace(/^\/+/u, '')}`,
    },
  });
});

describe('bounded extension message clone', () => {
  it('enforces exact serialized byte limits at limit-1, limit, and limit+1', () => {
    const limits = { ...permissiveLimits, maxBytes: 5 };

    expect(cloneBoundedStructuredValue('aa', limits)).toBe('aa');
    expect(cloneBoundedStructuredValue('aaa', limits)).toBe('aaa');
    expectStructuredError(() => cloneBoundedStructuredValue('aaaa', limits), 'message_too_large');
  });

  it.each([
    ['operation response', EXTENSION_MESSAGE_LIMITS.operationResponse],
    ['legacy state response', EXTENSION_MESSAGE_LIMITS.legacyResponse],
  ] as const)(
    'enforces the production %s byte budget at the exact limit and limit+1',
    (_label, limits) => {
      const atLimit = asciiPayloadAtSerializedBytes(limits.maxBytes, limits.maxStringBytes);
      const clone = cloneBoundedStructuredValue(atLimit, limits);

      expect(textEncoder.encode(JSON.stringify(clone)).byteLength).toBe(limits.maxBytes);
      const overLimit = asciiPayloadAtSerializedBytes(limits.maxBytes + 1, limits.maxStringBytes);
      expectStructuredError(
        () => cloneBoundedStructuredValue(overLimit, limits),
        'message_too_large',
      );
    },
  );

  it('counts containers and primitives as nodes but not object keys', () => {
    expect(cloneBoundedStructuredValue({ a: null }, { ...permissiveLimits, maxNodes: 3 })).toEqual({
      a: null,
    });
    expect(
      cloneBoundedStructuredValue({ a: null, b: true }, { ...permissiveLimits, maxNodes: 3 }),
    ).toEqual({ a: null, b: true });
    expectStructuredError(
      () =>
        cloneBoundedStructuredValue(
          { a: null, b: true, c: 0 },
          { ...permissiveLimits, maxNodes: 3 },
        ),
      'message_too_complex',
    );
  });

  it('treats the root as depth zero', () => {
    expect(cloneBoundedStructuredValue([], { ...permissiveLimits, maxDepth: 1 })).toEqual([]);
    expect(cloneBoundedStructuredValue([[]], { ...permissiveLimits, maxDepth: 1 })).toEqual([[]]);
    expectStructuredError(
      () => cloneBoundedStructuredValue([[[]]], { ...permissiveLimits, maxDepth: 1 }),
      'message_too_deep',
    );
  });

  it.each([
    ['undefined', () => ({ value: undefined })],
    [
      'accessor',
      () =>
        Object.defineProperty({}, 'value', {
          enumerable: true,
          get: () => 'secret',
        }),
    ],
    [
      'forbidden key',
      () => Object.defineProperty({}, '__proto__', { enumerable: true, value: {} }),
    ],
    [
      'cycle',
      () => {
        const value: Record<string, unknown> = {};
        value.self = value;
        return value;
      },
    ],
    [
      'proxy trap',
      () =>
        new Proxy(
          {},
          {
            ownKeys: () => {
              throw new Error('private detail');
            },
          },
        ),
    ],
  ])('rejects %s without reflecting private details', (_label, makeValue) => {
    expectStructuredError(
      () => cloneBoundedStructuredValue(makeValue(), permissiveLimits),
      'invalid_message',
    );
  });

  it('enforces the injected string budget independently from total bytes', () => {
    expect(
      cloneBoundedStructuredValue('12', {
        ...permissiveLimits,
        maxStringBytes: 3,
      }),
    ).toBe('12');
    expect(
      cloneBoundedStructuredValue('123', {
        ...permissiveLimits,
        maxStringBytes: 3,
      }),
    ).toBe('123');
    expectStructuredError(
      () =>
        cloneBoundedStructuredValue('1234', {
          ...permissiveLimits,
          maxStringBytes: 3,
        }),
      'string_too_large',
    );
  });

  it.each([
    ['undefined', () => undefined],
    ['bigint', () => 1n],
    ['symbol', () => Symbol('value')],
    ['function', () => () => undefined],
    ['NaN', () => Number.NaN],
    ['Infinity', () => Number.POSITIVE_INFINITY],
    ['negative Infinity', () => Number.NEGATIVE_INFINITY],
  ])('rejects the unsupported primitive %s', (_label, makeValue) => {
    expectStructuredError(
      () => cloneBoundedStructuredValue(makeValue(), permissiveLimits),
      'invalid_message',
    );
  });

  it.each(['constructor', 'prototype'])('rejects the forbidden key %s', (key) => {
    const value = Object.defineProperty({}, key, { enumerable: true, value: null });
    expectStructuredError(
      () => cloneBoundedStructuredValue(value, permissiveLimits),
      'invalid_message',
    );
  });

  it('rejects sparse arrays and unexpected array properties', () => {
    expectStructuredError(
      () => cloneBoundedStructuredValue(new Array(1), permissiveLimits),
      'invalid_message',
    );
    const value = [null] as unknown[] & { extra?: string };
    value.extra = 'unexpected';
    expectStructuredError(
      () => cloneBoundedStructuredValue(value, permissiveLimits),
      'invalid_message',
    );
  });

  it('accepts shared DAG references while still counting every occurrence', () => {
    const shared = { value: 'same' };
    expect(
      cloneBoundedStructuredValue(
        { left: shared, right: shared },
        { ...permissiveLimits, maxNodes: 5 },
      ),
    ).toEqual({ left: { value: 'same' }, right: { value: 'same' } });
    expectStructuredError(
      () =>
        cloneBoundedStructuredValue(
          { left: shared, right: shared },
          { ...permissiveLimits, maxNodes: 4 },
        ),
      'message_too_complex',
    );
  });

  it('measures JSON escaping and non-BMP strings in UTF-8 bytes', () => {
    expect(cloneBoundedStructuredValue('\n', { ...permissiveLimits, maxBytes: 4 })).toBe('\n');
    expectStructuredError(
      () => cloneBoundedStructuredValue('\n', { ...permissiveLimits, maxBytes: 3 }),
      'message_too_large',
    );
    expect(
      cloneBoundedStructuredValue('😀', {
        ...permissiveLimits,
        maxBytes: 6,
        maxStringBytes: 4,
      }),
    ).toBe('😀');
    expectStructuredError(
      () =>
        cloneBoundedStructuredValue('😀', {
          ...permissiveLimits,
          maxBytes: 6,
          maxStringBytes: 3,
        }),
      'string_too_large',
    );
  });
});

describe('legacy request and response correlation', () => {
  it.each([
    { type: 'security:getBootstrapStatus' },
    { type: 'state:get' },
    { type: 'state:summary' },
    { type: 'operations:getRecent' },
    { type: 'plan:create', mode: 'safe' },
    { type: 'settings:get' },
    { type: 'settings:set', settings: settings() },
    { type: 'ai:testConnection', provider: provider() },
    { type: 'onboarding:getProgress' },
    { type: 'onboarding:set', onboarded: true },
    { type: 'capture:getPending' },
    { type: 'capture:removePending', id: 'capture-1' },
    { type: 'capture:clearPending' },
    { type: 'capture:currentSocial', source: 'twitter' },
    { type: 'capture:currentArticle' },
    { type: 'health:clearRecords' },
    { type: 'backups:list' },
  ] satisfies unknown[])('accepts the minimal strict request $type', (request) => {
    expect(parseExtensionRequest(request)).toEqual(request);
  });

  it('rejects unknown request fields and retired health retry messages', () => {
    expect(() => parseExtensionRequest({ type: 'state:get', unexpected: true })).toThrow(
      StructuredInputError,
    );
    expect(() =>
      parseExtensionRequest({ type: 'health:retryOne', bookmarkId: 'bookmark-1' }),
    ).toThrow(StructuredInputError);
  });

  it('requires response data to match the original request', () => {
    const request = parseExtensionRequest({ type: 'settings:get' });

    expect(parseLegacyResponse(request, { ok: true, data: settings() })).toMatchObject({
      ok: true,
    });
    expect(() => parseLegacyResponse(request, { ok: true, data: { ready: true } })).toThrow(
      StructuredInputError,
    );
  });

  it.each([
    [{ type: 'security:getBootstrapStatus' }, { ready: true }],
    [
      { type: 'state:get' },
      {
        tree: [],
        bookmarks: [],
        folders: [],
        backups: [],
        exportManifests: [],
        pendingCaptures: [],
        urlHealthRecords: [],
        bookmarkOperations: [],
        lastMoveRecordCount: 0,
        onboarded: false,
        settings: settings(),
      },
    ],
    [
      { type: 'state:summary' },
      {
        bookmarkCount: 0,
        folderCount: 0,
        pendingCaptureCount: 0,
        onboarded: false,
        hasVaultHandle: false,
        hasAiProvider: false,
      },
    ],
    [{ type: 'operations:getRecent' }, { operations: [] }],
    [
      { type: 'plan:create', mode: 'safe' },
      {
        mode: 'safe',
        moves: [],
        newFolders: [],
        unchanged: 0,
        totalBookmarks: 0,
        generatedAt: new Date(0).toISOString(),
      },
    ],
    [{ type: 'settings:get' }, settings()],
    [{ type: 'settings:set', settings: settings() }, settings()],
    [
      { type: 'ai:testConnection', provider: provider() },
      { success: true, code: 'connection_ok', message: '连接成功，模型可用' },
    ],
    [
      { type: 'onboarding:getProgress' },
      {
        vaultConfigured: false,
        providerConfigured: false,
        firstClassifyDone: false,
        firstExportDone: false,
      },
    ],
    [{ type: 'onboarding:set', onboarded: true }, { onboarded: true }],
    [{ type: 'capture:getPending' }, []],
    [{ type: 'capture:removePending', id: 'capture-1' }, { removed: true }],
    [{ type: 'capture:clearPending' }, { cleared: true }],
    [{ type: 'capture:currentSocial', source: 'twitter' }, { capture: capture() }],
    [{ type: 'capture:currentArticle' }, { capture: capture() }],
    [{ type: 'health:clearRecords' }, { cleared: true }],
    [{ type: 'backups:list' }, []],
  ] satisfies Array<[unknown, unknown]>)(
    'accepts the request-correlated success response for $0.type',
    (requestValue, data) => {
      const request = parseExtensionRequest(requestValue);
      expect(parseLegacyResponse(request, { ok: true, data })).toEqual({ ok: true, data });
      expect(() => parseLegacyResponse(request, { ok: true, data, unknown: true })).toThrow(
        StructuredInputError,
      );
    },
  );

  it('rejects non-canonical AI provider test messages', () => {
    const request = parseExtensionRequest({
      type: 'ai:testConnection',
      provider: provider(),
    });

    expect(() =>
      parseLegacyResponse(request, {
        ok: true,
        data: {
          success: false,
          code: 'network_failed',
          message: 'network failed: secret-token-and-url',
        },
      }),
    ).toThrow(StructuredInputError);
  });

  it('does not interchange bootstrap and storage failure codes', () => {
    const securityRequest = parseExtensionRequest({
      type: 'security:getBootstrapStatus',
    });
    const stateRequest = parseExtensionRequest({ type: 'state:get' });

    expect(
      parseLegacyResponse(securityRequest, makeLegacyError('security_bootstrap_failed')),
    ).toEqual(makeLegacyError('security_bootstrap_failed'));
    expect(() =>
      parseLegacyResponse(securityRequest, makeLegacyError('storage_unavailable')),
    ).toThrow(StructuredInputError);
    expect(parseLegacyResponse(stateRequest, makeLegacyError('storage_unavailable'))).toEqual(
      makeLegacyError('storage_unavailable'),
    );
    expect(() =>
      parseLegacyResponse(stateRequest, makeLegacyError('security_bootstrap_failed')),
    ).toThrow(StructuredInputError);
  });

  it.each([
    'invalid_request',
    'forbidden_sender',
    'response_invalid',
    'storage_unavailable',
    'operation_failed',
  ] as const)('accepts no %s failure variant for the bootstrap status request', (errorCode) => {
    const request = parseExtensionRequest({
      type: 'security:getBootstrapStatus',
    });

    expect(() => parseLegacyResponse(request, makeLegacyError(errorCode))).toThrow(
      StructuredInputError,
    );
  });

  it('applies the dedicated operation response budget', () => {
    const request: ExtensionRequest = { type: 'operations:getRecent' };
    const oversized = 'x'.repeat(EXTENSION_MESSAGE_LIMITS.operationResponse.maxStringBytes + 1);

    expect(() =>
      parseLegacyResponse(request, {
        ok: true,
        data: { operations: [{ id: oversized }] },
      }),
    ).toThrow(StructuredInputError);
  });

  it('strictly unwraps bookmark operation runtime envelopes before receipt validation', () => {
    const data = completedOperationResponse();
    expect(parseBookmarkOperationMessageResponse({ ok: true, data }, 'completed-request')).toEqual({
      ok: true,
      data,
    });
    expect(
      parseBookmarkOperationMessageResponse(
        {
          ok: false,
          error: 'Bookmark operation command rejected',
          errorCode: 'request_id_conflict',
        },
        'completed-request',
      ),
    ).toEqual({
      ok: false,
      error: 'Bookmark operation command rejected',
      errorCode: 'request_id_conflict',
    });

    expect(() => parseBookmarkOperationMessageResponse(data, 'completed-request')).toThrow(
      StructuredInputError,
    );
    expect(() =>
      parseBookmarkOperationMessageResponse({ ok: true, data, unknown: true }, 'completed-request'),
    ).toThrow(StructuredInputError);
    expect(() =>
      parseBookmarkOperationMessageResponse(
        {
          ok: false,
          error: 'failed for https://private.example?token=secret',
          errorCode: 'internal_error',
        },
        'completed-request',
      ),
    ).toThrow(StructuredInputError);
    expect(() =>
      parseBookmarkOperationMessageResponse({ ok: true, data }, 'another-request'),
    ).toThrow(StructuredInputError);
  });

  it('accepts all retained operations from a legal near-four-MiB journal', () => {
    const operations = nearJournalLimitOperations();
    const journalBytes = textEncoder.encode(
      JSON.stringify({ version: 1, revision: 1, operations }),
    ).byteLength;
    const response = { ok: true, data: { operations } };
    const responseBytes = textEncoder.encode(JSON.stringify(response)).byteLength;

    expect(operations.length).toBeGreaterThan(1);
    expect(journalBytes).toBeGreaterThan(BOOKMARK_OPERATION_JOURNAL_MAX_BYTES - 128 * 1_024);
    expect(journalBytes).toBeLessThanOrEqual(BOOKMARK_OPERATION_JOURNAL_MAX_BYTES);
    expect(responseBytes).toBeLessThanOrEqual(EXTENSION_MESSAGE_LIMITS.operationResponse.maxBytes);

    const parsed = parseLegacyResponse({ type: 'operations:getRecent' }, response);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.operations).toHaveLength(operations.length);
      expect(parsed.data.operations[0]?.id).toBe(operations[0]?.id);
      expect(parsed.data.operations.at(-1)?.id).toBe(operations.at(-1)?.id);
    }
  });

  it('accepts a legal near-four-MiB journal built from maximum-item-count operations', () => {
    const operations = nodeDenseNearJournalLimitOperations();
    const journalBytes = textEncoder.encode(
      JSON.stringify({ version: 1, revision: 1, operations }),
    ).byteLength;
    const response = { ok: true, data: { operations } };

    expect(operations.length).toBeGreaterThan(1);
    expect(operations.every((operation) => operation.items.length === 250)).toBe(true);
    expect(journalBytes).toBeGreaterThan(
      BOOKMARK_OPERATION_JOURNAL_MAX_BYTES - BOOKMARK_OPERATION_MAX_BYTES,
    );
    expect(journalBytes).toBeLessThanOrEqual(BOOKMARK_OPERATION_JOURNAL_MAX_BYTES);

    const parsed = parseLegacyResponse({ type: 'operations:getRecent' }, response);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.operations).toHaveLength(operations.length);
      expect(
        parsed.data.operations.reduce((total, operation) => total + operation.items.length, 0),
      ).toBe(operations.length * 250);
    }
  });
});

describe('classification protocol', () => {
  it('requires request IDs and correlates cancellation', () => {
    expect(
      parseClassificationPortRequest({
        type: 'plan:create',
        requestId: 'classify-request-1',
        mode: 'safe',
      }),
    ).toMatchObject({ requestId: 'classify-request-1' });
    expect(
      parseClassificationPortRequest({
        type: 'cancel',
        requestId: 'cancel-request-1',
        targetRequestId: 'classify-request-1',
      }),
    ).toMatchObject({ targetRequestId: 'classify-request-1' });
    expect(() => parseClassificationPortRequest({ type: 'plan:create', mode: 'safe' })).toThrow(
      StructuredInputError,
    );
  });

  it('rejects uncorrelated or raw error output', () => {
    expect(() =>
      parseClassificationPortMessage({
        type: 'error',
        error: 'private failure https://private.example',
        errorCode: 'operation_failed',
      }),
    ).toThrow(StructuredInputError);
  });
});

describe('trusted extension sender validation', () => {
  it.each([
    ['Popup', sender('popup'), 'popup'],
    ['Side Panel', sender('sidepanel'), 'sidepanel'],
  ] as const)('accepts the exact %s surface', (_label, value, surface) => {
    expect(validateExtensionUiSender(value, surface)).toEqual({ surface });
  });

  it.each([
    ['wrong id', sender('popup', { id: 'b'.repeat(32) })],
    ['tab sender', sender('popup', { tab: { id: 1 } as chrome.tabs.Tab })],
    ['options page', sender('popup', { url: `${EXTENSION_ORIGIN}/options/index.html` })],
    ['query', sender('popup', { url: `${EXTENSION_ORIGIN}/popup/index.html?q=1` })],
    ['fragment', sender('popup', { url: `${EXTENSION_ORIGIN}/popup/index.html#x` })],
    ['fake origin', sender('popup', { origin: 'https://example.com' })],
  ])('rejects %s', (_label, value) => {
    expect(validateExtensionUiSender(value)).toBeUndefined();
  });

  it('rejects an accessor sender without invoking the getter', () => {
    const idGetter = vi.fn(() => EXTENSION_ID);
    const value = Object.defineProperty({}, 'id', {
      enumerable: true,
      get: idGetter,
    }) as chrome.runtime.MessageSender;

    expect(validateExtensionUiSender(value)).toBeUndefined();
    expect(idGetter).not.toHaveBeenCalled();
  });
});

describe('historical URL health schema', () => {
  const valid = {
    bookmarkId: 'bookmark-1',
    bookmarkTitle: 'Title',
    bookmarkUrl: 'https://example.com',
    parentPath: 'Bookmarks',
    status: 'dead' as const,
    checkedAt: new Date(0).toISOString(),
    durationMs: 1,
  };

  it('accepts a strict valid record and rejects unknown fields', () => {
    expect(UrlHealthRecordSchema.safeParse(valid).success).toBe(true);
    expect(UrlHealthRecordSchema.safeParse({ ...valid, unknown: true }).success).toBe(false);
  });

  it('uses UTF-8 byte limits instead of UTF-16 character counts', () => {
    expect(
      UrlHealthRecordSchema.safeParse({
        ...valid,
        bookmarkId: '界'.repeat(170),
      }).success,
    ).toBe(true);
    expect(
      UrlHealthRecordSchema.safeParse({
        ...valid,
        bookmarkId: '界'.repeat(171),
      }).success,
    ).toBe(false);
  });
});
