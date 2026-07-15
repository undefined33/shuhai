import { describe, expect, it } from 'vitest';

import {
  X_SYNC_BOOKMARKS_URL,
  X_SYNC_PROTOCOL,
  XSyncMessageValidationError,
  makeMinimalXSyncRuntimeError,
  matchesXSyncContentResponseBinding,
  parseXSyncContentRequest,
  parseXSyncContentResponse,
  parseXSyncDocumentBinding,
  parseXSyncLaunchIntent,
  parseXSyncPortMessage,
  parseXSyncUiRequest,
  parseXSyncUiResponse,
  resolveXSyncExtensionOrigin,
  validateXSyncServiceWorkerSender,
  validateXSyncUiSender,
} from '../src/social/x-sync-messages.js';

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const extensionOrigin = `chrome-extension://${extensionId}`;
const nonce = 'a'.repeat(64);
const jobId = 'x-job-1';

function binding(overrides: Record<string, unknown> = {}) {
  return {
    jobId,
    scanRevision: 3,
    tabId: 41,
    windowId: 7,
    frameId: 0,
    documentId: 'document-1',
    exactUrl: X_SYNC_BOOKMARKS_URL,
    nonce,
    ...overrides,
  };
}

function socialItem() {
  return {
    schemaVersion: 1,
    source: 'x',
    sourceItemId: '1890000000000000001',
    canonicalUrl: 'https://x.com/example/status/1890000000000000001',
    text: 'bounded fixture text',
    author: { handle: 'example' },
    capturedAt: '2026-07-14T00:00:00Z',
    completeness: 'summary_only',
    media: [],
    contentHash: '0'.repeat(64),
    extractorVersion: 1,
  };
}

function contentResponse(overrides: Record<string, unknown> = {}) {
  return {
    protocol: X_SYNC_PROTOCOL,
    type: 'batch-result',
    jobId,
    scanRevision: 3,
    adapterVersion: 1,
    step: 2,
    nonce,
    locationHref: X_SYNC_BOOKMARKS_URL,
    result: {
      capability: { kind: 'collection_scan', source: 'x', adapterVersion: 1 },
      signal: { kind: 'items' },
      items: [socialItem()],
      metrics: {
        observedNodes: 1,
        acceptedItems: 1,
        acceptedBytes: 512,
        elapsedMs: 20,
      },
    },
    ...overrides,
  };
}

function validationCode(operation: () => unknown): string | undefined {
  try {
    operation();
    return undefined;
  } catch (error) {
    return error instanceof XSyncMessageValidationError ? error.code : undefined;
  }
}

