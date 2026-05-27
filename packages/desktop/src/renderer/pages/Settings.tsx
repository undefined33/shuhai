import { useEffect, useMemo, useState } from 'react';
import type { AppConfig } from '../../main/app-config.js';
import type { AiUsageSummary, SyncNextRun } from '../../preload.js';
import {
  MESSAGE_AUTO_DISMISS_MS,
  errorMessage,
  messageClassName,
  userMessage,
  type UserMessage,
} from '../message.js';
import {
  formatAiUsageSummary,
  formatSyncNextRun,
  getAiBudgetPercent,
  isAiBudgetExceeded,
  isSettingsDirty,
} from './settings-view-model.js';

interface SettingsProps {
  config: AppConfig;
  onConfigChange: (config: AppConfig) => void;
  onDirtyChange: (isDirty: boolean) => void;
}

export function Settings({ config, onConfigChange, onDirtyChange }: SettingsProps) {
  const [draft, setDraft] = useState<AppConfig>(config);
  const [profiles, setProfiles] = useState<string[]>([config.chromeProfile]);
  const [message, setMessage] = useState<UserMessage | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [syncNextRun, setSyncNextRun] = useState<SyncNextRun | null>(null);
  const [aiUsage, setAiUsage] = useState<AiUsageSummary | null>(null);
  const isDirty = useMemo(() => isSettingsDirty(draft, config), [config, draft]);
  const aiBudgetPercent = getAiBudgetPercent(aiUsage);

  useEffect(() => {
    setDraft(config);
  }, [config]);

  useEffect(() => {
    window.shuhai.getChromeProfiles().then(setProfiles).catch(() => setProfiles(['Default']));
  }, []);

  useEffect(() => {
    window.shuhai.getSyncNextRun().then(setSyncNextRun).catch(() => setSyncNextRun(null));
    return window.shuhai.onSyncNextRun(setSyncNextRun);
  }, []);

  useEffect(() => {
    loadAiUsage();
  }, []);

  useEffect(() => {
    onDirtyChange(isDirty);
    return () => {
      onDirtyChange(false);
    };
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!isDirty) {
      return undefined;
    }

    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [isDirty]);

  useEffect(() => {
    if (!message) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setMessage(null);
    }, MESSAGE_AUTO_DISMISS_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [message]);

  async function selectVaultPath(): Promise<void> {
    const selectedPath = await window.shuhai.selectDirectory();
    if (selectedPath) {
      setDraft((current) => ({ ...current, vaultPath: selectedPath }));
    }
  }

  async function save(): Promise<void> {
    setMessage(null);
    setIsSaving(true);
    try {
      const nextConfig = await window.shuhai.setConfig(draft);
      onConfigChange(nextConfig);
      await loadAiUsage();
      setMessage(userMessage('success', '设置已保存'));
    } catch (reason) {
      setMessage(errorMessage(reason, '保存设置失败，请检查 Vault 路径或稍后重试'));
    } finally {
      setIsSaving(false);
    }
  }

  async function loadAiUsage(): Promise<void> {
    try {
      setAiUsage(await window.shuhai.getAiUsage());
    } catch {
      setAiUsage(null);
    }
  }

  async function openLogsDirectory(): Promise<void> {
    setMessage(null);
    try {
      await window.shuhai.openLogsDirectory();
      setMessage(userMessage('success', '日志目录已打开'));
    } catch (reason) {
      setMessage(errorMessage(reason, '打开日志目录失败，请稍后重试'));
    }
  }

  return (
    <section className="page settings-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">应用配置</p>
          <h1>设置</h1>
        </div>
        <div className="actions right">
          <button type="button" onClick={openLogsDirectory}>
            打开日志目录
          </button>
          <button type="button" onClick={save} disabled={isSaving}>
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {message && (
        <p className={messageClassName(message)} aria-live="polite">
          {message.text}
        </p>
      )}

      <div className="settings-grid">
        <label className="field span-2">
          <span>Vault 路径</span>
          <div className="inline-field">
            <input value={draft.vaultPath} readOnly placeholder="未选择" />
            <button type="button" onClick={selectVaultPath}>
              浏览
            </button>
          </div>
        </label>

        <label className="field">
          <span>Chrome Profile</span>
          <select
            value={draft.chromeProfile}
            onChange={(event) => setDraft({ ...draft, chromeProfile: event.target.value })}
          >
            {profiles.map((profile) => (
              <option key={profile} value={profile}>
                {profile}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>同步频率</span>
          <select
            value={draft.syncIntervalMinutes}
            onChange={(event) => {
              setDraft({ ...draft, syncIntervalMinutes: Number(event.target.value) });
            }}
          >
            <option value={15}>15 分钟</option>
            <option value={30}>30 分钟</option>
            <option value={60}>1 小时</option>
            <option value={240}>4 小时</option>
          </select>
          <small className="field-hint">
            {formatSyncNextRun(syncNextRun?.nextRunAt)}
          </small>
        </label>

        <label className="field">
          <span>AI Provider</span>
          <select
            value={draft.ai.provider}
            onChange={(event) => {
              const provider = event.target.value as AppConfig['ai']['provider'];
              setDraft({
                ...draft,
                ai: {
                  ...draft.ai,
                  provider,
                  autoClassify: provider !== 'none',
                },
              });
            }}
          >
            <option value="none">关闭</option>
            <option value="deepseek">DeepSeek</option>
          </select>
        </label>

        <label className="field">
          <span>模型</span>
          <input
            value={draft.ai.model ?? ''}
            onChange={(event) => {
              setDraft({ ...draft, ai: { ...draft.ai, model: event.target.value } });
            }}
            placeholder="deepseek-chat"
          />
        </label>

        <label className="field span-2">
          <span>API Key</span>
          <input
            type="password"
            value={draft.ai.apiKey ?? ''}
            onChange={(event) => {
              setDraft({ ...draft, ai: { ...draft.ai, apiKey: event.target.value } });
            }}
            placeholder="未设置"
          />
        </label>

        <div className="field span-2 ai-usage">
          <span>AI 用量</span>
          <strong>{formatAiUsageSummary(aiUsage)}</strong>
          {aiBudgetPercent !== null && (
            <div className="usage-meter" aria-label="AI token budget usage">
              <progress value={aiBudgetPercent} max={100} />
              <small className={isAiBudgetExceeded(aiUsage) ? 'field-hint warning' : 'field-hint'}>
                {isAiBudgetExceeded(aiUsage)
                  ? '本月用量已超过预算，后续分类仍会继续执行'
                  : `预算使用 ${aiBudgetPercent}%`}
              </small>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
