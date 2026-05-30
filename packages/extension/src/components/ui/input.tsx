import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm ' +
            'transition placeholder:text-muted-foreground focus-visible:outline-none ' +
            'focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
