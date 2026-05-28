import * as ProgressPrimitive from '@radix-ui/react-progress';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/utils.js';

export function Progress({
  className,
  max,
  value,
  ...props
}: ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>) {
  const safeMax = typeof max === 'number' && Number.isFinite(max) && max > 0 ? max : 100;
  const safeValue =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(Math.max(value, 0), safeMax)
      : null;
  const percent = safeValue === null ? 0 : (safeValue / safeMax) * 100;

  return (
    <ProgressPrimitive.Root
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      max={safeMax}
      value={safeValue}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 bg-primary transition-transform"
        style={{ transform: `translateX(-${100 - percent}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
