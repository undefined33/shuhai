import { useMemo, useState } from 'react';
import type {
  AppSettings,
  MarkdownTemplate,
  MarkdownTemplateScope,
} from '../../shared/bookmark-types.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Label } from '../../components/ui/label.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import {
  TEMPLATE_VARIABLES,
  getDefaultTemplate,
  pickTemplate,
  renderTemplate,
} from '../../utils/markdown-templates.js';

interface MarkdownTemplateEditorProps {
  settings: AppSettings;
  onChange(settings: AppSettings): void;
}

const SCOPES: Array<{ value: MarkdownTemplateScope; label: string }> = [
  { value: 'bookmark', label: '书签' },
  { value: 'twitter', label: '推文' },
  { value: 'weibo', label: '微博' },
  { value: 'article', label: '文章' },
];

const PREVIEW_VARIABLES: Record<string, string> = {
  title: '示例标题',
  title_yaml: '"示例标题"',
  url: 'https://example.com/research',
  url_yaml: '"https://example.com/research"',
  url_link: '[打开](https://example.com/research)',
  date: '2026-05-29',
  created: '2026-05-28',
  source: 'article',
  tags: '["research", "security"]',
  tags_inline: '#research #security',
  folder: '安全/研究',
  folder_yaml: '"安全/研究"',
  confidence: '92% (rule)',
  author: 'Alice',
  author_yaml: '"Alice"',
  handle: '@alice',
  text: '这是一段示例正文。',
  text_quote: '> 这是一段示例正文。',
  description: '示例摘要',
  site_name: 'Example Blog',
  site_name_yaml: '"Example Blog"',
  source_link: '[Example Blog](https://example.com/research)',
  word_count: '1024',
  media_list: '- [图片: sample](https://example.com/a.png)',
};

function upsertTemplate(
  templates: MarkdownTemplate[],
  template: MarkdownTemplate,
): MarkdownTemplate[] {
  const existing = templates.filter((item) => item.id !== template.id);
  return [...existing, template];
}

export default function MarkdownTemplateEditor({
  settings,
  onChange,
}: MarkdownTemplateEditorProps) {
  const [scope, setScope] = useState<MarkdownTemplateScope>('bookmark');
  const [preview, setPreview] = useState('');
  const template = useMemo(
    () => pickTemplate(settings.templates, settings.activeTemplateIds, scope),
    [scope, settings.activeTemplateIds, settings.templates],
  );

  const updateTemplate = (patch: Partial<MarkdownTemplate>) => {
    const nextTemplate = { ...template, ...patch };
    onChange({
      ...settings,
      templates: upsertTemplate(settings.templates, nextTemplate),
      activeTemplateIds: {
        ...settings.activeTemplateIds,
        [scope]: nextTemplate.id,
      },
    });
  };

  const restoreDefault = () => {
    const nextTemplate = getDefaultTemplate(scope);
    onChange({
      ...settings,
      templates: upsertTemplate(
        settings.templates.filter((item) => item.id !== nextTemplate.id),
        nextTemplate,
      ),
      activeTemplateIds: {
        ...settings.activeTemplateIds,
        [scope]: nextTemplate.id,
      },
    });
    setPreview('');
  };

  const insertVariable = (name: string) => {
    updateTemplate({
      body: `${template.body}${template.body.endsWith('\n') ? '' : '\n'}{{${name}}}`,
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>导出模板</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>类型</Label>
            <Select
              onValueChange={(value) => setScope(value as MarkdownTemplateScope)}
              value={scope}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>模板</Label>
            <Select
              onValueChange={(id) =>
                onChange({
                  ...settings,
                  activeTemplateIds: {
                    ...settings.activeTemplateIds,
                    [scope]: id,
                  },
                })
              }
              value={settings.activeTemplateIds[scope] ?? getDefaultTemplate(scope).id}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {settings.templates
                  .filter((item) => item.scope === scope)
                  .map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Frontmatter</Label>
          <textarea
            className="min-h-28 w-full resize-y rounded-md border border-input bg-card px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
            onChange={(event) => updateTemplate({ frontmatter: event.target.value })}
            rows={7}
            spellCheck={false}
            value={template.frontmatter}
          />
        </div>

        <div className="space-y-1.5">
          <Label>正文模板</Label>
          <textarea
            className="min-h-36 w-full resize-y rounded-md border border-input bg-card px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring"
            onChange={(event) => updateTemplate({ body: event.target.value })}
            rows={8}
            spellCheck={false}
            value={template.body}
          />
        </div>

        <div className="flex flex-wrap gap-1">
          {TEMPLATE_VARIABLES[scope].map((name) => (
            <Button key={name} onClick={() => insertVariable(name)} size="sm" variant="outline">
              {`{{${name}}}`}
            </Button>
          ))}
        </div>

        <div className="flex gap-2">
          <Button onClick={() => setPreview(renderTemplate(template, PREVIEW_VARIABLES))} size="sm">
            预览
          </Button>
          <Button onClick={restoreDefault} size="sm" variant="outline">
            恢复默认
          </Button>
        </div>

        {preview ? (
          <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-xs">{preview}</pre>
        ) : null}

        <p className="text-xs text-muted-foreground">
          模板只支持简单变量替换。写入前仍会进行 Markdown 安全清洗。
        </p>
      </CardContent>
    </Card>
  );
}
