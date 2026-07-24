import type { ReactNode } from 'react';

interface ActionBarProps {
  readonly children: ReactNode;
  readonly label?: string;
}

export function ActionBar({ children, label = '任务操作' }: ActionBarProps) {
  return (
    <div
      aria-label={label}
      className="flex min-h-12 items-center gap-2 border-t border-border pt-3"
      role="group"
    >
      {children}
    </div>
  );
}
