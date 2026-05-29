import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Database, FolderKanban, KeyRound, Radar, RotateCcw, Shield } from 'lucide-react';
import type { DiagnosticReport, ExtractorPlatform } from '../../shared/bookmark-types.js';
import { Alert } from '../../components/ui/alert.js';
import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { ScrollArea } from '../../components/ui/scroll-area.js';
import { getExtractorDiagnostics } from '../../utils/extractor-diagnostics.js';

function StepList({ items }: { items: string[] }) {
  return (
    <ol className="space-y-1 text-sm text-muted-foreground">
      {items.map((item, index) => (
        <li className="flex gap-2" key={item}>
          <span className="text-xs font-semibold text-primary">{index + 1}</span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

function platformLabel(platform: ExtractorPlatform): string {
  return platform === 'twitter' ? 'Twitter/X' : '微博';
}

function timeAgo(value: string): string {
  const diffMs = Date.now() - Date.parse(value);
  if (!Number.isFinite(diffMs) || diffMs < 0) {
    return '刚刚';
  }

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return '刚刚';
  }

  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }

  return `${Math.floor(hours / 24)} 天前`;
}

export default function HelpPage() {
  const [diagnostics, setDiagnostics] = useState<DiagnosticReport[]>([]);

  useEffect(() => {
    void getExtractorDiagnostics()
      .then(setDiagnostics)
      .catch(() => setDiagnostics([]));
  }, []);

  const byPlatform = useMemo(
    () =>
      new Map<ExtractorPlatform, DiagnosticReport>(
        diagnostics.map((report) => [report.platform, report]),
      ),
    [diagnostics],
  );

  return (
    <ScrollArea className="h-full pr-2">
      <section className="space-y-3 pb-2">
        <Alert>
          ShuHai 的核心原则是先生成方案、再由你确认。没有点击“应用选中”前，不会移动真实 Chrome
          书签。
        </Alert>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <FolderKanban className="h-4 w-4 text-primary" />
              书签整理
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md border border-border p-2">
                <Badge variant="secondary">安全模式</Badge>
                <p className="mt-2 text-muted-foreground">
                  只整理根目录或未分类书签，尽量不打扰已有文件夹结构。
                </p>
              </div>
              <div className="rounded-md border border-border p-2">
                <Badge variant="warning">全量模式</Badge>
                <p className="mt-2 text-muted-foreground">
                  重新审视全部书签，可能建议从一个文件夹移动到另一个文件夹。
                </p>
              </div>
            </div>
            <StepList
              items={[
                '在书签页选择整理模式。',
                '点击生成，等待 AI 或规则分析完成。',
                '在方案页逐条确认移动建议。',
                '取消不想移动的项目，必要时修改目标文件夹。',
                '点击应用选中，ShuHai 会先备份再移动书签。',
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              导出到 Obsidian
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <StepList
              items={[
                '首次使用时点击选择 Vault，并授权 Obsidian 根目录。',
                '选择导出范围：全部书签、当前方案或方案选中项。',
                '点击预览，确认将写入的 Markdown 文件数量和目录。',
                '点击导出，已有文件会跳过，不会覆盖。',
              ]}
            />
            <Alert variant="warning">
              ShuHai 导出的是书签索引和已捕获内容，不会批量抓取远程网页，也不会自动加载远程图片。
            </Alert>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              保存当前文章
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StepList
              items={[
                '在正在阅读的网页中右键，选择“保存此文章到知识库”。',
                'ShuHai 只读取当前页面已经加载的 DOM，不访问任何外部 URL。',
                '导出页会显示标题、来源、字数、图片链接数量和正文预览。',
                '确认标签后点击写入 Vault，文章正文会保存为 Markdown。',
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              保存 Twitter/X 或微博内容
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StepList
              items={[
                '在 Twitter/X 或微博页面看到想保存的内容时右键。',
                '选择保存当前推文或微博。',
                '打开 ShuHai 的导出页，确认待保存内容。',
                '写入 Vault 后，待处理内容会被清空。',
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Radar className="h-4 w-4 text-primary" />
              内容提取状态
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              {(['twitter', 'weibo'] as const).map((platform) => {
                const report = byPlatform.get(platform);
                const degraded = Boolean(report?.fallbacksUsed.length);
                const broken = report && (!report.structureValid || report.error);

                return (
                  <div className="rounded-md border border-border p-2" key={platform}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{platformLabel(platform)}</span>
                      <Badge variant={broken ? 'danger' : degraded ? 'warning' : 'success'}>
                        {broken ? '异常' : degraded ? '降级' : '正常'}
                      </Badge>
                    </div>
                    <p className="mt-2 text-muted-foreground">
                      {report
                        ? `${timeAgo(report.timestamp)} · ${report.url}`
                        : '暂无失败或降级记录'}
                    </p>
                  </div>
                );
              })}
            </div>

            {diagnostics.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">最近问题</div>
                {diagnostics.slice(0, 4).map((report) => (
                  <div
                    className="rounded-md bg-muted px-2 py-2 text-xs"
                    key={`${report.timestamp}-${report.url}`}
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant={report.structureValid ? 'warning' : 'danger'}>
                        {platformLabel(report.platform)}
                      </Badge>
                      <span className="text-muted-foreground">{timeAgo(report.timestamp)}</span>
                    </div>
                    <p className="mt-1">
                      {report.error ||
                        `使用了备选选择器：${report.fallbacksUsed.join('、') || '未知'}`}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <Alert>最近没有内容提取失败或降级记录。</Alert>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              AI 服务商配置
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              API Key 是可选项。不配置时使用内置规则，配置后会调用当前 AI 服务商生成更细的分类建议。
            </p>
            <p>Key 保存在 Chrome 本地存储中，不会上传到 ShuHai 自己的服务器。</p>
            <a
              className="text-primary underline-offset-4 hover:underline"
              href="https://platform.deepseek.com"
              rel="noreferrer"
              target="_blank"
            >
              打开 DeepSeek 控制台
            </a>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-primary" />
              备份与撤销
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>每次应用整理方案前都会保存书签树快照，并记录本次移动操作。</p>
            <p>如果结果不满意，可以在书签页点击撤销上次整理；也可以在设置页下载备份 JSON。</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              安全边界
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Chrome 书签整理只读标题、URL 和文件夹路径，不会访问网页正文。</p>
            <p>社交内容保存只处理当前页面已渲染的 DOM，并在写入 Markdown 前做安全清洗。</p>
            <p>导出文件不会自动下载远程媒体，避免在 Obsidian 中泄露本机 IP 或触发远程资源加载。</p>
          </CardContent>
        </Card>
      </section>
    </ScrollArea>
  );
}
