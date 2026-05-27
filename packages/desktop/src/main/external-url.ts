export function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function assertAllowedExternalUrl(url: string): void {
  if (!isAllowedExternalUrl(url)) {
    throw new Error('只能打开 http 或 https 链接');
  }
}
