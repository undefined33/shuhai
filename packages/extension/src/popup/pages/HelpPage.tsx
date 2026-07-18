import { useEffect, useState } from 'react';
import { Database, FolderKanban, KeyRound, Radar, RotateCcw, Shield } from 'lucide-react';

import { Alert } from '../../components/ui/alert.js';
import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { ScrollArea } from '../../components/ui/scroll-area.js';
import {
  getExtractorDiagnostics,
  type StoredExtractorDiagnostic,
} from '../../utils/extractor-diagnostics.js';

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

function timeAgo(value: string): string {
  const minutes = Math.floor((Date.now() - Date.parse(value)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} 小时前` : `${Math.floor(hours / 24)} 天前`;
}

export default function HelpPage() {
  const [diagnostics, setDiagnostics] = useState<StoredExtractorDiagnostic[]>([]);

  useEffect(() => {
    void getExtractorDiagnostics()
      .then(setDiagnostics)
      .catch(() => setDiagnostics([]));
  }, []);

  return (
    <ScrollArea className="h-full pr-2">
      <section className="space-y-3 pb-2">
        <Alert>
          ShuHai 只做两件事：整理 Chrome 书签，以及把当前 X 内容或 X 收藏同步到复核任务。 所有移动和
          Vault 写入都要由你确认。
        </Alert>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <FolderKanban className="h-4 w-4 text-primary" />
              整理书签
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StepList
              items={[
                '选择安全模式或全量模式并生成建议。',
                '本地规则先分析；只有你单次确认后，无法确定的最小字段才会发给已配置 AI。',
                '逐条复核建议，AI 建议默认不选中。',
                '确认应用后才移动真实 Chrome 书签，操作可恢复。',
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              同步 X 内容
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <StepList
              items={[
                '打开一条精确的 x.com 详情页，点击“加入安全复核”。',
                '或在 X 收藏页主动启动增量扫描。',
                '检查新增、变化和不完整项目；已存在内容不会重复写入。',
                '选择要保存的项目后，再确认写入 Obsidian Vault。',
              ]}
            />
            <Alert variant="warning">
              普通网页、微博和旧右键提取入口已经停用。远程媒体只保留链接，不会自动下载或嵌入。
            </Alert>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Radar className="h-4 w-4 text-primary" />X 提取诊断
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {diagnostics.length === 0 ? (
              <p className="text-xs text-muted-foreground">最近没有安全提取失败记录。</p>
            ) : (
              diagnostics.slice(0, 5).map((report) => (
                <div
                  className="flex items-center gap-2 rounded-md bg-muted px-2 py-2 text-xs"
                  key={`${report.timestamp}-${report.errorCode}`}
                >
                  <Badge variant="warning">X</Badge>
                  <span className="min-w-0 flex-1 truncate">{report.errorCode}</span>
                  <span className="text-muted-foreground">{timeAgo(report.timestamp)}</span>
                </div>
              ))
            )}
            <p className="text-xs leading-5 text-muted-foreground">
              诊断只记录固定错误码和布尔探针，不记录 URL、账号、正文、媒体、选择器或原始异常。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              AI 与密钥
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>AI 完全可选；不配置时使用本地规则。</p>
            <p>
              API Key
              与公开设置分开保存，不会出现在状态、日志、诊断、备份或错误信息中。每次分类仍需确认网络访问。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-primary" />
              恢复
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>书签移动、删除和 URL 更新都有逐项结果与恢复记录。</p>
            <p>同步任务中断时会保留任务和写入意图，不会把 partial 伪装成成功。</p>
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
            <p>书签整理不会访问书签指向的网页。</p>
            <p>X 提取只在用户当前打开的精确页面、主动点击后运行，不读取 Cookie 或 token。</p>
            <p>页面正文始终是不可信文本，最终写入使用既有安全 Markdown 管线。</p>
          </CardContent>
        </Card>
      </section>
    </ScrollArea>
  );
}
