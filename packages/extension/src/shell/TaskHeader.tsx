import type { ReactNode } from 'react';

interface TaskHeaderProps {
  readonly title: string;
  readonly description: string;
  readonly eyebrow?: string;
  readonly trailing?: ReactNode;
}

export function TaskHeader({ description, eyebrow, title, trailing }: TaskHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-[12.5px] font-medium leading-4 text-primary">{eyebrow}</p>
        ) : null}
        <h1 className="text-xl font-semibold leading-7 text-foreground">{title}</h1>
        <p className="mt-1.5 max-w-[42rem] text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </header>
  );
}
