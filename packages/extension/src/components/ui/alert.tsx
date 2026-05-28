import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { Button } from './button.js';

const alertVariants = cva('rounded-lg border p-3 text-sm shadow-sm', {
  variants: {
    variant: {
      default: 'border-border bg-card text-card-foreground',
      success: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
      warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200',
      destructive: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

interface AlertProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  onClose?: () => void;
}

export function Alert({ className, children, onClose, variant, ...props }: AlertProps) {
  return (
    <div className={cn(alertVariants({ variant }), className)} role="status" {...props}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        {onClose ? (
          <Button
            aria-label="关闭"
            className="-mr-1 -mt-1 h-6 w-6"
            onClick={onClose}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
