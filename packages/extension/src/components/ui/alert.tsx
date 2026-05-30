import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { Button } from './button.js';

const alertVariants = cva('rounded-lg border p-3 text-sm', {
  variants: {
    variant: {
      default: 'border-border bg-card text-card-foreground',
      success: 'border-primary/20 bg-primary/10 text-primary',
      warning: 'border-accent/25 bg-accent-soft text-accent',
      destructive: 'border-destructive/25 bg-destructive/10 text-destructive',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

interface AlertProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
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
