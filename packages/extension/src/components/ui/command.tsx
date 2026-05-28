import type { HTMLAttributes, InputHTMLAttributes } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export function Command({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('overflow-hidden rounded-lg border border-border bg-card shadow-sm', className)}
      {...props}
    />
  );
}

export function CommandInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3">
      <Search className="h-4 w-4 text-muted-foreground" />
      <input
        className={cn(
          'h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground',
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function CommandList({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('max-h-72 overflow-auto p-1', className)} {...props} />;
}
