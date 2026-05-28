export type ClassificationReason = 'folder' | 'rule' | 'ai' | 'manual';

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
  moves: MovePlan[];
  newFolders: string[];
  unchanged: number;
  totalBookmarks: number;
  generatedAt: string;
}

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
}

export interface ExtensionState {
  tree: BookmarkNode[];
  bookmarks: BookmarkItem[];
  folders: FolderItem[];
  backups: BackupRecord[];
  lastMoveRecordCount: number;
  settings: AppSettings;
}

export type ExtensionRequest =
  | { type: 'state:get' }
  | { type: 'plan:create' }
  | {
      type: 'plan:apply';
      plan: ClassificationPlan;
      selectedMoveIds: string[];
    }
  | { type: 'plan:undoLast' }
  | { type: 'settings:get' }
  | { type: 'settings:set'; settings: AppSettings }
  | { type: 'backups:list' };

export type ExtensionResponse =
  | { ok: true; data: ExtensionState }
  | { ok: true; data: ClassificationPlan }
  | { ok: true; data: ApplyResult }
  | { ok: true; data: BackupRecord[] }
  | { ok: true; data: AppSettings }
  | { ok: true; data: { undone: number } }
  | { ok: false; error: string };
