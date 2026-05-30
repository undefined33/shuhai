import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, RotateCcw, TestTube2, Trash2 } from 'lucide-react';
import type { CustomRule, RuleType } from '../../shared/bookmark-types.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { Label } from '../../components/ui/label.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { matchRules, normalizeCustomRule } from '../../utils/rule-matcher.js';

interface RulesEditorProps {
  rules: CustomRule[];
  onChange(rules: CustomRule[]): void;
}

const RULE_TYPES: Array<{ value: RuleType; label: string }> = [
  { value: 'domain', label: '域名' },
  { value: 'title-keyword', label: '标题关键词' },
  { value: 'url-pattern', label: 'URL 模式' },
  { value: 'combined', label: '组合' },
];

export const PRESET_RULES: CustomRule[] = [
  {
    id: 'preset-social-x',
    type: 'domain',
    pattern: 'x.com',
    category: '社交',
    tags: ['social'],
    enabled: true,
  },
  {
    id: 'preset-social-twitter',
    type: 'domain',
    pattern: 'twitter.com',
    category: '社交',
    tags: ['social'],
    enabled: true,
  },
  {
    id: 'preset-social-weibo',
    type: 'domain',
    pattern: 'weibo.com',
    category: '社交',
    tags: ['social'],
    enabled: true,
  },
  {
    id: 'preset-github',
    type: 'domain',
    pattern: 'github.com',
    category: '技术/开源',
    tags: ['github', 'dev'],
    enabled: true,
  },
  {
    id: 'preset-news',
    type: 'title-keyword',
    pattern: '新闻|资讯|breaking|headline',
    category: '阅读/新闻',
    tags: ['news'],
    enabled: true,
  },
  {
    id: 'preset-video-youtube',
    type: 'domain',
    pattern: 'youtube.com',
    category: '媒体/视频',
    tags: ['video'],
    enabled: true,
  },
  {
    id: 'preset-video-bilibili',
    type: 'domain',
    pattern: 'bilibili.com',
    category: '媒体/视频',
    tags: ['video'],
    enabled: true,
  },
];

