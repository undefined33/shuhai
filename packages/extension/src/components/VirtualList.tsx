import type { KeyboardEvent, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/utils.js';

export interface VirtualRange {
  endIndex: number;
  offsetY: number;
  startIndex: number;
  totalHeight: number;
}

export interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  renderItem: (item: T, index: number) => ReactNode;
  ariaLabel?: string;
  className?: string;
  containerHeight?: number;
  emptyState?: ReactNode;
  estimatedHeight?: number;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  overscan?: number;
}

export function getVirtualRange(
  itemCount: number,
  itemHeight: number,
  viewportHeight: number,
  scrollTop: number,
  overscan = 5,
): VirtualRange {
  const safeItemHeight = Math.max(1, itemHeight);
  const safeViewportHeight = Math.max(0, viewportHeight);
  const safeScrollTop = Math.max(0, scrollTop);
  const startIndex = Math.max(0, Math.floor(safeScrollTop / safeItemHeight) - overscan);
  const endIndex = Math.min(
    itemCount,
    Math.ceil((safeScrollTop + safeViewportHeight) / safeItemHeight) + overscan,
  );

  return {
    endIndex,
    offsetY: startIndex * safeItemHeight,
    startIndex,
    totalHeight: itemCount * safeItemHeight,
  };
}

export function VirtualList<T>({
  ariaLabel,
  className,
  containerHeight,
  emptyState,
  estimatedHeight = 360,
  itemHeight,
  items,
  onKeyDown,
  overscan = 5,
  renderItem,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [measuredHeight, setMeasuredHeight] = useState(containerHeight ?? estimatedHeight);
  const viewportHeight = containerHeight ?? measuredHeight;

  useEffect(() => {
    if (containerHeight || !containerRef.current) {
      return undefined;
    }

    const element = containerRef.current;
    const updateHeight = () => setMeasuredHeight(element.clientHeight || estimatedHeight);
    updateHeight();

    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [containerHeight, estimatedHeight]);

  const range = useMemo(
    () => getVirtualRange(items.length, itemHeight, viewportHeight, scrollTop, overscan),
    [itemHeight, items.length, overscan, scrollTop, viewportHeight],
  );
  const visibleItems = items.slice(range.startIndex, range.endIndex);

  if (items.length === 0 && emptyState) {
    return (
      <div className={cn('min-h-0 overflow-auto', className)} role="region">
        {emptyState}
      </div>
    );
  }

  return (
    <div
      aria-label={ariaLabel}
      className={cn('min-h-0 overflow-auto', className)}
      onKeyDown={onKeyDown}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      ref={containerRef}
      role="region"
      style={containerHeight ? { height: containerHeight } : undefined}
      tabIndex={onKeyDown ? 0 : undefined}
    >
      <div className="relative w-full" style={{ height: range.totalHeight }}>
        {visibleItems.map((item, visibleIndex) => {
          const index = range.startIndex + visibleIndex;
          return (
            <div
              className="animate-list-item absolute left-0 right-0 px-0.5"
              key={index}
              style={{
                animationDelay: `${Math.min(visibleIndex, 8) * 12}ms`,
                height: itemHeight,
                top: index * itemHeight,
              }}
            >
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
