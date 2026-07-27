import { describe, expect, it } from 'vitest';

import {
  SURFACE_ERROR_MESSAGES,
  SURFACE_PROTOCOL,
  SURFACE_REGISTRY_KEY,
  emptySurfaceSessionRegistry,
  hasSurfaceProtocol,
  makeSurfaceError,
  makeSurfaceSuccess,
  parseSurfaceRequest,
  parseSurfaceResponse,
  parseSurfaceSessionRegistry,
  type SurfaceRequest,
} from '../src/shared/surface-contract.js';

const summaryRequest: SurfaceRequest = {
  protocol: SURFACE_PROTOCOL,
  version: 1,
  type: 'summary',
  requestId: 'summary:test',
  windowId: 7,
};

describe('surface contract', () => {
  it('keeps one fixed session key shared by every surface', () => {
    expect(SURFACE_REGISTRY_KEY).toBe('shuhai:surface:v1:registry');
  });

  it.each([
    { ...summaryRequest, unexpected: true },
    { ...summaryRequest, requestId: 'unsafe id' },
    { ...summaryRequest, windowId: -1 },
    {
      ...summaryRequest,
      type: 'launch',
      target: 'unsupported',
    },
    {
      ...summaryRequest,
      type: 'ackLaunch',
    },
  ])('rejects a malformed or non-strict request', (request) => {
    expect(() => parseSurfaceRequest(request)).toThrow();
  });

  it('rejects a request above the byte budget before schema parsing', () => {
    expect(() =>
      parseSurfaceRequest({
        ...summaryRequest,
        requestId: `summary:${'a'.repeat(600)}`,
      }),
    ).toThrow();
  });

  it('correlates a strict summary response with its request', () => {
    const response = makeSurfaceSuccess(summaryRequest, {
      bookmarkCount: 1_000_000,
      folderCount: 0,
      vaultConfigured: true,
      aiConfigured: false,
      lastSavedAt: '2026-07-24T00:00:00.000Z',
      activeTask: {
        kind: 'x-sync',
        status: 'paused',
        updatedAt: '2026-07-24T00:00:00.000Z',
      },
      pendingLaunch: null,
    });

    expect(parseSurfaceResponse(summaryRequest, response)).toEqual(response);
    expect(() =>
      parseSurfaceResponse(summaryRequest, { ...response, requestId: 'summary:other' }),
    ).toThrow();
  });

  it('represents lightweight metadata as unavailable instead of fabricating counts or setup', () => {
    const response = makeSurfaceSuccess(summaryRequest, {
      bookmarkCount: null,
      folderCount: null,
      vaultConfigured: null,
      aiConfigured: null,
      lastSavedAt: null,
      activeTask: null,
      pendingLaunch: null,
    });

    expect(parseSurfaceResponse(summaryRequest, response)).toEqual(response);
  });

  it('rejects forbidden fields and private data in a summary response', () => {
    const response = makeSurfaceSuccess(summaryRequest, {
      bookmarkCount: 1,
      folderCount: 1,
      vaultConfigured: false,
      aiConfigured: false,
      lastSavedAt: null,
      activeTask: null,
      pendingLaunch: null,
    });

    expect(() =>
      parseSurfaceResponse(summaryRequest, {
        ...response,
        data: {
          ...response.data,
          bookmarkUrl: 'https://private.example/',
        },
      }),
    ).toThrow();
  });

  it('returns only fixed error messages and rejects code/message mismatches', () => {
    const response = makeSurfaceError(summaryRequest.requestId, 'summary_unavailable');
    expect(response.message).toBe(SURFACE_ERROR_MESSAGES.summary_unavailable);
    expect(parseSurfaceResponse(summaryRequest, response)).toEqual(response);
    expect(() =>
      parseSurfaceResponse(summaryRequest, {
        ...response,
        message: 'raw IndexedDB exception',
      }),
    ).toThrow();
  });

  it('bounds pending intents and tombstones in the session registry', () => {
    expect(parseSurfaceSessionRegistry(emptySurfaceSessionRegistry())).toEqual({
      version: 1,
      pending: [],
      tombstones: [],
    });

    expect(() =>
      parseSurfaceSessionRegistry({
        version: 1,
        pending: Array.from({ length: 9 }, (_, index) => ({
          intentId: `surface-${index}`,
          target: 'x-sync',
          windowId: index,
          expiresAtMs: 100,
        })),
        tombstones: [],
      }),
    ).toThrow();
  });

  it('detects a surface envelope without evaluating an accessor', () => {
    const message = {};
    Object.defineProperty(message, 'protocol', {
      get() {
        throw new Error('must not run');
      },
    });
    expect(hasSurfaceProtocol(message)).toBe(true);
  });
});
