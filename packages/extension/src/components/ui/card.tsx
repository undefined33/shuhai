import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'flat' | 'soft' | 'outline';
}

export function Card({ className, variant = 'flat', ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg text-card-foreground',
        variant === 'default' && 'bg-card shadow-none',
        variant === 'flat' && 'bg-transparent shadow-none',
        variant === 'soft' && 'bg-accent-soft shadow-none',
        variant === 'outline' && 'border border-border bg-card shadow-none',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 p-3', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-semibold leading-none', className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-3 pt-0', className)} {...props} />;
}
