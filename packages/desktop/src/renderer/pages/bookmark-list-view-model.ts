import type { UrlCheckProgress } from '../../main/health/index.js';
import type { BookmarkClassificationRecord } from '../../preload.js';
import type { SyncResult } from '../../main/sync/index.js';

export const SLOW_CLASSIFICATION_THRESHOLD_MS = 15_000;

export type WorkflowStepId = 'classify' | 'check' | 'export';
export type WorkflowStepStatus = 'pending' | 'active' | 'done';
export type WorkflowTone = 'neutral' | 'progress' | 'success' | 'warning';

export interface WorkflowGuideState {
  bookmarkCount: number;
  visibleCount: number;
  classifiedCount: number;
  checkedCount: number;
  exportState: 'idle' | 'exporting' | 'done' | 'error';
  isClassifying: boolean;
  isCheckingLinks: boolean;
  hasVaultPath: boolean;
  hasAiProvider: boolean;
  isLoading: boolean;
}

export interface WorkflowStep {
  id: WorkflowStepId;
  label: string;
  status: WorkflowStepStatus;
  detail: string;
}

export interface WorkflowGuide {
  title: string;
  nextAction: string;
  tone: WorkflowTone;
  steps: WorkflowStep[];
}

export interface EmptyBookmarkState {
  title: string;
  detail: string;
}

export function formatSyncMessage(result: SyncResult): string {
  return `书签已同步：新增 ${result.added}，更新 ${result.updated}，移除 ${result.removed}`;
}

export function formatUrlCheckProgress(progress: UrlCheckProgress): string {
  const parts = [
    `检测中：${progress.completed}/${progress.total}`,
    `有效 ${progress.alive}`,
    `死链 ${progress.dead}`,
    `重定向 ${progress.redirect}`,
    `错误 ${progress.errors}`,
  ];

  return parts.join('，');
}

export function classificationRecordToMap(
  record: BookmarkClassificationRecord,
): Map<string, BookmarkClassificationRecord[string]> {
  return new Map(Object.entries(record));
}

export function getEmptyBookmarkState(
  totalBookmarks: number,
  visibleBookmarks: number,
): EmptyBookmarkState | null {
  if (visibleBookmarks > 0) {
    return null;
  }

  if (totalBookmarks === 0) {
    return {
      title: '尚未同步到书签',
      detail: '请确认 Chrome 配置文件正确，或点击刷新重新读取。',
    };
  }

  return {
    title: '当前筛选条件无匹配结果',
    detail: '试试清除搜索关键词，或切回“全部”分类。',
  };
}

