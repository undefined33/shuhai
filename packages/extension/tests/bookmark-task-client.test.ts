import { afterEach, describe, expect, it, vi } from 'vitest';

import { startClassificationSession } from '../src/tasks/bookmarks/bookmark-task-client.js';

interface FakePort {
  readonly port: chrome.runtime.Port;
  readonly posted: unknown[];
  emit(message: unknown): void;
  readonly disconnectSpy: ReturnType<typeof vi.fn>;
}

function fakePort(): FakePort {
  const messageListeners = new Set<(message: unknown) => void>();
  const disconnectListeners = new Set<() => void>();
  const posted: unknown[] = [];
  const disconnectSpy = vi.fn(() => {
    for (const listener of disconnectListeners) listener();
  });
  const port = {
    name: 'classify',
    sender: undefined,
    error: undefined,
    postMessage(message: unknown) {
      posted.push(message);
    },
    disconnect: disconnectSpy,
    onMessage: {
      addListener(listener: (message: unknown) => void) {
        messageListeners.add(listener);
      },
      removeListener(listener: (message: unknown) => void) {
        messageListeners.delete(listener);
      },
      hasListener(listener: (message: unknown) => void) {
        return messageListeners.has(listener);
      },
      hasListeners() {
        return messageListeners.size > 0;
      },
    },
    onDisconnect: {
      addListener(listener: () => void) {
        disconnectListeners.add(listener);
      },
      removeListener(listener: () => void) {
        disconnectListeners.delete(listener);
      },
      hasListener(listener: () => void) {
        return disconnectListeners.has(listener);
      },
      hasListeners() {
        return disconnectListeners.size > 0;
      },
    },
  } as unknown as chrome.runtime.Port;

  return {
    port,
    posted,
    emit(message) {
      for (const listener of messageListeners) listener(message);
    },
    disconnectSpy,
  };
}

function installChrome(port: chrome.runtime.Port): void {
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      lastError: undefined,
      connect: vi.fn(() => port),
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bookmark classification session', () => {
  it('accepts only the correlated completion and disconnects after success', async () => {
    const fixture = fakePort();
    installChrome(fixture.port);
    const session = startClassificationSession({
      mode: 'safe',
      onProgress: vi.fn(),
    });
    const request = fixture.posted[0] as { requestId: string };

    fixture.emit({
      type: 'complete',
      requestId: request.requestId,
      plan: {
        mode: 'safe',
        moves: [],
        newFolders: [],
        unchanged: 2,
        totalBookmarks: 2,
        generatedAt: '2026-07-24T00:00:00.000Z',
      },
      progress: {
        done: 2,
        total: 2,
        batch: 1,
        totalBatches: 1,
        elapsedMs: 1,
      },
      cancelled: false,
    });

    await expect(session.result).resolves.toMatchObject({ unchanged: 2 });
    expect(fixture.disconnectSpy).toHaveBeenCalledOnce();
  });

  it('rejects an uncorrelated port response instead of accepting another task result', async () => {
    const fixture = fakePort();
    installChrome(fixture.port);
    const session = startClassificationSession({
      mode: 'safe',
      onProgress: vi.fn(),
    });

    fixture.emit({
      type: 'progress',
      requestId: 'classify:00000000-0000-4000-8000-000000000000',
      progress: {
        done: 1,
        total: 2,
        batch: 1,
        totalBatches: 2,
        elapsedMs: 1,
      },
    });

    await expect(session.result).rejects.toMatchObject({ errorCode: 'response_invalid' });
  });

  it('uses a correlated cancel request and waits for its matching acknowledgement', async () => {
    const fixture = fakePort();
    installChrome(fixture.port);
    const session = startClassificationSession({
      mode: 'full',
      onProgress: vi.fn(),
    });
    const planRequest = fixture.posted[0] as { requestId: string };

    expect(session.cancel()).toBe(true);
    expect(session.cancel()).toBe(false);
    const cancelRequest = fixture.posted[1] as {
      requestId: string;
      targetRequestId: string;
    };
    expect(cancelRequest.targetRequestId).toBe(planRequest.requestId);

    fixture.emit({
      type: 'cancelled',
      requestId: cancelRequest.requestId,
      targetRequestId: planRequest.requestId,
    });

    await expect(session.result).rejects.toMatchObject({
      errorCode: 'classification_cancelled',
    });
  });

  it('disconnects and rejects when the task surface closes', async () => {
    const fixture = fakePort();
    installChrome(fixture.port);
    const session = startClassificationSession({
      mode: 'safe',
      onProgress: vi.fn(),
    });

    session.dispose();

    await expect(session.result).rejects.toMatchObject({
      errorCode: 'classification_cancelled',
    });
    expect(fixture.disconnectSpy).toHaveBeenCalledOnce();
  });
});
