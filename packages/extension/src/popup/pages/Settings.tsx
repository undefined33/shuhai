import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, CheckCircle2, Download, Eye, EyeOff, FolderOpen, Save } from 'lucide-react';
import type {
  AiProviderConfig,
  AiProviderTestResult,
  AiProviderType,
  AppSettings,
  BackupRecord,
  ExportManifest,
} from '../../shared/bookmark-types.js';
import { PROVIDER_TEMPLATES } from '../../shared/bookmark-types.js';
import { providerTemplate, providerPermission, upsertProvider } from '../../shared/ai-providers.js';
import type { LegacyPendingSummary } from '../../shared/extension-messages.js';
import { Alert } from '../../components/ui/alert.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible.js';
import { Input } from '../../components/ui/input.js';
import { Label } from '../../components/ui/label.js';
import { ScrollArea } from '../../components/ui/scroll-area.js';
import { Separator } from '../../components/ui/separator.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { getVaultHandle, requestVaultAccess } from '../../utils/vault-writer.js';
import MarkdownTemplateEditor from './MarkdownTemplateEditor.js';
import RulesEditor from './RulesEditor.js';

interface SettingsProps {
  backups: BackupRecord[];
  busy: boolean;
  exportManifests: ExportManifest[];
  settings: AppSettings;
  onSave(settings: AppSettings): void;
  onDownloadBackup(backup: BackupRecord): void;
  onOpenActivity?(): void;
  onSetProviderSecret(provider: AiProviderType, apiKey: string): Promise<AppSettings>;
  onClearProviderSecret(provider: AiProviderType): Promise<AppSettings>;
  onDiscardLegacyAi(): Promise<AppSettings>;
  onInspectLegacyPending(): Promise<LegacyPendingSummary>;
  onClearLegacyPending(): Promise<void>;
  onTestProvider(provider: AiProviderType): Promise<AiProviderTestResult>;
}

function providerStatus(provider: AiProviderConfig, activeProviderId: string): string {
  if (provider.id === activeProviderId && provider.hasApiKey) {
    return `${provider.model} · 当前使用`;
  }

  if (provider.hasApiKey) {
    return `${provider.model} · 已配置`;
  }

  return '未配置';
}

function providerModels(provider: AiProviderConfig): string[] {
  const template = providerTemplate(provider.provider);
  return template.models.includes(provider.model)
    ? template.models
    : [provider.model, ...template.models].filter(Boolean);
}

function containsProviderPermission(provider: AiProviderType): Promise<boolean> {
  return new Promise((resolve) => {
    if (!chrome.permissions?.contains) {
      resolve(false);
      return;
    }
    chrome.permissions.contains({ origins: [providerPermission(provider)] }, (granted) => {
      resolve(!chrome.runtime.lastError && granted === true);
    });
  });
}

function requestProviderPermission(provider: AiProviderType): Promise<boolean> {
  return new Promise((resolve) => {
    if (!chrome.permissions?.request) {
      resolve(false);
      return;
    }
    chrome.permissions.request({ origins: [providerPermission(provider)] }, (granted) => {
      resolve(!chrome.runtime.lastError && granted === true);
    });
  });
}

function removeProviderPermission(provider: AiProviderType): Promise<boolean> {
  return new Promise((resolve) => {
    if (!chrome.permissions?.remove) {
      resolve(false);
      return;
    }
    chrome.permissions.remove({ origins: [providerPermission(provider)] }, (removed) => {
      resolve(!chrome.runtime.lastError && removed === true);
    });
  });
}

function manifestTypeLabel(manifest: ExportManifest): string {
  if (manifest.sourceLabel) {
    return manifest.sourceLabel;
  }

  if (manifest.type === 'bookmark-index' || (!manifest.type && manifest.bookmarkCount > 5)) {
    return '书签目录';
  }

  if (manifest.type === 'activity') {
    return '历史记录';
  }

  if (manifest.type === 'capture' || (!manifest.type && manifest.bookmarkCount <= 5)) {
    return '内容';
  }

  return '未分类';
}

function manifestCountLabel(manifest: ExportManifest): string {
  if (manifest.type === 'capture' || (!manifest.type && manifest.bookmarkCount <= 5)) {
    return `${manifest.bookmarkCount} 篇`;
  }

  return `${manifest.bookmarkCount} 条`;
}

