import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  HelpCircle,
  Info,
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
  CustomRule,
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

interface SettingsProps {
  backups: BackupRecord[];
  busy: boolean;
  exportManifests: ExportManifest[];
  settings: AppSettings;
  onSave(settings: AppSettings): void;
  onDownloadBackup(backup: BackupRecord): void;
  onTestProvider(provider: AiProviderConfig): Promise<AiProviderTestResult>;
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

export default function Settings({
  backups,
  busy,
  exportManifests,
  settings,
  onSave,
  onDownloadBackup,
  onTestProvider,
}: SettingsProps) {
  const [form, setForm] = useState(settings);
  const [rulesText, setRulesText] = useState(stringifyRules(settings.customRules));
  const [showKeyById, setShowKeyById] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [vaultHandle, setVaultHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [vaultStatus, setVaultStatus] = useState('');
  const [vaultBusy, setVaultBusy] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState(settings.activeProviderId);
  const [addingProvider, setAddingProvider] = useState<AiProviderConfig | undefined>();
  const [testResults, setTestResults] = useState<Record<string, AiProviderTestResult>>({});
  const [testingProviderId, setTestingProviderId] = useState('');

  useEffect(() => {
    setForm(settings);
    setRulesText(stringifyRules(settings.customRules));
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
          ? providers[0]?.id ?? current.activeProviderId
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
    <TooltipProvider>
      <section className="flex h-full min-h-0 flex-col gap-3">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {vaultStatus ? <Alert variant="success">{vaultStatus}</Alert> : null}

      <ScrollArea className="min-h-0 flex-1 pr-2">
        <div className="space-y-3">
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
                <Label>导出前缀</Label>
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
                  收藏内容和书签索引都会写入同一个 Vault。首次使用需要授权目录。
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
                  <span>使用 AI 辅助分类</span>
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
                      <SelectItem value="safe">未分类</SelectItem>
                      <SelectItem value="full">全量</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-md border border-border bg-muted/40 px-2 py-2 text-xs">
                当前使用：
                <span className="font-medium">
                  {form.aiProviders.find((provider) => provider.id === form.activeProviderId)
                    ?.name ?? '未选择'}
                </span>
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
                  未配置 API Key 时，ShuHai 会使用内置规则分类；配置后能获得更精确的 AI 建议。
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>自定义规则</CardTitle>
            </CardHeader>
            <CardContent>
              <textarea
                className="min-h-32 w-full resize-y rounded-md border border-input bg-card px-3 py-2 font-mono text-xs shadow-sm outline-none focus:ring-2 focus:ring-ring"
                onChange={(event) => setRulesText(event.target.value)}
                rows={6}
                spellCheck={false}
                value={rulesText}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>最近写入</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {exportManifests.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  尚未写入过 Vault。收藏内容或导出书签索引后会显示在这里。
                </p>
              ) : null}
              {exportManifests.map((manifest) => (
                <div className="flex items-center gap-2 text-xs" key={manifest.id}>
                  <span className="min-w-0 flex-1 truncate">
                    {new Date(manifest.exportedAt).toLocaleString()}
                  </span>
                  <Badge variant="secondary">{manifest.bookmarkCount}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>书签备份</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {backups.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  暂无备份。每次应用整理方案前会自动备份，便于撤销。
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <Info className="h-4 w-4 text-primary" />
                使用帮助
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>“整理书签”负责浏览、AI 分类、确认移动和链接体检。</p>
              <p>“收藏内容”负责处理右键保存进来的文章、推文和微博。</p>
              <p>ShuHai 不会批量抓取远程网页，写入 Markdown 前会做安全清洗。</p>
            </CardContent>
          </Card>
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
