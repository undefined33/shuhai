export function formatAppLoadError(reason: unknown): string {
  const detail = reason instanceof Error ? reason.message : String(reason);
  return `应用配置加载失败：${detail || '未知错误'}。请点击重试；如果仍然失败，请重新打开应用。`;
}
