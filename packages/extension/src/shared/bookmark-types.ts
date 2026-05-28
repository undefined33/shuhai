export type ClassificationReason = 'folder' | 'rule' | 'ai' | 'manual';
export type ClassificationMode = 'safe' | 'full';
export type ExportScope = 'all' | 'plan' | 'selected';
export type CaptureSource = 'page' | 'twitter' | 'weibo' | 'article';

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
  deepSeekApiKey: string;
  deepSeekModel: 'deepseek-chat' | 'deepseek-reasoner';
  useAi: boolean;
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
  | { type: 'onboarding:set'; onboarded: boolean }
  | { type: 'capture:getPending' }
  | { type: 'capture:removePending'; id: string }
  | { type: 'capture:clearPending' }
  | { type: 'backups:list' };

export type ExtensionResponse =
  | { ok: true; data: ExtensionState }
  | { ok: true; data: ClassificationPlan }
  | { ok: true; data: ApplyResult }
  | { ok: true; data: BackupRecord[] }
  | { ok: true; data: AppSettings }
  | { ok: true; data: { undone: number } }
  | { ok: true; data: { onboarded: boolean } }
  | { ok: true; data: CapturedContent[] }
  | { ok: true; data: { removed: boolean } }
  | { ok: true; data: { cleared: boolean } }
  | { ok: false; error: string };
