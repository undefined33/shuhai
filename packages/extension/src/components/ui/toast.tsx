import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { Button } from './button.js';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

export interface ToastInput {
  kind?: ToastKind;
  message: string;
  description?: string;
  durationMs?: number;
  action?: ToastAction;
}

interface ToastEntry {
  id: string;
  kind: ToastKind;
  message: string;
  description: string;
  durationMs: number | null;
  action?: ToastAction;
}

interface ToastContextValue {
  toast(input: ToastInput): void;
  dismiss(id: string): void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

function toastId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `toast_${Date.now()}_${Math.random()}`;
}

export function toastDuration(input: ToastInput): number | null {
  if (typeof input.durationMs === 'number') {
    return input.durationMs;
  }

  return input.kind === 'error' ? null : 3000;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastEntry[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const entry: ToastEntry = {
        id: toastId(),
        kind: input.kind ?? 'info',
        message: input.message,
        description: input.description ?? '',
        durationMs: toastDuration(input),
        action: input.action,
      };

      setItems((current) => [entry, ...current].slice(0, 4));
      if (entry.durationMs !== null) {
        window.setTimeout(() => dismiss(entry.id), entry.durationMs);
      }
    },
    [dismiss],
  );

  const value = useMemo(() => ({ dismiss, toast }), [dismiss, toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-3 top-3 z-50 flex w-[min(360px,calc(100vw-1.5rem))] flex-col gap-2">
        {items.map((item) => (
          <div
            className={cn(
              'pointer-events-auto rounded-lg border bg-popover p-3 text-sm',
              item.kind === 'success' && 'border-primary/40',
              item.kind === 'error' && 'border-destructive/40',
              item.kind === 'info' && 'border-border',
            )}
            key={item.id}
            role={item.kind === 'error' ? 'alert' : 'status'}
          >
            <div className="flex items-start gap-2">
              {item.kind === 'success' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              ) : item.kind === 'error' ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              ) : (
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <div className="break-words font-medium">{item.message}</div>
                {item.description ? (
                  <div className="mt-1 break-words text-xs text-muted-foreground">
                    {item.description}
                  </div>
                ) : null}
                {item.action ? (
                  <Button
                    className="mt-2 h-7 px-2 text-xs"
                    onClick={() => void item.action?.onClick()}
                    size="sm"
                    variant="outline"
                  >
                    {item.action.label}
                  </Button>
                ) : null}
              </div>
              <Button
                aria-label="关闭通知"
                className="-mr-1 -mt-1 h-6 w-6"
                onClick={() => dismiss(item.id)}
                size="icon"
                variant="ghost"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside ToastProvider');
  }

  return context;
}
