import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ChevronDown,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  HelpCircle,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import type {
  AiProviderConfig,
  AiProviderTestResult,
  AiProviderType,
  AppSettings,
  BackupRecord,
  ExportManifest,
} from '../../shared/bookmark-types.js';
import { PROVIDER_TEMPLATES } from '../../shared/bookmark-types.js';
import {
  createProviderFromTemplate,
  providerTemplate,
  trimTrailingSlash,
  upsertProvider,
} from '../../shared/ai-providers.js';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../components/ui/tooltip.js';
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
  onTestProvider(provider: AiProviderConfig): Promise<AiProviderTestResult>;
}

function providerStatus(provider: AiProviderConfig, activeProviderId: string): string {
  if (provider.id === activeProviderId && provider.apiKey.trim()) {
    return `${provider.model} · 当前使用`;
  }

  if (provider.apiKey.trim()) {
    return `${provider.model} · 已配置`;
  }

  return '未配置';
}

function createNewProvider(type: AiProviderType): AiProviderConfig {
  const template = providerTemplate(type);
  return createProviderFromTemplate(template, {
    id: `${type}-${crypto.randomUUID()}`,
    name: type === 'openai-compatible' ? '自定义 AI 服务商' : template.name,
  });
}

function providerModels(provider: AiProviderConfig): string[] {
  const template = providerTemplate(provider.provider);
  return template.models.includes(provider.model)
    ? template.models
    : [provider.model, ...template.models].filter(Boolean);
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
  onTestProvider,
}: SettingsProps) {
  const [form, setForm] = useState(settings);
  const [showKeyById, setShowKeyById] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [vaultHandle, setVaultHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [vaultStatus, setVaultStatus] = useState('');
  const [vaultBusy, setVaultBusy] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState(settings.activeProviderId);
  const [addingProvider, setAddingProvider] = useState<AiProviderConfig | undefined>();
  const [testResults, setTestResults] = useState<Record<string, AiProviderTestResult>>({});
  const [testingProviderId, setTestingProviderId] = useState('');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setForm(settings);
    setEditingProviderId(settings.activeProviderId);
  }, [settings]);

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
      aiProviders: upsertProvider(current.aiProviders, {
        ...provider,
        baseUrl: trimTrailingSlash(provider.baseUrl.trim()),
      }),
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

  const deleteProvider = (providerId: string) => {
    setForm((current) => {
      const providers = current.aiProviders.filter((provider) => provider.id !== providerId);
      const activeProviderId =
        current.activeProviderId === providerId
          ? (providers[0]?.id ?? current.activeProviderId)
          : current.activeProviderId;

      return {
        ...current,
        activeProviderId,
        aiProviders: providers,
        useAi: providers.some((provider) => provider.id === activeProviderId && provider.apiKey),
      };
    });
    setEditingProviderId((current) => (current === providerId ? '' : current));
  };

  const testProvider = async (provider: AiProviderConfig) => {
    setTestingProviderId(provider.id);
    setError('');
    try {
      const result = await onTestProvider(provider);
      setTestResults((current) => ({ ...current, [provider.id]: result }));
    } catch (testError) {
      setTestResults((current) => ({
        ...current,
        [provider.id]: {
          success: false,
          message: testError instanceof Error ? testError.message : String(testError),
        },
      }));
    } finally {
      setTestingProviderId('');
    }
  };

  const addProvider = () => {
    if (!addingProvider) {
      return;
    }

    setForm((current) => ({
      ...current,
      aiProviders: [...current.aiProviders, addingProvider],
      activeProviderId: current.activeProviderId || addingProvider.id,
    }));
    setEditingProviderId(addingProvider.id);
    setAddingProvider(undefined);
  };

  const submit = () => {
    setError('');
    onSave(form);
  };

  const activeProvider = form.aiProviders.find((provider) => provider.id === form.activeProviderId);
  const aiConfigured = form.aiProviders.some((provider) => provider.apiKey.trim());
  const setupIncomplete = !vaultHandle || !aiConfigured;
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
      <Card>
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
          <CardContent className="border-t border-border pt-3">{content}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );

  return (
    <TooltipProvider>
      <section className="flex h-full min-h-0 flex-col gap-3">
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        {vaultStatus ? <Alert variant="success">{vaultStatus}</Alert> : null}

        <ScrollArea className="min-h-0 flex-1 pr-2">
          <div className="space-y-3">
            {setupIncomplete ? (
              <Card className="border-primary/40 bg-primary/5">
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

            <Card>
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

            <Card>
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

                <div className="space-y-2">
                  {form.aiProviders.map((provider) => {
                    const editing = editingProviderId === provider.id;
                    const result = testResults[provider.id];
                    const models = providerModels(provider);
                    const showKey = Boolean(showKeyById[provider.id]);

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
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1.5">
                                <Label>名称</Label>
                                <Input
                                  onChange={(event) =>
                                    updateProvider({ ...provider, name: event.target.value })
                                  }
                                  value={provider.name}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label>模型</Label>
                                {models.length > 0 ? (
                                  <Select
                                    onValueChange={(value) =>
                                      updateProvider({ ...provider, model: value })
                                    }
                                    value={provider.model}
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {models.map((model) => (
                                        <SelectItem key={model} value={model}>
                                          {model}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <Input
                                    onChange={(event) =>
                                      updateProvider({ ...provider, model: event.target.value })
                                    }
                                    placeholder="model-name"
                                    value={provider.model}
                                  />
                                )}
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              <Label>API Key</Label>
                              <div className="flex gap-2">
                                <Input
                                  onChange={(event) =>
                                    updateProvider({ ...provider, apiKey: event.target.value })
                                  }
                                  placeholder="sk-..."
                                  type={showKey ? 'text' : 'password'}
                                  value={provider.apiKey}
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
                            </div>

                            <div className="space-y-1.5">
                              <div className="flex items-center gap-1.5">
                                <Label>API 地址</Label>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    ShuHai 会请求 baseUrl + /chat/completions。
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              <Input
                                onChange={(event) =>
                                  updateProvider({ ...provider, baseUrl: event.target.value })
                                }
                                placeholder="https://api.example.com/v1"
                                value={provider.baseUrl}
                              />
                            </div>

                            <div className="flex gap-2">
                              <Button
                                disabled={testingProviderId === provider.id}
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
                              <Button
                                disabled={form.aiProviders.length <= 1}
                                onClick={() => deleteProvider(provider.id)}
                                size="sm"
                                variant="outline"
                              >
                                <Trash2 className="h-4 w-4" />
                                删除
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

                {addingProvider ? (
                  <div className="space-y-3 rounded-md border border-border p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label>服务商类型</Label>
                        <Select
                          onValueChange={(value) =>
                            setAddingProvider(createNewProvider(value as AiProviderType))
                          }
                          value={addingProvider.provider}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PROVIDER_TEMPLATES.map((template) => (
                              <SelectItem key={template.provider} value={template.provider}>
                                {template.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>名称</Label>
                        <Input
                          onChange={(event) =>
                            setAddingProvider({ ...addingProvider, name: event.target.value })
                          }
                          value={addingProvider.name}
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label>API Key</Label>
                      <Input
                        onChange={(event) =>
                          setAddingProvider({ ...addingProvider, apiKey: event.target.value })
                        }
                        placeholder="sk-..."
                        type="password"
                        value={addingProvider.apiKey}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label>模型</Label>
                        <Input
                          onChange={(event) =>
                            setAddingProvider({ ...addingProvider, model: event.target.value })
                          }
                          placeholder="model-name"
                          value={addingProvider.model}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>API 地址</Label>
                        <Input
                          onChange={(event) =>
                            setAddingProvider({ ...addingProvider, baseUrl: event.target.value })
                          }
                          placeholder="https://api.example.com/v1"
                          value={addingProvider.baseUrl}
                        />
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        disabled={testingProviderId === addingProvider.id}
                        loading={testingProviderId === addingProvider.id}
                        onClick={() => testProvider(addingProvider)}
                        size="sm"
                        variant="secondary"
                      >
                        测试连接
                      </Button>
                      <Button onClick={addProvider} size="sm">
                        添加
                      </Button>
                      <Button
                        onClick={() => setAddingProvider(undefined)}
                        size="sm"
                        variant="outline"
                      >
                        取消
                      </Button>
                    </div>

                    {testResults[addingProvider.id] ? (
                      <Alert
                        variant={
                          testResults[addingProvider.id]?.success ? 'success' : 'destructive'
                        }
                      >
                        {testResults[addingProvider.id]?.message}
                      </Alert>
                    ) : null}
                  </div>
                ) : (
                  <Button
                    onClick={() => setAddingProvider(createNewProvider('openai-compatible'))}
                    variant="outline"
                  >
                    <Plus className="h-4 w-4" />
                    添加 AI 服务商
                  </Button>
                )}

                {!form.aiProviders.some((provider) => provider.apiKey.trim()) ? (
                  <Alert variant="warning">
                    未配置 API Key 时，ShuHai 会使用内置规则整理；配置后能获得更精确的 AI 建议。
                  </Alert>
                ) : null}
              </CardContent>
            </Card>

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
    </TooltipProvider>
  );
}
