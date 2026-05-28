export type ClassificationReason = 'folder' | 'rule' | 'ai' | 'manual';
export type ClassificationMode = 'safe' | 'full';
export type ExportScope = 'all' | 'plan' | 'selected';
export type CaptureSource = 'page' | 'twitter' | 'weibo' | 'article';
export type UrlHealthStatus = 'alive' | 'redirected' | 'dead' | 'error' | 'skipped';
export type AiProviderType = 'deepseek' | 'kimi' | 'glm' | 'openai-compatible';

export interface AiProviderConfig {
  id: string;
  name: string;
  provider: AiProviderType;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AiProviderTemplate {
  provider: AiProviderType;
  name: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  description: string;
}

export interface AiProviderTestResult {
  success: boolean;
  message: string;
  status?: number;
}

export const PROVIDER_TEMPLATES: AiProviderTemplate[] = [
  {
    provider: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    description: '高性价比，适合书签分类',
  },
  {
    provider: 'kimi',
    name: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    description: '月之暗面，支持长上下文',
  },
  {
    provider: 'glm',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-plus', 'glm-4'],
    description: '智谱 AI，国产大模型',
  },
  {
    provider: 'openai-compatible',
    name: '自定义 (OpenAI 兼容)',
    baseUrl: '',
    defaultModel: '',
    models: [],
    description: '任何兼容 OpenAI /chat/completions 接口的服务',
  },
];

export interface BookmarkNode {
  id: string;
  title: string;
  url?: string;
  parentId?: string;
  index?: number;
  dateAdded?: number;
  children?: BookmarkNode[];
  folderPath: string;
  bookmarkCount: number;
}

export interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  parentId: string;
  parentTitle: string;
  parentPath: string;
  index: number;
  dateAdded?: number;
}

export interface FolderItem {
  id: string;
  title: string;
  path: string;
  parentId?: string;
  bookmarkCount: number;
}

export interface CustomRule {
  type: 'domain' | 'title-keyword';
  pattern: string;
  category: string;
  tags: string[];
}

export interface ClassificationSuggestion {
  bookmarkId: string;
  targetFolder: string;
  confidence: number;
  reason: ClassificationReason;
  ruleName?: string;
  tags: string[];
}

export interface MovePlan {
  id: string;
  bookmarkId: string;
  bookmarkTitle: string;
  bookmarkUrl: string;
  currentFolder: string;
  targetFolder: string;
  confidence: number;
  reason: ClassificationReason;
  ruleName?: string;
  tags: string[];
  selected: boolean;
}

export interface ClassificationPlan {
  mode: ClassificationMode;
  moves: MovePlan[];
  newFolders: string[];
  unchanged: number;
  totalBookmarks: number;
  generatedAt: string;
}

export interface ClassificationProgress {
  done: number;
  total: number;
  batch: number;
  totalBatches: number;
  elapsedMs: number;
  remainingMs?: number;
  cancelled?: boolean;
}

export interface UrlHealthSummary {
  alive: number;
  redirected: number;
  dead: number;
  error: number;
  skipped: number;
}

export interface UrlHealthRecord {
  bookmarkId: string;
  bookmarkTitle: string;
  bookmarkUrl: string;
  parentPath: string;
  status: UrlHealthStatus;
  checkedAt: string;
  durationMs: number;
  httpStatus?: number;
  finalUrl?: string;
  error?: string;
}

export interface UrlHealthProgress {
  done: number;
  total: number;
  elapsedMs: number;
  remainingMs?: number;
  currentUrl?: string;
  summary: UrlHealthSummary;
}

export type UrlHealthPortRequest =
  | { type: 'health:check'; bookmarkIds?: string[] }
  | { type: 'pause' }
  | { type: 'cancel' };

export type UrlHealthPortMessage =
  | { type: 'progress'; progress: UrlHealthProgress; records: UrlHealthRecord[] }
  | {
      type: 'complete';
      progress: UrlHealthProgress;
      records: UrlHealthRecord[];
      cancelled: boolean;
    }
  | { type: 'error'; error: string };

