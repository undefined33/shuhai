import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AiProviderConfig,
  BookmarkOperation,
  ClassificationPlan,
} from '../src/shared/bookmark-types.js';
import { requestAiConsent } from '../src/tasks/bookmarks/BookmarkTaskApp.js';
import BookmarkOrganizePage from '../src/tasks/bookmarks/BookmarkOrganizePage.js';
import BookmarkRecoveryPage from '../src/tasks/bookmarks/BookmarkRecoveryPage.js';

const emptyCallbacks = {
  onApplyPlan: () => undefined,
  onCancelClassification: () => undefined,
  onClassifyModeChange: () => undefined,
  onCreatePlan: () => undefined,
  onDiscardPlan: () => undefined,
  onMoveChange: () => undefined,
  onRefresh: () => undefined,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function provider(): AiProviderConfig {
  return {
    id: 'deepseek-default',
    name: 'DeepSeek',
    provider: 'deepseek',
    enabled: true,
    model: 'deepseek-v4-flash',
    hasApiKey: true,
  };
}

function plan(): ClassificationPlan {
  return {
    mode: 'safe',
    moves: [
      {
        id: 'move-1',
        bookmarkId: 'bookmark-1',
        bookmarkTitle: 'Research article',
        bookmarkUrl: 'https://example.com/research',
        currentFolder: '',
        targetFolder: 'Research',
        confidence: 0.8,
        reason: 'rule',
        tags: [],
        selected: true,
      },
    ],
    newFolders: ['Research'],
    unchanged: 0,
    totalBookmarks: 1,
    generatedAt: '2026-07-24T00:00:00.000Z',
  };
}

function operation(): BookmarkOperation {
  return {
    id: 'operation-1',
    requestId: 'request-operation-1',
    payloadIdentity: `sha256:${'a'.repeat(64)}`,
    version: 1,
    type: 'move_bookmarks',
    status: 'partial',
    source: 'classification',
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:01.000Z',
    requestedCount: 2,
    items: [
      {
        kind: 'move',
        bookmarkId: 'bookmark-1',
        title: 'Research article',
        executionStatus: 'succeeded',
        restoreStatus: 'pending',
        executionAttemptCount: 1,
        restoreAttemptCount: 0,
        targetFolder: 'Research',
        targetStatus: 'resolved',
        folderResolution: [],
      },
      {
        kind: 'move',
        bookmarkId: 'bookmark-2',
        title: 'Changed article',
        executionStatus: 'conflict',
        restoreStatus: 'conflict',
        executionAttemptCount: 1,
        restoreAttemptCount: 1,
        targetFolder: 'Research',
        targetStatus: 'conflict',
        folderResolution: [],
      },
    ],
    summary: {
      requested: 2,
      pending: 0,
      succeeded: 1,
      failed: 0,
      skipped: 0,
      executionConflicts: 1,
      restorePending: 1,
      restored: 0,
      restoreFailed: 0,
      restoreConflicts: 1,
      acceptedCurrent: 0,
    },
    commands: [],
  };
}

describe('bookmark task UI', () => {
  it('discloses the bounded AI payload before requesting one exact provider origin', async () => {
    const confirm = vi.fn<(message: string) => boolean>(() => true);
    vi.stubGlobal('window', { confirm });
    const contains = vi.fn(
      (_permissions: chrome.permissions.Permissions, callback: (result: boolean) => void) =>
        callback(false),
    );
    const request = vi.fn(
      (_permissions: chrome.permissions.Permissions, callback: (result: boolean) => void) =>
        callback(true),
    );
    vi.stubGlobal('chrome', {
      runtime: { lastError: undefined },
      permissions: { contains, request },
    });

    await expect(requestAiConsent(provider(), 7)).resolves.toEqual({
      ai: { provider: 'deepseek', confirmed: true },
      permissionDenied: false,
    });
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0]?.[0]).toContain('本次候选数量: 7');
    expect(confirm.mock.calls[0]?.[0]).toContain('不会发送: 完整 URL');
    expect(request).toHaveBeenCalledWith(
      { origins: ['https://api.deepseek.com/*'] },
      expect.any(Function),
    );
  });

  it('falls back to local rules when AI consent or host permission is denied', async () => {
    const confirm = vi.fn<(message: string) => boolean>();
    confirm.mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal('window', { confirm });
    const request = vi.fn(
      (_permissions: chrome.permissions.Permissions, callback: (result: boolean) => void) =>
        callback(false),
    );
    vi.stubGlobal('chrome', {
      runtime: { lastError: undefined },
      permissions: {
        contains: (
          _permissions: chrome.permissions.Permissions,
          callback: (result: boolean) => void,
        ) => callback(false),
        request,
      },
    });

    await expect(requestAiConsent(provider(), 3)).resolves.toEqual({
      permissionDenied: false,
    });
    expect(request).not.toHaveBeenCalled();

    await expect(requestAiConsent(provider(), 3)).resolves.toEqual({
      permissionDenied: true,
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it('does not show an AI disclosure when there are no eligible candidates', async () => {
    const confirm = vi.fn<(message: string) => boolean>();
    vi.stubGlobal('window', { confirm });

    await expect(requestAiConsent(provider(), 0)).resolves.toEqual({
      permissionDenied: false,
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('shows one direct organize flow without old module navigation', () => {
    const markup = renderToStaticMarkup(
      <BookmarkOrganizePage
        {...emptyCallbacks}
        bookmarks={[]}
        busy={false}
        classifyMode="safe"
        folders={[]}
        mutationBlocked={false}
      />,
    );

    expect(markup).toContain('整理范围');
    expect(markup).toContain('生成整理建议');
    expect(markup).toContain('规则优先');
    expect(markup).not.toMatch(/首页|收藏内容|活动|链接体检|导出书签索引/u);
    expect(markup).not.toContain('text-[11px]');
    expect(markup.match(/<button[^>]*bg-primary/gu)).toHaveLength(1);
  });

  it('keeps review editable but blocks apply when the journal is unavailable', () => {
    const markup = renderToStaticMarkup(
      <BookmarkOrganizePage
        {...emptyCallbacks}
        bookmarks={[]}
        busy={false}
        classifyMode="safe"
        folders={[]}
        mutationBlocked
        plan={plan()}
      />,
    );

    expect(markup).toContain('恢复记录可用前不能应用更改');
    expect(markup).toContain('应用选中');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*应用选中/u);
    expect(markup).toContain('aria-label="整理建议操作"');
    expect(markup.indexOf('aria-label="整理建议列表"')).toBeLessThan(
      markup.indexOf('aria-label="整理建议操作"'),
    );
    expect(markup).not.toContain('重复项');
  });

  it('disables the only apply action when the user selects zero proposals', () => {
    const zeroSelectedPlan = {
      ...plan(),
      moves: plan().moves.map((move) => ({ ...move, selected: false })),
    };
    const markup = renderToStaticMarkup(
      <BookmarkOrganizePage
        {...emptyCallbacks}
        bookmarks={[]}
        busy={false}
        classifyMode="safe"
        folders={[]}
        mutationBlocked={false}
        plan={zeroSelectedPlan}
      />,
    );

    expect(markup).toContain('0</strong> <span class="text-muted-foreground">条已选');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*应用选中/u);
  });

  it('announces bounded classification progress without implying a mutation', () => {
    const markup = renderToStaticMarkup(
      <BookmarkOrganizePage
        {...emptyCallbacks}
        bookmarks={[]}
        busy
        classificationProgress={{
          batch: 2,
          done: 500,
          elapsedMs: 200,
          total: 1_000,
          totalBatches: 4,
        }}
        classifyMode="safe"
        folders={[]}
        mutationBlocked={false}
      />,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('已分析 500 / 1,000');
    expect(markup).toContain('不会移动或删除任何 Chrome 书签');
  });

  it('shows every retained operation and centralizes recovery actions', () => {
    const current = operation();
    const markup = renderToStaticMarkup(
      <BookmarkRecoveryPage
        busy={false}
        onAcceptCurrent={() => undefined}
        onCancel={() => undefined}
        onRestore={() => undefined}
        onSelect={() => undefined}
        operations={[current]}
        selectedOperationId={current.id}
      />,
    );

    expect(markup).toContain('操作记录');
    expect(markup).toContain('部分完成');
    expect(markup).toContain('恢复成功项');
    expect(markup).toContain('接受当前状态');
    expect(markup).toContain('恢复冲突');
    expect(markup).not.toContain('text-[11px]');
  });
});
