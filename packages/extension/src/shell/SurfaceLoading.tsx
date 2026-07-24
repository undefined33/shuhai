interface SurfaceLoadingProps {
  readonly label?: string;
}

export function SurfaceLoading({ label = '正在准备任务' }: SurfaceLoadingProps) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-56 flex-col justify-center gap-4"
      role="status"
    >
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div aria-hidden="true" className="space-y-3">
        <span className="block h-3 w-2/3 animate-pulse rounded-sm bg-muted" />
        <span className="block h-3 w-full animate-pulse rounded-sm bg-muted" />
        <span className="block h-10 w-full animate-pulse rounded-md bg-muted" />
      </div>
    </div>
  );
}