export function getWorkflowGuide(state: WorkflowGuideState): WorkflowGuide {
  const steps = getWorkflowSteps(state);
  const activeTone: WorkflowTone =
    state.isClassifying || state.isCheckingLinks || state.exportState === 'exporting'
      ? 'progress'
      : 'neutral';

  if (state.isLoading) {
    return {
      title: '导出流程',
      nextAction: '正在读取 Chrome 书签。',
      tone: 'progress',
      steps,
    };
  }

  if (state.bookmarkCount === 0) {
    return {
      title: '导出流程',
      nextAction: '没有可处理的书签，先确认 Chrome Profile 或点击刷新。',
      tone: 'warning',
      steps,
    };
  }

  if (state.visibleCount === 0) {
    return {
      title: '导出流程',
      nextAction: '当前筛选没有书签，清空搜索或切回“全部”后再操作。',
      tone: 'warning',
      steps,
    };
  }

  if (state.isClassifying) {
    return {
      title: '导出流程',
      nextAction: '正在分类当前列表，结果会保存到 ShuHai 本地库，不会修改 Chrome 原始书签。',
      tone: 'progress',
      steps,
    };
  }

  if (state.isCheckingLinks) {
    return {
      title: '导出流程',
      nextAction: '正在检测链接状态，完成后导出会带上 alive、dead、redirect 等状态。',
      tone: 'progress',
      steps,
    };
  }

  if (state.exportState === 'exporting') {
    return {
      title: '导出流程',
      nextAction: '正在写入 Obsidian Vault。',
      tone: 'progress',
      steps,
    };
  }

  if (state.exportState === 'done') {
    return {
      title: '导出流程',
      nextAction: '导出完成，可以在 Obsidian 的 Bookmarks 目录查看结果。',
      tone: 'success',
      steps,
    };
  }

  if (state.exportState === 'error') {
    return {
      title: '导出流程',
      nextAction: '上次导出失败，检查 Vault 路径或权限后再试。',
      tone: 'warning',
      steps,
    };
  }

  if (!state.hasVaultPath) {
    return {
      title: '导出流程',
      nextAction: '先完成向导选择 Obsidian Vault，之后才能导出 Markdown。',
      tone: 'warning',
      steps,
    };
  }

  if (state.classifiedCount === 0) {
    const action = state.hasAiProvider
      ? '先点 AI 分类，分类会保存到 ShuHai；完成后再检测链接或导出。'
      : '未配置 AI 时会使用规则分类；先点 AI 分类完成本地整理。';
    return {
      title: '导出流程',
      nextAction: action,
      tone: activeTone,
      steps,
    };
  }

  if (state.checkedCount === 0) {
    return {
      title: '导出流程',
      nextAction: '建议先点 检测链接，让导出的状态和 Dashboard 死链列表更准确。',
      tone: activeTone,
      steps,
    };
  }

  return {
    title: '导出流程',
    nextAction: '现在可以导出到 Obsidian，分类、标签和链接状态会写入 Markdown。',
    tone: activeTone,
    steps,
  };
}

export function getSlowClassificationMessage(
  elapsedMs: number,
  hasAiProvider: boolean,
): string | null {
  if (elapsedMs < SLOW_CLASSIFICATION_THRESHOLD_MS) {
    return null;
  }

  if (hasAiProvider) {
    return 'AI 分类耗时较长，请检查 API Key、模型服务或网络；分类完成前请先不要重复点击。';
  }

  return '规则分类耗时异常，可以刷新书签后重试。';
}

function getWorkflowSteps(state: WorkflowGuideState): WorkflowStep[] {
  return [
    {
      id: 'classify',
      label: '分类整理',
      status: getStepStatus(state.isClassifying, state.classifiedCount > 0),
      detail: getClassificationDetail(state),
    },
    {
      id: 'check',
      label: '检测链接',
      status: getStepStatus(state.isCheckingLinks, state.checkedCount > 0),
      detail: state.checkedCount > 0
        ? `已检测 ${state.checkedCount} 条`
        : '补齐 alive/dead/redirect',
    },
    {
      id: 'export',
      label: '导出 Vault',
      status: getStepStatus(state.exportState === 'exporting', state.exportState === 'done'),
      detail: getExportDetail(state),
    },
  ];
}

function getStepStatus(isActive: boolean, isDone: boolean): WorkflowStepStatus {
  if (isActive) {
    return 'active';
  }
  return isDone ? 'done' : 'pending';
}

function getClassificationDetail(state: WorkflowGuideState): string {
  if (state.isClassifying) {
    return '保存到本地库';
  }
  if (state.classifiedCount > 0) {
    return `已整理 ${state.classifiedCount} 条`;
  }
  return state.hasAiProvider ? '可用 AI 优化目录' : '使用规则分类';
}

function getExportDetail(state: WorkflowGuideState): string {
  if (!state.hasVaultPath) {
    return '先选择 Vault';
  }
  if (state.exportState === 'exporting') {
    return '正在写入 Markdown';
  }
  if (state.exportState === 'done') {
    return '已生成 Markdown';
  }
  if (state.exportState === 'error') {
    return '等待重试';
  }
  return '生成 Markdown 和 Dashboard';
}