export default function Settings({
  backups,
  busy,
  exportManifests,
  settings,
  onSave,
  onDownloadBackup,
  onOpenActivity,
  onSetProviderSecret,
  onClearProviderSecret,
  onDiscardLegacyAi,
  onInspectLegacyPending,
  onClearLegacyPending,
  onTestProvider,
}: SettingsProps) {
  const [form, setForm] = useState(settings);
  const [showKeyById, setShowKeyById] = useState<Record<string, boolean>>({});
  const [keyDraftById, setKeyDraftById] = useState<Record<string, string>>({});
  const [providerPermissions, setProviderPermissions] = useState<
    Partial<Record<AiProviderType, boolean>>
  >({});
  const [error, setError] = useState('');
  const [vaultHandle, setVaultHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [vaultStatus, setVaultStatus] = useState('');
  const [vaultBusy, setVaultBusy] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState(settings.activeProviderId);
  const [testResults, setTestResults] = useState<Record<string, AiProviderTestResult>>({});
  const [testingProviderId, setTestingProviderId] = useState('');
  const [legacyPending, setLegacyPending] = useState<LegacyPendingSummary>();
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setForm(settings);
    setEditingProviderId(settings.activeProviderId);
  }, [settings]);

  useEffect(() => {
    void Promise.all(
      PROVIDER_TEMPLATES.map(
        async (template) =>
          [template.provider, await containsProviderPermission(template.provider)] as const,
      ),
    ).then((entries) => setProviderPermissions(Object.fromEntries(entries)));
    void onInspectLegacyPending()
      .then(setLegacyPending)
      .catch(() =>
        setLegacyPending({
          present: false,
          count: null,
          approximateBytes: 0,
          state: 'unavailable',
        }),
      );
  }, [onInspectLegacyPending]);

  useEffect(() => {
    void getVaultHandle()
      .then(setVaultHandle)
      .catch(() => setVaultHandle(null));
  }, []);

  useEffect(() => {
    if (!vaultStatus) {
      return undefined;
    }

    const timer = window.setTimeout(() => setVaultStatus(''), 3000);
    return () => window.clearTimeout(timer);
  }, [vaultStatus]);

  const chooseVault = async () => {
    setVaultBusy(true);
    setError('');
    try {
      const nextHandle = await requestVaultAccess();
      setVaultHandle(nextHandle);
      setVaultStatus(`已选择 Vault：${nextHandle.name}`);
    } catch (chooseError) {
      setError(chooseError instanceof Error ? chooseError.message : String(chooseError));
    } finally {
      setVaultBusy(false);
    }
  };

  const updateProvider = (provider: AiProviderConfig) => {
    setForm((current) => ({
      ...current,
      aiProviders: upsertProvider(current.aiProviders, provider),
    }));
  };

  const setActiveProvider = (provider: AiProviderConfig) => {
    setForm((current) => ({
      ...current,
      useAi: true,
      activeProviderId: provider.id,
      aiProviders: upsertProvider(current.aiProviders, { ...provider, enabled: true }),
    }));
    setEditingProviderId(provider.id);
  };

  const testProvider = async (provider: AiProviderConfig) => {
    setTestingProviderId(provider.id);
    setError('');
    try {
      const permission = await requestProviderPermission(provider.provider);
      setProviderPermissions((current) => ({ ...current, [provider.provider]: permission }));
      const result = permission
        ? await onTestProvider(provider.provider)
        : {
            success: false,
            code: 'permission_denied' as const,
            message: '未获得当前 AI 服务权限',
          };
      setTestResults((current) => ({ ...current, [provider.id]: result }));
    } catch (testError) {
      setTestResults((current) => ({
        ...current,
        [provider.id]: {
          success: false,
          code: 'network_failed',
          message: testError instanceof Error ? testError.message : String(testError),
        },
      }));
    } finally {
      setTestingProviderId('');
    }
  };

  const saveProviderKey = async (provider: AiProviderConfig) => {
    const apiKey = keyDraftById[provider.id] ?? '';
    if (!apiKey) {
      setError('请输入新的 API Key');
      return;
    }
    setMaintenanceBusy(true);
    setError('');
    try {
      const next = await onSetProviderSecret(provider.provider, apiKey);
      setForm(next);
      setKeyDraftById((current) => ({ ...current, [provider.id]: '' }));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setMaintenanceBusy(false);
    }
  };

  const clearProviderKey = async (provider: AiProviderConfig) => {
    if (!window.confirm(`确认清除 ${provider.name} 的 API Key？`)) {
      return;
    }
    setMaintenanceBusy(true);
    setError('');
    try {
      setForm(await onClearProviderSecret(provider.provider));
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : String(clearError));
    } finally {
      setMaintenanceBusy(false);
    }
  };

  const revokeProviderAccess = async (provider: AiProviderConfig) => {
    const removed = await removeProviderPermission(provider.provider);
    setProviderPermissions((current) => ({
      ...current,
      [provider.provider]: removed ? false : current[provider.provider],
    }));
  };

  const discardLegacyAi = async () => {
    if (!window.confirm('确认丢弃旧 AI Provider 子配置？已有规则、模板和其它设置会保留。')) {
      return;
    }
    setMaintenanceBusy(true);
    setError('');
    try {
      setForm(await onDiscardLegacyAi());
    } catch (discardError) {
      setError(discardError instanceof Error ? discardError.message : String(discardError));
    } finally {
      setMaintenanceBusy(false);
    }
  };

  const clearLegacyPending = async () => {
    if (!window.confirm('确认清除旧版本遗留的待保存内容？此操作只删除 pendingCapture。')) {
      return;
    }
    setMaintenanceBusy(true);
    setError('');
    try {
      await onClearLegacyPending();
      setLegacyPending(await onInspectLegacyPending());
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : String(clearError));
    } finally {
      setMaintenanceBusy(false);
    }
  };

  const submit = () => {
    setError('');
    onSave(form);
  };

  const activeProvider = form.aiProviders.find((provider) => provider.id === form.activeProviderId);
  const aiConfigured = form.aiProviders.some((provider) => provider.hasApiKey);
  const setupIncomplete = !vaultHandle;
  const renderCollapsibleSection = (
    id: string,
    title: string,
    description: string,
    content: ReactNode,
  ) => (
    <Collapsible
      onOpenChange={(open) => setOpenSections((current) => ({ ...current, [id]: open }))}
      open={Boolean(openSections[id])}
    >
      <Card variant="outline">
        <CollapsibleTrigger asChild>
          <button className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left">
            <div className="min-w-0">
              <div className="text-sm font-semibold">{title}</div>
              <div className="mt-1 text-xs text-muted-foreground">{description}</div>
            </div>
            <ChevronDown className={openSections[id] ? 'h-4 w-4 rotate-180' : 'h-4 w-4'} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Separator />
          <CardContent className="pt-3">{content}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {vaultStatus ? <Alert variant="success">{vaultStatus}</Alert> : null}

      <ScrollArea className="min-h-0 flex-1 pr-2">
        <div className="space-y-3">
          {setupIncomplete ? (
            <Card className="border-primary/30 bg-primary/5" variant="outline">
              <CardHeader className="pb-2">
                <CardTitle>开始使用 ShuHai</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2 rounded-md bg-card px-2 py-2">
                  <span>1. 选择 Obsidian Vault</span>
                  <Badge variant={vaultHandle ? 'success' : 'warning'}>
                    {vaultHandle ? '已完成' : '待配置'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-md bg-card px-2 py-2">
                  <span>2. 配置 AI 服务商</span>
                  <Badge variant={aiConfigured ? 'success' : 'warning'}>
                    {aiConfigured ? '已完成' : '待配置'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  完成后即可整理书签、检查失效链接，并把提取的内容写入知识库。
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Card variant="outline">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-primary" />
                知识库
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-2 text-xs">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  {vaultHandle?.name ?? '未选择 Obsidian Vault'}
                </span>
                <Button
                  disabled={vaultBusy}
                  loading={vaultBusy}
                  onClick={chooseVault}
                  size="sm"
                  variant="outline"
                >
                  {vaultHandle ? '更换' : '选择'}
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label>写入前缀</Label>
                <Input
                  onChange={(event) =>
                    setForm({
                      ...form,
                      exportDirectory: event.target.value,
                    })
                  }
                  placeholder="Bookmarks"
                  value={form.exportDirectory}
                />
              </div>

              {!vaultHandle ? (
                <Alert variant="warning">
                  待入库内容和书签目录都会写入同一个 Vault。首次使用需要授权目录。
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card variant="outline">
            <CardHeader className="pb-2">
              <CardTitle>AI 服务商</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center gap-2 rounded-md border border-border px-2 py-2 text-sm">
                  <input
                    checked={form.useAi}
                    className="h-4 w-4 accent-primary"
                    onChange={(event) =>
                      setForm({
                        ...form,
                        useAi: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  <span>使用 AI 辅助整理</span>
                </label>
                <div className="space-y-1.5">
                  <Label>默认模式</Label>
                  <Select
                    onValueChange={(value) =>
                      setForm({
                        ...form,
                        defaultClassifyMode: value as AppSettings['defaultClassifyMode'],
                      })
                    }
                    value={form.defaultClassifyMode}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="safe">仅整理未分类</SelectItem>
                      <SelectItem value="full">重新整理全部</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-md border border-border bg-muted/40 px-2 py-2 text-xs">
                当前使用：
                <span className="font-medium">{activeProvider?.name ?? '未选择'}</span>
              </div>

              {form.aiLegacySummary.builtInConflicts.length > 0 ||
              form.aiLegacySummary.customState === 'conflict_has_key' ? (
                <Alert variant="destructive">
                  <div className="space-y-2">
                    <p>
                      旧 AI 配置存在重复 Provider 或自定义 Key。ShuHai 没有自动选择、复制或删除
                      Key，AI 已保持停用。
                    </p>
                    <Button
                      disabled={maintenanceBusy}
                      onClick={discardLegacyAi}
                      size="sm"
                      variant="outline"
                    >
                      丢弃旧 AI 配置
                    </Button>
                  </div>
                </Alert>
              ) : form.aiLegacySummary.customState === 'disabled_no_key' ? (
                <Alert variant="warning">
                  已停用旧版空 Key 自定义 Provider。当前只支持三个固定官方端点。
                </Alert>
              ) : null}

              <div className="space-y-2">
                {form.aiProviders.map((provider) => {
                  const editing = editingProviderId === provider.id;
                  const result = testResults[provider.id];
                  const models = providerModels(provider);
                  const showKey = Boolean(showKeyById[provider.id]);
                  const template = providerTemplate(provider.provider);
                  const permissionGranted = providerPermissions[provider.provider] === true;

                  return (
                    <div className="rounded-md border border-border p-2" key={provider.id}>
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={() => setActiveProvider(provider)}
                          size="icon"
                          title="设为当前使用"
                          variant={provider.id === form.activeProviderId ? 'default' : 'outline'}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <span className="truncate">{provider.name}</span>
                            {provider.id === form.activeProviderId ? (
                              <Badge variant="success">当前</Badge>
                            ) : null}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {providerStatus(provider, form.activeProviderId)}
                          </div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">
                            {template.origin}
                          </div>
                        </div>
                        <Button
                          onClick={() => setEditingProviderId(editing ? '' : provider.id)}
                          size="sm"
                          variant="outline"
                        >
                          {editing ? '收起' : '编辑'}
                        </Button>
                      </div>

                      {editing ? (
                        <div className="mt-3 space-y-2 rounded-md bg-muted/30 p-2">
                          <div className="space-y-1.5">
                            <Label>模型</Label>
                            <Input
                              list={`models-${provider.id}`}
                              onChange={(event) =>
                                updateProvider({ ...provider, model: event.target.value })
                              }
                              value={provider.model}
                            />
                            <datalist id={`models-${provider.id}`}>
                              {models.map((model) => (
                                <option key={model} value={model} />
                              ))}
                            </datalist>
                            <p className="text-xs text-muted-foreground">
                              模型名只进入请求正文，不能改变 host、路径或权限。
                            </p>
                          </div>

                          <div className="space-y-1.5">
                            <Label>新的 API Key</Label>
                            <div className="flex gap-2">
                              <Input
                                onChange={(event) =>
                                  setKeyDraftById((current) => ({
                                    ...current,
                                    [provider.id]: event.target.value,
                                  }))
                                }
                                placeholder={
                                  provider.hasApiKey ? '已配置；留空表示不更改' : '输入 Key'
                                }
                                type={showKey ? 'text' : 'password'}
                                value={keyDraftById[provider.id] ?? ''}
                              />
                              <Button
                                onClick={() =>
                                  setShowKeyById((current) => ({
                                    ...current,
                                    [provider.id]: !current[provider.id],
                                  }))
                                }
                                size="icon"
                                variant="outline"
                              >
                                {showKey ? (
                                  <EyeOff className="h-4 w-4" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Key 单独保存在受信 extension storage，不会回填到表单、state 或日志。
                            </p>
                          </div>

                          <div className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-2 text-xs">
                            <span>站点权限：{permissionGranted ? '已允许' : '未允许'}</span>
                            {permissionGranted ? (
                              <Button
                                onClick={() => void revokeProviderAccess(provider)}
                                size="sm"
                                variant="outline"
                              >
                                撤销权限
                              </Button>
                            ) : null}
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Button
                              disabled={maintenanceBusy || !(keyDraftById[provider.id] ?? '')}
                              onClick={() => void saveProviderKey(provider)}
                              size="sm"
                            >
                              保存 Key
                            </Button>
                            {provider.hasApiKey ? (
                              <Button
                                disabled={maintenanceBusy}
                                onClick={() => void clearProviderKey(provider)}
                                size="sm"
                                variant="outline"
                              >
                                清除 Key
                              </Button>
                            ) : null}
                            <Button
                              disabled={testingProviderId === provider.id || !provider.hasApiKey}
                              loading={testingProviderId === provider.id}
                              onClick={() => testProvider(provider)}
                              size="sm"
                              variant="secondary"
                            >
                              测试连接
                            </Button>
                            <Button onClick={() => setActiveProvider(provider)} size="sm">
                              设为当前
                            </Button>
                          </div>

                          {result ? (
                            <Alert variant={result.success ? 'success' : 'destructive'}>
                              {result.message}
                            </Alert>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {!aiConfigured ? (
                <Alert variant="warning">
                  未配置 API Key 时，ShuHai 会完整使用本地规则整理。AI
                  只是可选建议，不会自动移动书签。
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          {renderCollapsibleSection(
            'legacy-data',
            '旧版待保存数据',
            '只返回数量和占用空间；检查内容不会展示、返回或再次持久化。',
            <div className="space-y-3">
              <div className="rounded-md border border-border px-3 py-2 text-sm">
                {legacyPending?.state === 'absent'
                  ? '没有旧版待保存数据。'
                  : legacyPending?.state === 'valid'
                    ? `检测到 ${legacyPending.count ?? 0} 条旧数据，占用约 ${legacyPending.approximateBytes} bytes。`
                    : legacyPending?.state === 'oversize'
                      ? `旧数据超过 512 KiB 安全检查上限，占用约 ${legacyPending.approximateBytes} bytes。`
                      : legacyPending?.state === 'invalid'
                        ? '旧数据格式损坏或超过条目上限，未读取其中内容。'
                        : '暂时无法检查旧数据。'}
              </div>
              {legacyPending?.present ? (
                <Button
                  disabled={maintenanceBusy}
                  onClick={() => void clearLegacyPending()}
                  variant="outline"
                >
                  清除旧待保存数据
                </Button>
              ) : null}
            </div>,
          )}

          {renderCollapsibleSection(
            'rules',
            '分类规则',
            '维护固定规则，用来补充或替代 AI 整理建议。',
            <RulesEditor
              onChange={(customRules) => setForm((current) => ({ ...current, customRules }))}
              rules={form.customRules}
            />,
          )}

          {renderCollapsibleSection(
            'template',
            '导出模板',
            '调整写入 Obsidian 的 Markdown 字段和格式。',
            <MarkdownTemplateEditor onChange={setForm} settings={form} />,
          )}

          {renderCollapsibleSection(
            'backup-history',
            '备份与历史',
            '查看已保存记录，下载整理前自动创建的书签备份。',
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">已保存</h3>
                  {onOpenActivity ? (
                    <Button onClick={onOpenActivity} size="sm" variant="outline">
                      历史记录
                    </Button>
                  ) : null}
                </div>
                {exportManifests.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    尚未写入过 Vault。内容或书签目录写入后会显示在这里。
                  </p>
                ) : null}
                {exportManifests.map((manifest) => (
                  <div className="flex items-center gap-2 text-xs" key={manifest.id}>
                    <span className="min-w-0 flex-1 truncate">
                      写入：{new Date(manifest.exportedAt).toLocaleString()}
                    </span>
                    <Badge variant="outline">{manifestTypeLabel(manifest)}</Badge>
                    <Badge variant="secondary">{manifestCountLabel(manifest)}</Badge>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">书签备份</h3>
                {backups.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    暂无备份。每次应用整理建议前会自动备份，便于撤销。
                  </p>
                ) : null}
                {backups.map((backup) => (
                  <div className="flex items-center gap-2 text-xs" key={backup.key}>
                    <span className="min-w-0 flex-1 truncate">
                      {new Date(backup.createdAt).toLocaleString()}
                    </span>
                    <Badge variant="outline">{backup.bookmarkCount}</Badge>
                    <Button onClick={() => onDownloadBackup(backup)} size="sm" variant="outline">
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>,
          )}

          {renderCollapsibleSection(
            'advanced',
            '高级工具与帮助',
            '低频工具和安全说明放在这里，需要时再展开。',
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>“整理书签”负责浏览、AI 整理建议和确认移动。</p>
              <p>“待入库”负责处理右键提取进来的文章、推文和微博。</p>
              <p>ShuHai 不会批量抓取远程网页，写入 Markdown 前会做安全清洗。</p>
              {onOpenActivity ? (
                <Button onClick={onOpenActivity} size="sm" variant="outline">
                  查看历史记录
                </Button>
              ) : null}
            </div>,
          )}
        </div>
      </ScrollArea>

      <Button disabled={busy} loading={busy} onClick={submit}>
        <Save className="h-4 w-4" />
        保存设置
      </Button>
    </section>
  );
}
