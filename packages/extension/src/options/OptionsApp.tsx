import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Download,
  FolderOpen,
  KeyRound,
  Save,
  ShieldCheck,
} from 'lucide-react';
import type {
  AiProviderConfig,
  AiProviderTestResult,
  AiProviderType,
  AppSettings,
  BackupRecord,
  BackupSummary,
  UrlHealthRecord,
} from '../shared/bookmark-types.js';
import { providerPermission, providerTemplate, upsertProvider } from '../shared/ai-providers.js';
import { Alert } from '../components/ui/alert.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { Label } from '../components/ui/label.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import MarkdownTemplateEditor from '../popup/pages/MarkdownTemplateEditor.js';
import RulesEditor from '../popup/pages/RulesEditor.js';
import HistoricalHealthRecords from './HistoricalHealthRecords.js';
import { type LegacyPendingSummary, OptionsClientError, optionsClient } from './options-client.js';

const X_PERMISSION = 'https://x.com/*';

type VaultState =
  | { kind: 'absent' }
  | { kind: 'authorized'; name: string }
  | { kind: 'permission_required'; name: string };

type AdvancedSection = 'rules' | 'templates' | 'backups' | 'health' | 'legacy';

export interface OptionsBootstrapDependencies {
  getBootstrapStatus(): Promise<unknown>;
  getSettings(): Promise<AppSettings>;
  readVault(): Promise<VaultState>;
  containsXPermission(): Promise<boolean>;
}

export interface OptionsBootstrap {
  settings: AppSettings;
  vault: VaultState;
  xPermission: boolean;
}

function fixedErrorMessage(error: unknown): string {
  if (error instanceof OptionsClientError) {
    if (error.code === 'security_bootstrap_failed') {
      return '安全初始化失败，请重新加载扩展后再试。';
    }
    if (error.code === 'forbidden_sender' || error.code === 'invalid_request') {
      return '当前设置请求未通过安全校验。';
    }
    if (error.code === 'storage_unavailable') {
      return '本地安全存储暂时不可用。';
    }
  }
  return '操作未完成，请稍后重试。';
}

function containsOrigin(origin: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!chrome.permissions?.contains) {
      resolve(false);
      return;
    }
    chrome.permissions.contains({ origins: [origin] }, (granted) => {
      resolve(!chrome.runtime.lastError && granted === true);
    });
  });
}

function requestOrigin(origin: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!chrome.permissions?.request) {
      resolve(false);
      return;
    }
    chrome.permissions.request({ origins: [origin] }, (granted) => {
      resolve(!chrome.runtime.lastError && granted === true);
    });
  });
}

function removeOrigin(origin: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!chrome.permissions?.remove) {
      resolve(false);
      return;
    }
    chrome.permissions.remove({ origins: [origin] }, (removed) => {
      resolve(!chrome.runtime.lastError && removed === true);
    });
  });
}

async function readVaultState(): Promise<VaultState> {
  const { getVaultHandle, queryVaultPermission } = await import('../utils/vault-writer.js');
  const handle = await getVaultHandle();
  if (!handle) {
    return { kind: 'absent' };
  }
  return {
    kind: (await queryVaultPermission(handle)) ? 'authorized' : 'permission_required',
    name: handle.name,
  };
}

export async function loadOptionsBootstrap(
  dependencies: OptionsBootstrapDependencies = {
    getBootstrapStatus: () => optionsClient.getBootstrapStatus(),
    getSettings: () => optionsClient.getSettings(),
    readVault: readVaultState,
    containsXPermission: () => containsOrigin(X_PERMISSION),
  },
): Promise<OptionsBootstrap> {
  const [, settings, vault, xPermission] = await Promise.all([
    dependencies.getBootstrapStatus(),
    dependencies.getSettings(),
    dependencies.readVault(),
    dependencies.containsXPermission(),
  ]);
  return { settings, vault, xPermission };
}

function providerStatus(provider: AiProviderConfig, activeProviderId: string): string {
  if (provider.id === activeProviderId && provider.hasApiKey) return '当前使用，Key 已配置';
  if (provider.id === activeProviderId) return '当前使用，尚未配置 Key';
  if (provider.hasApiKey) return 'Key 已配置';
  return '未配置';
}

