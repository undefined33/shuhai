import { useEffect, useState } from 'react';
import { Download, Eye, EyeOff, HelpCircle, Save } from 'lucide-react';
import type {
  AppSettings,
  BackupRecord,
  CustomRule,
  ExportManifest,
} from '../../shared/bookmark-types.js';
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
  const [showKey, setShowKey] = useState(false);
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
    <TooltipProvider>
      <section className="flex h-full min-h-0 flex-col gap-3">
      {error ? <Alert variant="destructive">{error}</Alert> : null}

      <ScrollArea className="min-h-0 flex-1 pr-2">
        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>AI 分类</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label>DeepSeek API Key</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      在 platform.deepseek.com 获取；Key 只保存在浏览器本地。
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex gap-2">
                  <Input
                    onChange={(event) =>
                      setForm({
                        ...form,
                        deepSeekApiKey: event.target.value,
                      })
                    }
                    placeholder="可选"
                    type={showKey ? 'text' : 'password'}
                    value={form.deepSeekApiKey}
                  />
                  <Button onClick={() => setShowKey((value) => !value)} size="icon" variant="outline">
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>模型</Label>
                  <Select
                    onValueChange={(value) =>
                      setForm({
                        ...form,
                        deepSeekModel: value as AppSettings['deepSeekModel'],
                      })
                    }
                    value={form.deepSeekModel}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="deepseek-chat">chat</SelectItem>
                      <SelectItem value="deepseek-reasoner">reasoner</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

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
              {!form.deepSeekApiKey.trim() ? (
                <Alert variant="warning">
                  未配置 API Key 时，ShuHai 会使用内置规则分类；配置后能获得更精确的 AI 建议。
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>导出</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <Label>目录前缀</Label>
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
              <CardTitle>导出历史</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {exportManifests.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  尚未导出过书签。到导出页选择 Vault 后即可生成历史记录。
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
