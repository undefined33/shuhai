import { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  KeyRound,
  Save,
  Sparkles,
} from 'lucide-react';
import type { OnboardingProgress } from '../../utils/onboarding.js';
import { onboardingComplete } from '../../utils/onboarding.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';

interface OnboardingChecklistProps {
  progress: OnboardingProgress;
  compact?: boolean;
  onOpenSettings(): void;
  onOpenOrganize(): void;
  onOpenCollect(): void;
  onSkip(): void;
}

export function OnboardingChecklist({
  progress,
  compact = false,
  onOpenSettings,
  onOpenOrganize,
  onOpenCollect,
  onSkip,
}: OnboardingChecklistProps) {
  const [open, setOpen] = useState(true);
  const steps = [
    {
      key: 'vaultConfigured',
      done: progress.vaultConfigured,
      icon: <FolderOpen className="h-4 w-4" />,
      title: '选择 Obsidian Vault',
      description: '让 ShuHai 知道 Markdown 应该写到哪里。',
      action: '选择目录',
      onClick: onOpenSettings,
    },
    {
      key: 'providerConfigured',
      done: progress.providerConfigured,
      icon: <KeyRound className="h-4 w-4" />,
      title: '配置 AI Provider',
      description: '填写并启用一个 Provider，之后才能用 AI 整理。',
      action: '配置 AI',
      onClick: onOpenSettings,
    },
    {
      key: 'firstClassifyDone',
      done: progress.firstClassifyDone,
      icon: <Sparkles className="h-4 w-4" />,
      title: '试一次书签整理',
      description: '先生成建议，确认后才会移动真实 Chrome 书签。',
      action: '整理书签',
      onClick: onOpenOrganize,
    },
    {
      key: 'firstExportDone',
      done: progress.firstExportDone,
      icon: <Save className="h-4 w-4" />,
      title: '保存一篇内容',
      description: '在网页右键提取文章/推文/微博，再到待入库确认写入。',
      action: '查看队列',
      onClick: onOpenCollect,
    },
  ] as const;
  const doneCount = steps.filter((step) => step.done).length;

  if (onboardingComplete(progress)) {
    return null;
  }

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardContent className="space-y-3 p-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold">
              首次使用引导
              <Badge variant="secondary">{doneCount}/4</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              跟着这四步走，两分钟内完成 ShuHai 的关键配置。
            </p>
          </div>
          <Button
            aria-label={open ? '收起引导' : '展开引导'}
            onClick={() => setOpen((current) => !current)}
            size="icon"
            variant="ghost"
          >
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>

        {open ? (
          <div className={compact ? 'space-y-2' : 'grid gap-2 md:grid-cols-2'}>
            {steps.map((step) => (
              <div
                className="flex items-start gap-2 rounded-md border border-border bg-card p-2"
                key={step.key}
              >
                <div className={step.done ? 'text-primary' : 'text-muted-foreground'}>
                  {step.done ? <CheckCircle2 className="h-4 w-4" /> : step.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{step.title}</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.description}</p>
                </div>
                <Button
                  disabled={step.done}
                  onClick={step.onClick}
                  size="sm"
                  variant={step.done ? 'ghost' : 'outline'}
                >
                  {step.done ? '已完成' : step.action}
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button onClick={onSkip} size="sm" variant="ghost">
            跳过引导
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
