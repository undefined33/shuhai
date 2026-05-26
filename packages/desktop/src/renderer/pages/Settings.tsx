import { useEffect, useState } from 'react';
import type { AppConfig } from '../../main/app-config.js';

interface SettingsProps {
  config: AppConfig;
  onConfigChange: (config: AppConfig) => void;
}

export function Settings({ config, onConfigChange }: SettingsProps) {
  const [draft, setDraft] = useState<AppConfig>(config);
  const [profiles, setProfiles] = useState<string[]>([config.chromeProfile]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setDraft(config);
  }, [config]);

  useEffect(() => {
    window.shuhai.getChromeProfiles().then(setProfiles).catch(() => setProfiles(['Default']));
  }, []);

  async function selectVaultPath(): Promise<void> {
    const selectedPath = await window.shuhai.selectDirectory();
    if (selectedPath) {
      setDraft((current) => ({ ...current, vaultPath: selectedPath }));
    }
  }

  async function save(): Promise<void> {
    setStatus(null);
    const nextConfig = await window.shuhai.setConfig(draft);
    onConfigChange(nextConfig);
    setStatus('设置已保存');
  }

  return (
    <section className="page settings-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">应用配置</p>
          <h1>设置</h1>
        </div>
        <button type="button" onClick={save}>
          保存
        </button>
      </div>

      {status && <p className="notice">{status}</p>}

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
      </div>
    </section>
  );
}