export function createEmptyRule(): CustomRule {
  return {
    id: `rule-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
    type: 'domain',
    pattern: '',
    category: '',
    tags: [],
    priority: 0,
    enabled: true,
  };
}

export function resequenceRules(rules: CustomRule[]): CustomRule[] {
  return rules.map((rule, index) => ({
    ...normalizeCustomRule(rule, index, rules.length),
    priority: rules.length - index,
  }));
}

function tagsText(tags: string[]): string {
  return tags.join(', ');
}

function parseTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function addRuleForEditor(rules: CustomRule[], rule = createEmptyRule()): CustomRule[] {
  return resequenceRules([...resequenceRules(rules), rule]);
}

export function deleteRuleForEditor(rules: CustomRule[], id: string | undefined): CustomRule[] {
  return resequenceRules(resequenceRules(rules).filter((rule) => rule.id !== id));
}

export function moveRuleForEditor(
  rules: CustomRule[],
  id: string | undefined,
  direction: -1 | 1,
): CustomRule[] {
  const normalizedRules = resequenceRules(rules);
  const index = normalizedRules.findIndex((rule) => rule.id === id);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= normalizedRules.length) {
    return normalizedRules;
  }

  const nextRules = [...normalizedRules];
  const [rule] = nextRules.splice(index, 1);
  nextRules.splice(targetIndex, 0, rule);
  return resequenceRules(nextRules);
}

export function importPresetRulesForEditor(rules: CustomRule[]): CustomRule[] {
  const normalizedRules = resequenceRules(rules);
  const existing = new Set(normalizedRules.map((rule) => `${rule.type}:${rule.pattern}`));
  const additions = PRESET_RULES.filter((rule) => !existing.has(`${rule.type}:${rule.pattern}`));
  return resequenceRules([...normalizedRules, ...additions]);
}

export function testRulesForEditor(rules: CustomRule[], url: string, title: string): string {
  const result = matchRules({ url, title }, resequenceRules(rules));
  if (!result.matched) {
    return '未命中任何规则，将使用 AI 或内置规则分类。';
  }

  return `命中 ${result.rule?.type}:${result.rule?.pattern}，文件夹 ${result.category}，标签 ${result.tags.join(', ') || '无'}`;
}

export default function RulesEditor({ rules, onChange }: RulesEditorProps) {
  const normalizedRules = useMemo(() => resequenceRules(rules), [rules]);
  const [testUrl, setTestUrl] = useState('https://github.com/anthropics/claude-code');
  const [testTitle, setTestTitle] = useState('Claude Code - GitHub');
  const [testResult, setTestResult] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedText, setAdvancedText] = useState(JSON.stringify(normalizedRules, null, 2));
  const [advancedError, setAdvancedError] = useState('');

  const updateRule = (id: string | undefined, patch: Partial<CustomRule>) => {
    onChange(
      resequenceRules(
        normalizedRules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
      ),
    );
  };

  const moveRule = (id: string | undefined, direction: -1 | 1) => {
    onChange(moveRuleForEditor(normalizedRules, id, direction));
  };

  const importPresets = () => {
    onChange(importPresetRulesForEditor(normalizedRules));
  };

  const testRules = () => {
    setTestResult(testRulesForEditor(normalizedRules, testUrl, testTitle));
  };

  const applyAdvancedJson = () => {
    setAdvancedError('');
    try {
      const parsed = JSON.parse(advancedText) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error('规则 JSON 必须是数组');
      }

      onChange(
        resequenceRules(
          parsed.map((rule, index) => normalizeCustomRule(rule, index, parsed.length)),
        ),
      );
      setAdvancedOpen(false);
    } catch (error) {
      setAdvancedError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>标签规则</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onChange(addRuleForEditor(normalizedRules))} size="sm">
            <Plus className="h-4 w-4" />
            添加规则
          </Button>
          <Button onClick={importPresets} size="sm" variant="outline">
            <RotateCcw className="h-4 w-4" />
            导入预设
          </Button>
        </div>

        <div className="space-y-2">
          {normalizedRules.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              暂无自定义规则。可以添加域名、标题关键词、URL 模式或组合规则。
            </p>
          ) : null}

          {normalizedRules.map((rule, index) => (
            <div className="space-y-2 rounded-md border border-border p-2" key={rule.id}>
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <Button
                    disabled={index === 0}
                    onClick={() => moveRule(rule.id, -1)}
                    size="icon"
                    variant="outline"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    disabled={index === normalizedRules.length - 1}
                    onClick={() => moveRule(rule.id, 1)}
                    size="icon"
                    variant="outline"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
                <Select
                  onValueChange={(value) => updateRule(rule.id, { type: value as RuleType })}
                  value={rule.type}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RULE_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    checked={rule.enabled !== false}
                    className="h-4 w-4 accent-primary"
                    onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })}
                    type="checkbox"
                  />
                  启用
                </label>
                <Button
                  className="ml-auto"
                  onClick={() => onChange(deleteRuleForEditor(normalizedRules, rule.id))}
                  size="icon"
                  variant="ghost"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {rule.type === 'domain' || rule.type === 'title-keyword' ? (
                <div className="space-y-1.5">
                  <Label>{rule.type === 'domain' ? '域名' : '标题关键词'}</Label>
                  <Input
                    onChange={(event) => updateRule(rule.id, { pattern: event.target.value })}
                    placeholder={rule.type === 'domain' ? 'github.com' : 'React|CVE|APT'}
                    value={rule.pattern}
                  />
                </div>
              ) : null}

              {rule.type === 'url-pattern' || rule.type === 'combined' ? (
                <div className="space-y-1.5">
                  <Label>URL 模式</Label>
                  <Input
                    onChange={(event) =>
                      updateRule(rule.id, {
                        urlPattern: event.target.value,
                        pattern: event.target.value,
                      })
                    }
                    placeholder="https://*.github.com/**"
                    value={rule.urlPattern ?? rule.pattern}
                  />
                </div>
              ) : null}

              {rule.type === 'combined' ? (
                <div className="space-y-1.5">
                  <Label>标题关键词</Label>
                  <Input
                    onChange={(event) => updateRule(rule.id, { titlePattern: event.target.value })}
                    placeholder="CVE|writeup"
                    value={rule.titlePattern ?? ''}
                  />
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>目标文件夹</Label>
                  <Input
                    onChange={(event) => updateRule(rule.id, { category: event.target.value })}
                    placeholder="技术/开源"
                    value={rule.category}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>标签</Label>
                  <Input
                    onChange={(event) =>
                      updateRule(rule.id, { tags: parseTags(event.target.value) })
                    }
                    placeholder="github, dev"
                    value={tagsText(rule.tags)}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-1">
                {rule.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2">
          <div className="text-sm font-medium">测试规则</div>
          <div className="grid grid-cols-2 gap-2">
            <Input onChange={(event) => setTestUrl(event.target.value)} value={testUrl} />
            <Input onChange={(event) => setTestTitle(event.target.value)} value={testTitle} />
          </div>
          <Button onClick={testRules} size="sm" variant="secondary">
            <TestTube2 className="h-4 w-4" />
            测试
          </Button>
          {testResult ? <p className="text-xs text-muted-foreground">{testResult}</p> : null}
        </div>

        <div className="space-y-2 rounded-md border border-border p-2">
          <Button
            onClick={() => {
              setAdvancedText(JSON.stringify(normalizedRules, null, 2));
              setAdvancedOpen((open) => !open);
            }}
            size="sm"
            variant="outline"
          >
            高级 JSON 模式
          </Button>
          {advancedOpen ? (
            <div className="space-y-2">
              <textarea
                className="min-h-32 w-full resize-y rounded-md border border-input bg-card px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
                onChange={(event) => setAdvancedText(event.target.value)}
                rows={6}
                spellCheck={false}
                value={advancedText}
              />
              {advancedError ? <p className="text-xs text-destructive">{advancedError}</p> : null}
              <Button onClick={applyAdvancedJson} size="sm">
                应用 JSON
              </Button>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
