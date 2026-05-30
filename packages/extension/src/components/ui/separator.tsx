import * as SeparatorPrimitive from '@radix-ui/react-separator';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/utils.js';

export function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      className={cn(
        'shrink-0',
        orientation === 'horizontal'
          ? 'h-px w-full bg-gradient-to-r from-transparent via-border to-transparent'
          : 'h-full w-px bg-gradient-to-b from-transparent via-border to-transparent',
        className,
      )}
      orientation={orientation}
      {...props}
    />
  );
}
