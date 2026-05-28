import type {
  ClassificationPlan,
  FolderItem,
  MovePlan,
} from '../../shared/bookmark-types.js';

interface ClassifyPreviewProps {
  plan: ClassificationPlan;
  folders: FolderItem[];
  busy: boolean;
  selectedCount: number;
  onMoveChange(move: MovePlan): void;
  onApply(): void;
  onCancel(): void;
}

function confidenceLabel(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export default function ClassifyPreview({
  plan,
  folders,
  busy,
  selectedCount,
  onMoveChange,
  onApply,
  onCancel,
}: ClassifyPreviewProps) {
  const folderPaths = folders.map((folder) => folder.path).filter(Boolean);

  return (
    <section className="panel">
      <div className="preview-header">
        <div>
          <h2>整理方案</h2>
          <p>
            {plan.moves.length} 条建议，{plan.unchanged} 个书签保持不动
          </p>
        </div>
        <div className="actions">
          <button onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button className="primary" onClick={onApply} disabled={busy || selectedCount === 0}>
            应用选中
          </button>
        </div>
      </div>

      {plan.newFolders.length > 0 ? (
        <div className="notice">
          将创建 {plan.newFolders.length} 个新文件夹：{plan.newFolders.join('、')}
        </div>
      ) : null}

      <div className="move-list">
        {plan.moves.map((move) => (
          <article className={move.selected ? 'move-card selected' : 'move-card'} key={move.id}>
            <label className="move-check">
              <input
                type="checkbox"
                checked={move.selected}
                onChange={(event) =>
                  onMoveChange({
                    ...move,
                    selected: event.target.checked,
                  })
                }
              />
              <span>{move.bookmarkTitle}</span>
            </label>
            <small>{move.bookmarkUrl}</small>
            <div className="diff-line">
              <span>{move.currentFolder || '根目录'}</span>
              <strong>→</strong>
              <input
                list="folder-paths"
                value={move.targetFolder}
                onChange={(event) =>
                  onMoveChange({
                    ...move,
                    targetFolder: event.target.value,
                  })
                }
              />
            </div>
            <div className="meta-line">
              <span>{move.reason === 'ai' ? 'AI' : move.ruleName ?? '规则'}</span>
              <span>置信度 {confidenceLabel(move.confidence)}</span>
              {move.confidence < 0.6 ? <span className="low">需手动确认</span> : null}
            </div>
          </article>
        ))}
      </div>

      <datalist id="folder-paths">
        {folderPaths.map((path) => (
          <option key={path} value={path} />
        ))}
      </datalist>
    </section>
  );
}
