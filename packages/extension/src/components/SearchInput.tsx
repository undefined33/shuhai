import { useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../lib/utils.js';
import { Button } from './ui/button.js';
import { Input } from './ui/input.js';

interface SearchInputProps {
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  className?: string;
}

function isVisible(element: HTMLElement): boolean {
  return !element.closest('[hidden]') && element.offsetParent !== null;
}

export function SearchInput({
  value,
  onChange,
  placeholder = '搜索',
  className,
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') {
        return;
      }

      const input = inputRef.current;
      if (!input || !isVisible(input)) {
        return;
      }

      event.preventDefault();
      input.focus();
      input.select();
    };

    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="h-9 pl-8 pr-8 text-sm"
        data-shuhai-search
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        ref={inputRef}
        value={value}
      />
      {value ? (
        <Button
          aria-label="清除搜索"
          className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
          onClick={() => onChange('')}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </div>
  );
}
