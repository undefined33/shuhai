import { describe, expect, it } from 'vitest';
import {
  classificationRecordToMap,
  formatSyncMessage,
  formatUrlCheckProgress,
  getEmptyBookmarkState,
  getSlowClassificationMessage,
  getWorkflowGuide,
} from '../src/renderer/pages/bookmark-list-view-model.js';

describe('BookmarkList view model', () => {
  it('formats bookmark sync results for realtime refresh feedback', () => {
    expect(formatSyncMessage({
      added: 2,
      updated: 1,
      removed: 3,
      total: 20,
    })).toBe('书签已同步：新增 2，更新 1，移除 3');
  });

  it('formats URL health check progress', () => {
    expect(formatUrlCheckProgress({
      total: 100,
      completed: 12,
      alive: 8,
      dead: 3,
      redirect: 1,
      errors: 0,
      currentUrl: 'https://example.com',
    })).toBe('检测中：12/100，有效 8，死链 3，重定向 1，错误 0');
  });

  it('restores IPC-safe classification records into renderer maps', () => {
    const classifications = classificationRecordToMap({
      'https://example.com': {
        category: '开发/文档',
        tags: ['docs'],
        confidence: 0.82,
        aiClassified: true,
      },
    });

    expect(classifications).toBeInstanceOf(Map);
    expect(classifications.get('https://example.com')).toEqual({
      category: '开发/文档',
      tags: ['docs'],
      confidence: 0.82,
      aiClassified: true,
    });
  });

  it('separates empty bookmarks from empty filters', () => {
    expect(getEmptyBookmarkState(0, 0)).toEqual({
      title: '尚未同步到书签',
      detail: '请确认 Chrome 配置文件正确，或点击刷新重新读取。',
    });
    expect(getEmptyBookmarkState(5, 0)).toEqual({
      title: '当前筛选条件无匹配结果',
      detail: '试试清除搜索关键词，或切回“全部”分类。',
    });
    expect(getEmptyBookmarkState(5, 2)).toBeNull();
  });

  it('guides users through classification before link checks and export', () => {
    const guide = getWorkflowGuide({
      bookmarkCount: 12,
      visibleCount: 12,
      classifiedCount: 0,
      checkedCount: 0,
      exportState: 'idle',
      isClassifying: false,
      isCheckingLinks: false,
      hasVaultPath: true,
      hasAiProvider: true,
      isLoading: false,
    });

    expect(guide.nextAction).toBe(
      '先点 AI 分类，分类会保存到 ShuHai；完成后再检测链接或导出。',
    );
    expect(guide.steps.map((step) => step.status)).toEqual(['pending', 'pending', 'pending']);
  });

  it('explains that active classification is saved locally and does not change Chrome', () => {
    const guide = getWorkflowGuide({
      bookmarkCount: 3,
      visibleCount: 3,
      classifiedCount: 0,
      checkedCount: 0,
      exportState: 'idle',
      isClassifying: true,
      isCheckingLinks: false,
      hasVaultPath: true,
      hasAiProvider: true,
      isLoading: false,
    });

    expect(guide.nextAction).toContain('不会修改 Chrome 原始书签');
    expect(guide.steps[0]?.status).toBe('active');
  });

  it('prompts for link checking after bookmarks have categories', () => {
    const guide = getWorkflowGuide({
      bookmarkCount: 10,
      visibleCount: 10,
      classifiedCount: 8,
      checkedCount: 0,
      exportState: 'idle',
      isClassifying: false,
      isCheckingLinks: false,
      hasVaultPath: true,
      hasAiProvider: false,
      isLoading: false,
    });

    expect(guide.nextAction).toBe(
      '建议先点 检测链接，让导出的状态和 Dashboard 死链列表更准确。',
    );
    expect(guide.steps[0]?.status).toBe('done');
  });

  it('blocks export guidance when no Vault path is configured', () => {
    const guide = getWorkflowGuide({
      bookmarkCount: 4,
      visibleCount: 4,
      classifiedCount: 4,
      checkedCount: 4,
      exportState: 'idle',
      isClassifying: false,
      isCheckingLinks: false,
      hasVaultPath: false,
      hasAiProvider: true,
      isLoading: false,
    });

    expect(guide.tone).toBe('warning');
    expect(guide.nextAction).toBe('先完成向导选择 Obsidian Vault，之后才能导出 Markdown。');
  });

  it('confirms successful export', () => {
    const guide = getWorkflowGuide({
      bookmarkCount: 4,
      visibleCount: 4,
      classifiedCount: 4,
      checkedCount: 4,
      exportState: 'done',
      isClassifying: false,
      isCheckingLinks: false,
      hasVaultPath: true,
      hasAiProvider: true,
      isLoading: false,
    });

    expect(guide.tone).toBe('success');
    expect(guide.nextAction).toBe('导出完成，可以在 Obsidian 的 Bookmarks 目录查看结果。');
  });

  it('warns when AI classification takes too long', () => {
    expect(getSlowClassificationMessage(14_999, true)).toBeNull();
    expect(getSlowClassificationMessage(15_000, true)).toContain('API Key');
    expect(getSlowClassificationMessage(15_000, false)).toContain('规则分类');
  });
});