export type ClassificationPortRequest =
  | { type: 'plan:create'; mode: ClassificationMode }
  | { type: 'cancel' };

export type ClassificationPortMessage =
  | { type: 'progress'; progress: ClassificationProgress }
  | {
      type: 'complete';
      plan: ClassificationPlan;
      progress: ClassificationProgress;
      cancelled: boolean;
    }
  | { type: 'error'; error: string };

export interface MoveRecord {
  bookmarkId: string;
  bookmarkTitle: string;
  fromParentId: string;
  fromIndex: number;
  toParentId: string;
}

export interface ApplyFailure {
  bookmarkId: string;
  bookmarkTitle: string;
  error: string;
}

export interface ApplyResult {
  moved: number;
  failed: ApplyFailure[];
  backupKey: string;
  records: MoveRecord[];
}

export interface BackupRecord {
  key: string;
  createdAt: string;
  bookmarkCount: number;
  tree: BookmarkNode[];
}

export interface AppSettings {
  useAi: boolean;
  activeProviderId: string;
  aiProviders: AiProviderConfig[];
  customRules: CustomRule[];
  defaultClassifyMode: ClassificationMode;
  exportDirectory: string;
}

export interface ExportManifest {
  id: string;
  exportedAt: string;
  vaultPath: string;
  files: string[];
  bookmarkCount: number;
}

export interface ExportPreviewFolder {
  path: string;
  count: number;
}

export interface ExportPreview {
  total: number;
  folders: ExportPreviewFolder[];
}

export interface CapturedMedia {
  url: string;
  alt?: string;
}

export interface CapturedContent {
  id: string;
  source: CaptureSource;
  title: string;
  url: string;
  author?: string;
  handle?: string;
  created?: string;
  text: string;
  media: CapturedMedia[];
  tags: string[];
  capturedAt: string;
  siteName?: string;
  description?: string;
  wordCount?: number;
}

export interface ExtensionState {
  tree: BookmarkNode[];
  bookmarks: BookmarkItem[];
  folders: FolderItem[];
  backups: BackupRecord[];
  exportManifests: ExportManifest[];
  pendingCaptures: CapturedContent[];
  urlHealthRecords: UrlHealthRecord[];
  lastMoveRecordCount: number;
  onboarded: boolean;
  settings: AppSettings;
}

export type ExtensionRequest =
  | { type: 'state:get' }
  | { type: 'plan:create'; mode: ClassificationMode }
  | {
      type: 'plan:apply';
      plan: ClassificationPlan;
      selectedMoveIds: string[];
    }
  | { type: 'plan:undoLast' }
  | { type: 'settings:get' }
  | { type: 'settings:set'; settings: AppSettings }
  | { type: 'ai:testConnection'; provider: AiProviderConfig }
  | { type: 'onboarding:set'; onboarded: boolean }
  | { type: 'capture:getPending' }
  | { type: 'capture:removePending'; id: string }
  | { type: 'capture:clearPending' }
  | { type: 'health:clearRecords' }
  | { type: 'bookmark:delete'; id: string }
  | { type: 'bookmark:updateUrl'; id: string; url: string }
  | { type: 'backups:list' };

export type ExtensionResponse =
  | { ok: true; data: ExtensionState }
  | { ok: true; data: ClassificationPlan }
  | { ok: true; data: ApplyResult }
  | { ok: true; data: BackupRecord[] }
  | { ok: true; data: AppSettings }
  | { ok: true; data: AiProviderTestResult }
  | { ok: true; data: { undone: number } }
  | { ok: true; data: { onboarded: boolean } }
  | { ok: true; data: CapturedContent[] }
  | { ok: true; data: { removed: boolean } }
  | { ok: true; data: { cleared: boolean } }
  | { ok: true; data: { deleted: boolean; backupKey: string } }
  | { ok: true; data: { updated: boolean; backupKey: string } }
  | { ok: false; error: string };
