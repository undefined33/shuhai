import { AlertTriangle, FolderOpen, KeyRound, Network, RotateCw, Settings, X } from 'lucide-react';
import type { StructuredError } from '../utils/error-messages.js';
import { Button } from './ui/button.js';
import { Card, CardContent } from './ui/card.js';

interface ErrorRecoveryProps {
  error: StructuredError;
  onRetry?: () => void;
  onOpenSettings?: () => void;
  onSelectVault?: () => void;
  onDismiss?: () => void;
  onUseRules?: () => void;
}

function iconForError(code: StructuredError['code']) {
  if (code.startsWith('AI_KEY')) {
    return <KeyRound className="h-4 w-4 text-amber-400" />;
  }

  if (code.startsWith('VAULT')) {
    return <FolderOpen className="h-4 w-4 text-amber-400" />;
  }

  if (code.includes('NETWORK') || code.includes('TIMEOUT') || code === 'HEALTH_ABORTED') {
    return <Network className="h-4 w-4 text-amber-400" />;
  }

  return <AlertTriangle className="h-4 w-4 text-amber-400" />;
}

export function ErrorRecovery({
  error,
  onRetry,
  onOpenSettings,
  onSelectVault,
  onDismiss,
  onUseRules,
}: ErrorRecoveryProps) {
  const action = error.action;
  const runAction = () => {
    if (action?.handler === 'retry') {
      onRetry?.();
      return;
    }

    if (action?.handler === 'openSettings') {
      onOpenSettings?.();
      return;
    }

    if (action?.handler === 'selectVault') {
      onSelectVault?.();
      return;
    }
  };

  return (
    <Card className="border-amber-800 bg-amber-950/30">
      <CardContent className="space-y-3 p-3">
        <div className="flex items-start gap-2">
          {iconForError(error.code)}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{error.message}</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{error.suggestion}</p>
            {error.details ? (
              <p className="mt-1 break-words text-[11px] text-amber-200/80">{error.details}</p>
            ) : null}
          </div>
          {onDismiss ? (
            <Button
              aria-label="关闭错误提示"
              className="-mr-1 -mt-1 h-6 w-6"
              onClick={onDismiss}
              size="icon"
              variant="ghost"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {action ? (
            <Button onClick={runAction} size="sm" variant="outline">
              {action.handler === 'retry' ? <RotateCw className="h-4 w-4" /> : null}
              {action.handler === 'openSettings' ? <Settings className="h-4 w-4" /> : null}
              {action.handler === 'selectVault' ? <FolderOpen className="h-4 w-4" /> : null}
              {action.label}
            </Button>
          ) : null}
          {error.code.startsWith('AI_') && onUseRules ? (
            <Button onClick={onUseRules} size="sm" variant="ghost">
              改用规则分类
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