function pendingSummary(summary: LegacyPendingSummary | undefined): string {
  if (!summary) return '展开后检查是否存在旧版待保存数据。';
  if (summary.state === 'absent') return '没有旧版待保存数据。';
  if (summary.state === 'valid') {
    return `检测到 ${summary.count ?? 0} 条旧数据，占用约 ${summary.approximateBytes} bytes。`;
  }
  if (summary.state === 'oversize') {
    return `旧数据超过安全检查上限，占用约 ${summary.approximateBytes} bytes。`;
  }
  if (summary.state === 'invalid') return '旧数据格式损坏，未读取其中内容。';
  return '暂时无法检查旧数据。';
}

function downloadBackup(backup: BackupRecord): void {
  const blob = new Blob([JSON.stringify(backup.tree, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `shuhai-bookmarks-${backup.createdAt.replace(/[:.]/gu, '-')}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

interface SectionProps {
  description: string;
  title: string;
  children: React.ReactNode;
}

function Section({ children, description, title }: SectionProps) {
  return (
    <section className="border-b border-border py-7 last:border-b-0">
      <div className="grid gap-5 md:grid-cols-[minmax(180px,0.34fr)_minmax(0,1fr)]">
        <div>
          <h2 className="m-0 text-base font-semibold">{title}</h2>
          <p className="m-0 mt-1 max-w-64 text-[13px] leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}

interface AdvancedDisclosureProps {
  description: string;
  name: AdvancedSection;
  onToggle(name: AdvancedSection, open: boolean): void;
  title: string;
  children: React.ReactNode;
}

function AdvancedDisclosure({
  children,
  description,
  name,
  onToggle,
  title,
}: AdvancedDisclosureProps) {
  return (
    <details
      className="group border-b border-border last:border-b-0"
      onToggle={(event) => onToggle(name, event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4">
        <span>
          <span className="block text-sm font-semibold">{title}</span>
          <span className="mt-1 block text-[13px] text-muted-foreground">{description}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="h-4 w-4 shrink-0 transition group-open:rotate-180"
        />
      </summary>
      <div className="pb-5">{children}</div>
    </details>
  );
}

export default function OptionsApp() {
  const [settings, setSettings] = useState<AppSettings>();
  const [vault, setVault] = useState<VaultState>({ kind: 'absent' });
  const [xPermission, setXPermission] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Partial<Record<AdvancedSection, boolean>>>({});
  const [backupSummaries, setBackupSummaries] = useState<BackupSummary[]>();
  const [healthRecords, setHealthRecords] = useState<UrlHealthRecord[]>();
  const [legacyPending, setLegacyPending] = useState<LegacyPendingSummary>();
  const [keyDrafts, setKeyDrafts] = useState<Partial<Record<AiProviderType, string>>>({});
  const [providerResults, setProviderResults] = useState<
    Partial<Record<AiProviderType, AiProviderTestResult>>
  >({});
  const [providerPermissions, setProviderPermissions] = useState<
    Partial<Record<AiProviderType, boolean>>
  >({});

  useEffect(() => {
    let active = true;
    void loadOptionsBootstrap()
      .then((bootstrap) => {
        if (!active) return;
        setSettings(bootstrap.settings);
        setVault(bootstrap.vault);
        setXPermission(bootstrap.xPermission);
      })
      .catch((initialError: unknown) => {
        if (active) setError(fixedErrorMessage(initialError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const activeProvider = useMemo(
    () => settings?.aiProviders.find((provider) => provider.id === settings.activeProviderId),
    [settings],
  );

  const runAction = async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (actionError) {
      setError(fixedErrorMessage(actionError));
    } finally {
      setBusy('');
    }
  };

  const chooseVault = () =>
    runAction('vault', async () => {
      const { requestVaultAccess } = await import('../utils/vault-writer.js');
      const handle = await requestVaultAccess();
      setVault({ kind: 'authorized', name: handle.name });
      setNotice('Vault 已选择。');
    });

  const changeXPermission = (grant: boolean) =>
    runAction('x-permission', async () => {
      const changed = grant ? await requestOrigin(X_PERMISSION) : await removeOrigin(X_PERMISSION);
      const current = changed ? grant : await containsOrigin(X_PERMISSION);
      setXPermission(current);
      setNotice(current ? '已允许读取当前 X 收藏页。' : '已撤销 X 页面权限。');
    });

  const saveSettings = () => {
    if (!settings) return;
    void runAction('settings', async () => {
      const saved = await optionsClient.saveSettings(settings);
      setSettings(saved);
      setNotice('设置已保存。');
    });
  };

  const updateProvider = (provider: AiProviderConfig) => {
    setSettings((current) =>
      current
        ? {
            ...current,
            aiProviders: upsertProvider(current.aiProviders, provider),
          }
        : current,
    );
  };

  const saveProviderKey = (provider: AiProviderConfig) => {
    const key = keyDrafts[provider.provider] ?? '';
    if (!key) {
      setError('请输入新的 API Key。');
      return;
    }
    void runAction(`key:${provider.provider}`, async () => {
      const saved = await optionsClient.setProviderSecret(provider.provider, key);
      setSettings(saved);
      setKeyDrafts((current) => ({ ...current, [provider.provider]: '' }));
      setNotice(`${provider.name} Key 已保存。`);
    });
  };

  const clearProviderKey = (provider: AiProviderConfig) => {
    if (!window.confirm(`确认清除 ${provider.name} 的 API Key？`)) return;
    void runAction(`key:${provider.provider}`, async () => {
      const saved = await optionsClient.clearProviderSecret(provider.provider);
      setSettings(saved);
      setNotice(`${provider.name} Key 已清除。`);
    });
  };

  const testProvider = (provider: AiProviderConfig) =>
    runAction(`test:${provider.provider}`, async () => {
      let permission = await containsOrigin(providerPermission(provider.provider));
      if (!permission) {
        permission = await requestOrigin(providerPermission(provider.provider));
      }
      setProviderPermissions((current) => ({ ...current, [provider.provider]: permission }));
      if (!permission) {
        setProviderResults((current) => ({
          ...current,
          [provider.provider]: {
            success: false,
            code: 'permission_denied',
            message: '未获得当前 AI 服务权限',
          },
        }));
        return;
      }
      const result = await optionsClient.testProvider(provider.provider);
      setProviderResults((current) => ({ ...current, [provider.provider]: result }));
    });

  const revokeProviderPermission = (provider: AiProviderConfig) =>
    runAction(`permission:${provider.provider}`, async () => {
      await removeOrigin(providerPermission(provider.provider));
      const current = await containsOrigin(providerPermission(provider.provider));
      setProviderPermissions((permissions) => ({
        ...permissions,
        [provider.provider]: current,
      }));
      setNotice(current ? 'AI 服务权限仍处于启用状态。' : 'AI 服务权限已撤销。');
    });

  const discardLegacyAi = () => {
    if (!window.confirm('确认丢弃旧版冲突 AI 配置？此操作不会显示或复制旧 Key。')) return;
    void runAction('legacy-ai', async () => {
      const saved = await optionsClient.discardLegacyAi();
      setSettings(saved);
      setNotice('旧版冲突 AI 配置已丢弃。');
    });
  };

  const loadBackups = () =>
    runAction('backups', async () => {
      setBackupSummaries(await optionsClient.listBackupSummaries());
    });

  const downloadSelectedBackup = (summary: BackupSummary) =>
    runAction(`backup:${summary.key}`, async () => {
      const backup = await optionsClient.getBackup(summary.key);
      if (!backup) {
        setNotice('该备份已不在保留列表中。');
        return;
      }
      downloadBackup(backup);
      setNotice('备份下载已开始。');
    });

  const loadHealth = () =>
    runAction('health', async () => {
      setHealthRecords(await optionsClient.listHealthRecords());
    });

  const clearHealth = () => {
    if (!window.confirm('确认清空全部旧链接检查记录？此操作不会修改 Chrome 书签。')) return;
    void runAction('health-clear', async () => {
      const cleared = await optionsClient.clearHealthRecords();
      if (cleared) setHealthRecords([]);
      setNotice(cleared ? '旧链接检查记录已清空。' : '没有可清空的旧链接检查记录。');
    });
  };

  const loadLegacyPending = () =>
    runAction('legacy', async () => {
      setLegacyPending(await optionsClient.inspectLegacyPending());
    });

  const clearLegacyPending = () => {
    if (!window.confirm('确认清除旧版待保存数据？此操作不可撤销。')) return;
    void runAction('legacy-clear', async () => {
      await optionsClient.clearLegacyPending();
      setLegacyPending(await optionsClient.inspectLegacyPending());
      setNotice('旧版待保存数据已清除。');
    });
  };

  const toggleAdvancedSection = (name: AdvancedSection, open: boolean) => {
    setOpenSections((current) => ({ ...current, [name]: open }));
    if (!open) return;
    if (name === 'backups' && backupSummaries === undefined && busy !== 'backups') {
      void loadBackups();
    }
    if (name === 'health' && healthRecords === undefined && busy !== 'health') {
      void loadHealth();
    }
    if (name === 'legacy' && legacyPending === undefined && busy !== 'legacy') {
      void loadLegacyPending();
    }
  };

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-[880px] items-center px-6 py-10">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          正在读取本地设置...
        </p>
      </main>
    );
  }

  if (!settings) {
    return (
      <main className="mx-auto max-w-[880px] px-6 py-10">
        <h1 className="m-0 text-xl font-semibold">ShuHai 设置</h1>
        <Alert className="mt-6" variant="destructive">
          {error || '设置未能安全读取，请重新加载扩展后再试。'}
        </Alert>
      </main>
    );
  }

  const hasLegacyAiConflict =
    settings.aiLegacySummary.builtInConflicts.length > 0 ||
    settings.aiLegacySummary.customState === 'conflict_has_key';

  return (
    <main className="mx-auto min-h-screen max-w-[880px] px-5 pb-24 pt-8 sm:px-8">
      <header className="border-b border-border pb-6">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="shuhai-logomark">
            书
          </span>
          <div>
            <h1 className="m-0 text-xl font-semibold">ShuHai 设置</h1>
            <p className="m-0 mt-1 text-[13px] text-muted-foreground">
              日常任务留在 Side Panel；这里仅管理一次配置和低频维护。
            </p>
          </div>
        </div>
      </header>

      {error ? (
        <Alert className="mt-5" onClose={() => setError('')} variant="destructive">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert className="mt-5" onClose={() => setNotice('')} variant="success">
          {notice}
        </Alert>
      ) : null}

      <Section
        description="ShuHai 只保存目录授权句柄，不展示或记录本地绝对路径。"
        title="Obsidian Vault"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="m-0 flex items-center gap-2 text-sm font-medium">
              <FolderOpen className="h-4 w-4 text-primary" />
              <span className="break-all">
                {vault.kind === 'absent' ? '尚未选择 Vault' : vault.name}
              </span>
            </p>
            <p className="m-0 mt-1 text-[13px] text-muted-foreground">
              {vault.kind === 'authorized'
                ? '目录授权可用。写入仍只发生在任务中的明确保存动作。'
                : vault.kind === 'permission_required'
                  ? '已保存目录，但浏览器需要你重新确认访问。'
                  : '首次点击后由浏览器显示目录选择器。'}
            </p>
          </div>
          <Button loading={busy === 'vault'} onClick={() => void chooseVault()} variant="outline">
            {vault.kind === 'absent' ? '选择 Vault' : '更换或重新授权'}
          </Button>
        </div>
      </Section>

      <Section
        description="只允许读取你主动打开的 X 收藏页；不读取 Cookie、token 或其它标签页。"
        title="X 页面权限"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="m-0 flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-primary" />
            {xPermission ? '已允许读取 https://x.com/*' : '尚未允许读取 X 页面'}
          </p>
          <Button
            loading={busy === 'x-permission'}
            onClick={() => void changeXPermission(!xPermission)}
            variant="outline"
          >
            {xPermission ? '撤销权限' : '允许 X 页面'}
          </Button>
        </div>
      </Section>

      <Section
        description="AI 只为书签分类提供建议。关闭 AI 后，本地规则仍可完整使用。"
        title="可选 AI"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-5">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                checked={settings.useAi}
                className="h-4 w-4 accent-primary"
                onChange={(event) =>
                  setSettings((current) =>
                    current ? { ...current, useAi: event.target.checked } : current,
                  )
                }
                type="checkbox"
              />
              使用 AI 辅助整理
            </label>
            <div className="min-w-52 flex-1">
              <Label htmlFor="classification-mode">默认整理范围</Label>
              <Select
                onValueChange={(value) =>
                  setSettings((current) =>
                    current
                      ? {
                          ...current,
                          defaultClassifyMode: value as AppSettings['defaultClassifyMode'],
                        }
                      : current,
                  )
                }
                value={settings.defaultClassifyMode}
              >
                <SelectTrigger id="classification-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="safe">规则优先，只整理未分类书签</SelectItem>
                  <SelectItem value="full">重新审视全部书签</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="m-0 text-[13px] text-muted-foreground">
            当前 Provider：{activeProvider?.name ?? '未选择'}。API Key 不会回填到此页面。
          </p>

          {hasLegacyAiConflict ? (
            <Alert variant="warning">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>检测到旧版冲突 AI 配置，AI 保持停用且没有复制旧 Key。</span>
                <Button onClick={discardLegacyAi} size="sm" variant="outline">
                  丢弃旧配置
                </Button>
              </div>
            </Alert>
          ) : null}

          <details className="border-y border-border">
            <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-sm font-semibold">
              配置固定 Provider
              <ChevronDown className="h-4 w-4" />
            </summary>
            <div className="divide-y divide-border pb-2">
              {settings.aiProviders.map((provider) => {
                const template = providerTemplate(provider.provider);
                const result = providerResults[provider.provider];
                return (
                  <div className="space-y-3 py-4" key={provider.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="m-0 text-sm font-semibold">{provider.name}</p>
                        <p className="m-0 mt-1 text-[13px] text-muted-foreground">
                          {providerStatus(provider, settings.activeProviderId)} · {template.origin}
                        </p>
                      </div>
                      <Button
                        className={
                          provider.id === settings.activeProviderId
                            ? 'bg-muted text-foreground'
                            : undefined
                        }
                        onClick={() =>
                          setSettings((current) =>
                            current
                              ? {
                                  ...current,
                                  useAi: true,
                                  activeProviderId: provider.id,
                                  aiProviders: upsertProvider(current.aiProviders, {
                                    ...provider,
                                    enabled: true,
                                  }),
                                }
                              : current,
                          )
                        }
                        size="sm"
                        variant="outline"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {provider.id === settings.activeProviderId ? '当前使用' : '设为当前'}
                      </Button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor={`model-${provider.id}`}>模型</Label>
                        <Input
                          id={`model-${provider.id}`}
                          list={`models-${provider.id}`}
                          onChange={(event) =>
                            updateProvider({ ...provider, model: event.target.value })
                          }
                          value={provider.model}
                        />
                        <datalist id={`models-${provider.id}`}>
                          {template.models.map((model) => (
                            <option key={model} value={model} />
                          ))}
                        </datalist>
                      </div>
                      <div>
                        <Label htmlFor={`key-${provider.id}`}>新的 API Key</Label>
                        <Input
                          autoComplete="off"
                          id={`key-${provider.id}`}
                          onChange={(event) =>
                            setKeyDrafts((current) => ({
                              ...current,
                              [provider.provider]: event.target.value,
                            }))
                          }
                          placeholder={
                            provider.hasApiKey ? '已配置；输入新 Key 可替换' : '输入 Key'
                          }
                          type="password"
                          value={keyDrafts[provider.provider] ?? ''}
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={!keyDrafts[provider.provider]}
                        loading={busy === `key:${provider.provider}`}
                        onClick={() => saveProviderKey(provider)}
                        size="sm"
                        variant="outline"
                      >
                        <KeyRound className="h-4 w-4" />
                        保存 Key
                      </Button>
                      {provider.hasApiKey ? (
                        <Button
                          onClick={() => clearProviderKey(provider)}
                          size="sm"
                          variant="outline"
                        >
                          清除 Key
                        </Button>
                      ) : null}
                      <Button
                        disabled={!provider.hasApiKey}
                        loading={busy === `test:${provider.provider}`}
                        onClick={() => void testProvider(provider)}
                        size="sm"
                        variant="outline"
                      >
                        测试连接
                      </Button>
                      {providerPermissions[provider.provider] ? (
                        <Button
                          onClick={() => void revokeProviderPermission(provider)}
                          size="sm"
                          variant="ghost"
                        >
                          撤销服务权限
                        </Button>
                      ) : null}
                    </div>

                    {result ? (
                      <Alert variant={result.success ? 'success' : 'destructive'}>
                        {result.message}
                      </Alert>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </details>
        </div>
      </Section>

      <section className="py-7">
        <button
          aria-expanded={advancedOpen}
          className="flex w-full items-center justify-between gap-4 py-2 text-left"
          onClick={() => setAdvancedOpen((open) => !open)}
          type="button"
        >
          <span>
            <span className="block text-base font-semibold">高级设置</span>
            <span className="mt-1 block text-[13px] text-muted-foreground">
              规则、模板、备份和旧数据维护默认折叠。
            </span>
          </span>
          <ChevronDown
            className={advancedOpen ? 'h-5 w-5 rotate-180 transition' : 'h-5 w-5 transition'}
          />
        </button>

        {advancedOpen ? (
          <div className="mt-3 border-t border-border">
            <AdvancedDisclosure
              description="维护确定性本地分类规则。"
              name="rules"
              onToggle={toggleAdvancedSection}
              title="分类规则"
            >
              {openSections.rules ? (
                <RulesEditor
                  onChange={(customRules) =>
                    setSettings((current) => (current ? { ...current, customRules } : current))
                  }
                  rules={settings.customRules}
                />
              ) : null}
            </AdvancedDisclosure>

            <AdvancedDisclosure
              description="调整写入 Obsidian 的 Markdown 字段和格式。"
              name="templates"
              onToggle={toggleAdvancedSection}
              title="Markdown 模板"
            >
              {openSections.templates ? (
                <MarkdownTemplateEditor onChange={setSettings} settings={settings} />
              ) : null}
            </AdvancedDisclosure>

            <AdvancedDisclosure
              description="先读取最多 5 条 metadata，只有点击下载时才取单个完整备份。"
              name="backups"
              onToggle={toggleAdvancedSection}
              title="书签备份"
            >
              {busy === 'backups' ? (
                <p aria-live="polite" className="text-sm text-muted-foreground">
                  正在读取备份摘要...
                </p>
              ) : backupSummaries?.length ? (
                <ul className="m-0 divide-y divide-border border-y border-border p-0">
                  {backupSummaries.map((summary) => (
                    <li
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                      key={summary.key}
                    >
                      <span className="text-sm">
                        {new Date(summary.createdAt).toLocaleString()} · {summary.bookmarkCount}{' '}
                        个书签
                      </span>
                      <Button
                        aria-label="下载此书签备份"
                        loading={busy === `backup:${summary.key}`}
                        onClick={() => void downloadSelectedBackup(summary)}
                        size="sm"
                        variant="outline"
                      >
                        <Download className="h-4 w-4" />
                        下载
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">没有保留书签备份。</p>
              )}
            </AdvancedDisclosure>

            <AdvancedDisclosure
              description="只读核实旧结果，不重新检测，也不会修改真实书签。"
              name="health"
              onToggle={toggleAdvancedSection}
              title="旧链接记录"
            >
              {busy === 'health' ? (
                <p aria-live="polite" className="text-sm text-muted-foreground">
                  正在读取旧链接记录...
                </p>
              ) : (
                <HistoricalHealthRecords
                  busy={busy === 'health-clear'}
                  onClear={clearHealth}
                  onNotice={setNotice}
                  records={healthRecords ?? []}
                />
              )}
            </AdvancedDisclosure>

            <AdvancedDisclosure
              description="只检查数量和占用空间，不展示旧正文。"
              name="legacy"
              onToggle={toggleAdvancedSection}
              title="旧版待保存数据"
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="m-0 text-sm text-muted-foreground">{pendingSummary(legacyPending)}</p>
                {legacyPending?.present ? (
                  <Button
                    loading={busy === 'legacy-clear'}
                    onClick={clearLegacyPending}
                    variant="outline"
                  >
                    清除旧数据
                  </Button>
                ) : null}
              </div>
            </AdvancedDisclosure>
          </div>
        ) : null}
      </section>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 px-5 py-3 backdrop-blur sm:px-8">
        <div className="mx-auto flex max-w-[880px] items-center justify-between gap-4">
          <p className="m-0 hidden text-[13px] text-muted-foreground sm:block">
            规则、模板、Provider 选择和默认范围仅在点击保存后生效。
          </p>
          <Button className="ml-auto min-w-36" loading={busy === 'settings'} onClick={saveSettings}>
            <Save className="h-4 w-4" />
            保存设置
          </Button>
        </div>
      </div>
    </main>
  );
}
