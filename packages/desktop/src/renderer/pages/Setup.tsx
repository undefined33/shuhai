import { useEffect, useMemo, useState } from 'react';
import type { AppConfig } from '../../main/app-config.js';

interface SetupProps {
  onComplete: (config: AppConfig) => void;
}

export function Setup({ onComplete }: SetupProps) {
  const [step, setStep] = useState(0);
  const [profiles, setProfiles] = useState<string[]>(['Default']);
  const [chromeProfile, setChromeProfile] = useState('Default');
  const [vaultPath, setVaultPath] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    window.shuhai.getChromeProfiles()
      .then((detectedProfiles) => {
        const nextProfiles = detectedProfiles.length > 0 ? detectedProfiles : ['Default'];
        setProfiles(nextProfiles);
        setChromeProfile(nextProfiles[0] ?? 'Default');
      })
      .catch(() => {
        setProfiles(['Default']);
      });
  }, []);

  const canFinish = useMemo(() => vaultPath.trim().length > 0 && !isSaving, [isSaving, vaultPath]);

  async function selectVaultPath(): Promise<void> {
    const selectedPath = await window.shuhai.selectDirectory();
    if (selectedPath) {
      setVaultPath(selectedPath);
    }
  }

  async function finishSetup(): Promise<void> {
    if (!canFinish) return;

    setError(null);
    setIsSaving(true);
    try {
      const nextConfig = await window.shuhai.setConfig({
        chromeProfile,
        vaultPath,
        ai: apiKey.trim()
          ? {
              provider: 'deepseek',
              apiKey: apiKey.trim(),
              batchSize: 50,
              autoClassify: true,
            }
          : {
              provider: 'none',
              batchSize: 50,
              autoClassify: false,
            },
        firstRunComplete: true,
      });
      onComplete(nextConfig);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="setup-shell">
      <section className="setup-panel">
        <div className="setup-header">
          <p className="eyebrow">ShuHai 书海</p>
          <h1>初始化工作区</h1>
        </div>

        <ol className="stepper" aria-label="设置步骤">
          <li className={step === 0 ? 'active' : ''}>Chrome</li>
          <li className={step === 1 ? 'active' : ''}>Vault</li>
          <li className={step === 2 ? 'active' : ''}>AI</li>
        </ol>

        {error && <p className="alert">{error}</p>}

        {step === 0 && (
          <div className="setup-step">
            <h2>选择 Chrome Profile</h2>
            <div className="choice-list">
              {profiles.map((profile) => (
                <label key={profile} className="choice-row">
                  <input
                    type="radio"
                    name="chromeProfile"
                    checked={chromeProfile === profile}
                    onChange={() => setChromeProfile(profile)}
                  />
                  <span>{profile}</span>
                </label>
              ))}
            </div>
            <div className="actions right">
              <button type="button" onClick={() => setStep(1)}>
                下一步
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="setup-step">
            <h2>选择 Obsidian Vault</h2>
            <div className="inline-field">
              <input value={vaultPath} readOnly placeholder="尚未选择目录" />
              <button type="button" onClick={selectVaultPath}>
                浏览
              </button>
            </div>
            <div className="actions">
              <button type="button" className="ghost" onClick={() => setStep(0)}>
                上一步
              </button>
              <button type="button" onClick={() => setStep(2)} disabled={!vaultPath}>
                下一步
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="setup-step">
            <h2>配置 AI 分类</h2>
            <label className="field">
              <span>DeepSeek API Key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="可留空"
              />
            </label>
            <div className="actions">
              <button type="button" className="ghost" onClick={() => setStep(1)}>
                上一步
              </button>
              <button type="button" onClick={finishSetup} disabled={!canFinish}>
                {isSaving ? '保存中...' : '完成'}
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
