interface BrandProps {
  readonly subtitle?: string;
}

export function Brand({ subtitle }: BrandProps) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span aria-hidden="true" className="shuhai-logomark shrink-0">
        书
      </span>
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold leading-5 text-foreground">ShuHai</p>
        {subtitle ? (
          <p className="truncate text-[12.5px] leading-4 text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}