describe('X sync runtime messages', () => {
  it('accepts every narrow UI command without adapter, content, Vault, or outcome fields', () => {
    const requests = [
      { protocol: X_SYNC_PROTOCOL, type: 'launch', requestId: 'r1' },
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'start',
        requestId: 'r2',
        launchNonce: nonce,
        mode: 'incremental',
      },
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'resume',
        requestId: 'r3',
        jobId,
        expectedScanRevision: 2,
      },
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'pause',
        requestId: 'r4',
        jobId,
        expectedScanRevision: 3,
      },
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'finalize',
        requestId: 'r5',
        jobId,
        expectedScanRevision: 3,
      },
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'cancel',
        requestId: 'r6',
        jobId,
        expectedScanRevision: 3,
        expectedReviewRevision: 2,
      },
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'save-selection',
        requestId: 'r7',
        jobId,
        expectedReviewRevision: 0,
        selectedSourceItemIds: ['1890000000000000001'],
      },
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'complete-without-writes',
        requestId: 'r8',
        jobId,
        expectedReviewRevision: 1,
      },
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'authorize',
        requestId: 'r9',
        jobId,
        expectedReviewRevision: 1,
        selectedSourceItemIds: ['1890000000000000001'],
      },
    ];

    for (const request of requests) {
      expect(parseXSyncUiRequest(request)).toEqual(request);
    }
    expect(() => parseXSyncUiRequest({ ...requests[0], mode: 'incremental' })).toThrow(
      XSyncMessageValidationError,
    );
    expect(() =>
      parseXSyncUiRequest({
        protocol: X_SYNC_PROTOCOL,
        type: 'start',
        requestId: 'start-without-mode',
        launchNonce: nonce,
      }),
    ).toThrow(XSyncMessageValidationError);
    expect(() =>
      parseXSyncUiRequest({
        ...requests[1],
        adapterVersion: 99,
        vaultPath: 'private',
        content: 'untrusted',
        outcome: { status: 'created' },
      }),
    ).toThrow(XSyncMessageValidationError);
    expect(() =>
      parseXSyncUiRequest({
        ...requests[6],
        selectedSourceItemIds: ['1890000000000000001', '1890000000000000001'],
      }),
    ).toThrow(XSyncMessageValidationError);
  });

  it('preflights forbidden keys, accessors, proxies, prototypes, depth, nodes, and bytes', () => {
    const protoKey = {
      protocol: X_SYNC_PROTOCOL,
      type: 'launch',
      requestId: 'safe',
    } as Record<string, unknown>;
    Object.defineProperty(protoKey, '__proto__', {
      value: { polluted: true },
      enumerable: true,
    });
    expect(() => parseXSyncUiRequest(protoKey)).toThrow(XSyncMessageValidationError);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    let getterCalled = false;
    const accessor = {
      protocol: X_SYNC_PROTOCOL,
      type: 'launch',
    } as Record<string, unknown>;
    Object.defineProperty(accessor, 'requestId', {
      enumerable: true,
      get: () => {
        getterCalled = true;
        return 'unsafe';
      },
    });
    expect(() => parseXSyncUiRequest(accessor)).toThrow(XSyncMessageValidationError);
    expect(getterCalled).toBe(false);

    const customPrototype = Object.assign(Object.create({ inherited: true }), {
      protocol: X_SYNC_PROTOCOL,
      type: 'launch',
      requestId: 'unsafe',
    });
    expect(() => parseXSyncUiRequest(customPrototype)).toThrow(XSyncMessageValidationError);

    const { proxy, revoke } = Proxy.revocable(
      {
        protocol: X_SYNC_PROTOCOL,
        type: 'launch',
        requestId: 'unsafe',
      },
      {},
    );
    revoke();
    expect(() => parseXSyncUiRequest(proxy)).toThrow(XSyncMessageValidationError);

    let deep: Record<string, unknown> = { value: true };
    for (let index = 0; index < 12; index += 1) {
      deep = { next: deep };
    }
    expect(
      validationCode(() =>
        parseXSyncUiRequest({
          protocol: X_SYNC_PROTOCOL,
          type: 'launch',
          requestId: 'deep',
          extra: deep,
        }),
      ),
    ).toBe('message_too_deep');
    expect(
      validationCode(() =>
        parseXSyncUiRequest({
          protocol: X_SYNC_PROTOCOL,
          type: 'launch',
          requestId: 'nodes',
          extra: Array.from({ length: 600 }, () => 1),
        }),
      ),
    ).toBe('message_too_complex');
    let wideArrayDescriptorReads = 0;
    const wideArray = new Proxy(
      Array.from({ length: 600 }, () => 1),
      {
        getOwnPropertyDescriptor(target, property) {
          wideArrayDescriptorReads += 1;
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      },
    );
    expect(
      validationCode(() =>
        parseXSyncUiRequest({
          protocol: X_SYNC_PROTOCOL,
          type: 'launch',
          requestId: 'wide-array',
          extra: wideArray,
        }),
      ),
    ).toBe('message_too_complex');
    expect(wideArrayDescriptorReads).toBe(1);
    expect(
      validationCode(() =>
        parseXSyncUiRequest({
          protocol: X_SYNC_PROTOCOL,
          type: 'launch',
          requestId: 'x'.repeat(70 * 1_024),
        }),
      ),
    ).toBe('message_too_large');
  });

  it('strictly parses content requests, responses, ports, UI responses, and launch intents', () => {
    const request = {
      protocol: X_SYNC_PROTOCOL,
      type: 'read-batch',
      jobId,
      scanRevision: 3,
      adapterVersion: 1,
      step: 2,
      nonce,
      mode: 'incremental',
      candidateSourceItemIds: [],
      knownFrontierSourceItemIds: [],
      limits: {
        remainingCandidateSlots: 10,
        maxObservedNodes: 50,
        maxElapsedMs: 5_000,
        maxTextBytes: 8_192,
        maxMedia: 12,
        maxTotalBytes: 1_000_000,
        maxScrollActionsRemaining: 5,
        allowScroll: true,
      },
    };
    expect(parseXSyncContentRequest(request)).toEqual(request);
    expect(parseXSyncContentResponse(contentResponse()).type).toBe('batch-result');
    expect(
      parseXSyncPortMessage({
        protocol: X_SYNC_PROTOCOL,
        type: 'runtime-event',
        event: { kind: 'paused', jobId, scanRevision: 3, reason: 'rate_limited' },
      }).event.kind,
    ).toBe('paused');
    expect(
      parseXSyncUiResponse({
        protocol: X_SYNC_PROTOCOL,
        type: 'command-result',
        requestId: 'r1',
        ok: false,
        error: { code: 'tab_changed', phase: 'scanning', jobId, scanRevision: 3 },
      }).ok,
    ).toBe(false);
    expect(
      parseXSyncLaunchIntent({
        protocol: X_SYNC_PROTOCOL,
        action: 'start',
        windowId: 7,
        createdAtMs: 1_000,
        expiresAtMs: 61_000,
        nonce,
      }).expiresAtMs,
    ).toBe(61_000);

    expect(() => parseXSyncContentRequest({ ...request, unknown: true })).toThrow(
      XSyncMessageValidationError,
    );
    expect(() =>
      parseXSyncContentRequest({ ...request, candidateSourceItemIds: ['not-an-x-id'] }),
    ).toThrow(XSyncMessageValidationError);
    expect(() =>
      parseXSyncContentRequest({
        ...request,
        candidateSourceItemIds: Array.from({ length: 51 }, (_, index) => String(index + 1)),
      }),
    ).toThrow(XSyncMessageValidationError);
    expect(() =>
      parseXSyncContentRequest({
        ...request,
        candidateSourceItemIds: ['1'],
        knownFrontierSourceItemIds: ['1'],
      }),
    ).toThrow(XSyncMessageValidationError);
    expect(() =>
      parseXSyncContentResponse({
        ...contentResponse(),
        result: {
          ...(contentResponse().result as Record<string, unknown>),
          metrics: { observedNodes: 1, acceptedItems: 0, acceptedBytes: 512, elapsedMs: 20 },
        },
      }),
    ).toThrow(XSyncMessageValidationError);
    expect(() =>
      parseXSyncLaunchIntent({
        protocol: X_SYNC_PROTOCOL,
        action: 'start',
        windowId: 7,
        createdAtMs: 1_000,
        expiresAtMs: 60_999,
        nonce,
      }),
    ).toThrow(XSyncMessageValidationError);
  });

  it('binds content responses to nonce, job, revision, step, adapter, and exact page URL', () => {
    expect(matchesXSyncContentResponseBinding(contentResponse(), binding(), 2, 1)).toBe(true);
    expect(
      matchesXSyncContentResponseBinding(
        contentResponse({ nonce: 'b'.repeat(64) }),
        binding(),
        2,
        1,
      ),
    ).toBe(false);
    expect(
      matchesXSyncContentResponseBinding(contentResponse({ jobId: 'other-job' }), binding(), 2, 1),
    ).toBe(false);
    expect(
      matchesXSyncContentResponseBinding(contentResponse({ scanRevision: 4 }), binding(), 2, 1),
    ).toBe(false);
    expect(matchesXSyncContentResponseBinding(contentResponse(), binding(), 3, 1)).toBe(false);
    expect(matchesXSyncContentResponseBinding(contentResponse(), binding(), 2, 2)).toBe(false);
    expect(() => parseXSyncDocumentBinding({ ...binding(), unknown: true })).toThrow(
      XSyncMessageValidationError,
    );
  });

  it('validates exact extension origin and rejects UI/content/service-worker sender spoofing', () => {
    expect(resolveXSyncExtensionOrigin(extensionId, `${extensionOrigin}/`)).toBe(extensionOrigin);
    expect(
      resolveXSyncExtensionOrigin(extensionId, `${extensionOrigin}/popup/index.html`),
    ).toBeNull();
    expect(
      resolveXSyncExtensionOrigin(extensionId, `chrome-extension://otherabcdefghijklmnopqrstuvw/`),
    ).toBeNull();

    expect(
      validateXSyncUiSender(
        { id: extensionId, url: `${extensionOrigin}/popup/index.html`, origin: extensionOrigin },
        extensionId,
        extensionOrigin,
      ),
    ).toEqual({ ok: true, value: { surface: 'popup' } });
    expect(
      validateXSyncUiSender(
        {
          id: extensionId,
          url: `${extensionOrigin}/sidepanel/index.html`,
          origin: extensionOrigin,
          tab: { id: 41 },
        },
        extensionId,
        extensionOrigin,
      ),
    ).toMatchObject({ ok: false, code: 'sender_context_mismatch' });
    expect(
      validateXSyncUiSender(
        { id: 'ponmlkjihgfedcbaponmlkjihgfedcba', url: `${extensionOrigin}/popup/index.html` },
        extensionId,
        extensionOrigin,
      ),
    ).toMatchObject({ ok: false, code: 'extension_id_mismatch' });

    expect(
      validateXSyncServiceWorkerSender({ id: extensionId }, extensionId, extensionOrigin),
    ).toEqual({ ok: true, value: { context: 'service-worker' } });
    expect(
      validateXSyncServiceWorkerSender(
        { id: extensionId, url: `${extensionOrigin}/popup/index.html` },
        extensionId,
        extensionOrigin,
      ),
    ).toMatchObject({ ok: false, code: 'sender_surface_mismatch' });
    expect(
      validateXSyncServiceWorkerSender(
        { id: extensionId, tab: { id: 41 } },
        extensionId,
        extensionOrigin,
      ),
    ).toMatchObject({ ok: false, code: 'sender_context_mismatch' });
  });

  it('returns fixed minimal errors without copying attacker-controlled details', () => {
    const error = makeMinimalXSyncRuntimeError({
      code: 'invalid_message',
      phase: 'scanning',
      jobId,
      scanRevision: 3,
    });
    expect(error).toEqual({
      code: 'invalid_message',
      phase: 'scanning',
      jobId,
      scanRevision: 3,
    });

    const secret = 'https://x.com/private/status/123?token=secret';
    let thrown: unknown;
    try {
      parseXSyncUiRequest({
        protocol: X_SYNC_PROTOCOL,
        type: 'launch',
        requestId: 'bad',
        [secret]: true,
      });
    } catch (error) {
      thrown = error;
    }
    expect(JSON.stringify(thrown)).not.toContain(secret);
    expect((thrown as Error).message).toBe('The X sync message is invalid');
  });
});
