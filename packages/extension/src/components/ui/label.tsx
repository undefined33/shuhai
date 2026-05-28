import * as LabelPrimitive from '@radix-ui/react-label';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/utils.js';

export function Label({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn('text-xs font-medium text-foreground', className)}
      {...props}
    />
  );
}
