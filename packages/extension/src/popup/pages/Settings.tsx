import { useEffect, useState } from 'react';
import type {
  AppSettings,
  BackupRecord,
  CustomRule,
  ExportManifest,
} from '../../shared/bookmark-types.js';

interface SettingsProps {
  backups: BackupRecord[];
  busy: boolean;
  exportManifests: ExportManifest[];
  settings: AppSettings;
  onSave(settings: AppSettings): void;
  onDownloadBackup(backup: BackupRecord): void;
}

function stringifyRules(rules: CustomRule[]): string {
  return JSON.stringify(rules, null, 2);
}

function parseRules(value: string): CustomRule[] {
  const parsed = JSON.parse(value) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error('自定义规则必须是数组');
  }

  return parsed.map((item) => {
    const rule = item as Partial<CustomRule>;
    if (
      (rule.type !== 'domain' && rule.type !== 'title-keyword') ||
      typeof rule.pattern !== 'string' ||
      typeof rule.category !== 'string'
    ) {
      throw new Error('规则格式不正确');
    }

    return {
      type: rule.type,
      pattern: rule.pattern,
      category: rule.category,
      tags: Array.isArray(rule.tags) ? rule.tags.filter((tag) => typeof tag === 'string') : [],
    };
  });
}

export default function Settings({
  backups,
  busy,
  exportManifests,
  settings,
  onSave,
  onDownloadBackup,
}: SettingsProps) {
  const [form, setForm] = useState(settings);
  const [rulesText, setRulesText] = useState(stringifyRules(settings.customRules));
  const [error, setError] = useState('');

  useEffect(() => {
    setForm(settings);
    setRulesText(stringifyRules(settings.customRules));
  }, [settings]);

  const submit = () => {
    setError('');
    try {
      onSave({
        ...form,
        customRules: parseRules(rulesText),
      });
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError));
    }
  };

  return (
    <section className="panel settings">
      {error ? <div className="notice error">{error}</div> : null}

      <label>
        <span>DeepSeek API Key</span>
        <input
          type="password"
          value={form.deepSeekApiKey}
          onChange={(event) =>
            setForm({
              ...form,
              deepSeekApiKey: event.target.value,
            })
          }
          placeholder="可选"
        />
      </label>

      <label>
        <span>模型</span>
        <select
          value={form.deepSeekModel}
          onChange={(event) =>
            setForm({
              ...form,
              deepSeekModel: event.target.value as AppSettings['deepSeekModel'],
            })
          }
        >
          <option value="deepseek-chat">deepseek-chat</option>
          <option value="deepseek-reasoner">deepseek-reasoner</option>
        </select>
      </label>

      <label className="inline-check">
        <input
          type="checkbox"
          checked={form.useAi}
          onChange={(event) =>
            setForm({
              ...form,
              useAi: event.target.checked,
            })
          }
        />
        <span>使用 AI 辅助分类</span>
      </label>

      <label>
        <span>默认整理模式</span>
        <select
          value={form.defaultClassifyMode}
          onChange={(event) =>
            setForm({
              ...form,
              defaultClassifyMode: event.target.value as AppSettings['defaultClassifyMode'],
            })
          }
        >
          <option value="safe">仅整理未分类书签</option>
          <option value="full">重新分类全部书签</option>
        </select>
      </label>

      <label>
        <span>导出目录前缀</span>
        <input
          value={form.exportDirectory}
          onChange={(event) =>
            setForm({
              ...form,
              exportDirectory: event.target.value,
            })
          }
          placeholder="Bookmarks"
        />
      </label>

      <label>
        <span>自定义规则 JSON</span>
        <textarea
          value={rulesText}
          onChange={(event) => setRulesText(event.target.value)}
          rows={6}
          spellCheck={false}
        />
      </label>

      <button className="primary" onClick={submit} disabled={busy}>
        保存设置
      </button>

      <div className="backup-list">
        <h2>导出历史</h2>
        {exportManifests.length === 0 ? <p>暂无导出记录</p> : null}
        {exportManifests.map((manifest) => (
          <div className="backup-row" key={manifest.id}>
            <span>{new Date(manifest.exportedAt).toLocaleString()}</span>
            <small>{manifest.bookmarkCount} 个条目</small>
            <small>{manifest.vaultPath}</small>
          </div>
        ))}
      </div>

      <div className="backup-list">
        <h2>书签备份</h2>
        {backups.length === 0 ? <p>暂无备份</p> : null}
        {backups.map((backup) => (
          <div className="backup-row" key={backup.key}>
            <span>{new Date(backup.createdAt).toLocaleString()}</span>
            <small>{backup.bookmarkCount} 个书签</small>
            <button onClick={() => onDownloadBackup(backup)}>导出</button>
          </div>
        ))}
      </div>
    </section>
  );
}
