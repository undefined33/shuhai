export interface SchedulableUrl {
  id: string;
  url: string;
}

export class DomainScheduler {
  private readonly nextRequestAt = new Map<string, number>();

  constructor(private readonly rateLimitMs: number) {}

  getDelay(domain: string): number {
    const nextAllowedAt = this.nextRequestAt.get(domain) ?? 0;
    return Math.max(0, nextAllowedAt - Date.now());
  }

  recordRequest(domain: string): void {
    const now = Date.now();
    const nextAllowedAt = this.nextRequestAt.get(domain) ?? now;
    this.nextRequestAt.set(domain, Math.max(now, nextAllowedAt) + this.rateLimitMs);
  }

  static interleaveByDomain(urls: SchedulableUrl[]): SchedulableUrl[] {
    const groups = new Map<string, SchedulableUrl[]>();

    for (const item of urls) {
      const domain = getDomain(item.url);
      const group = groups.get(domain) ?? [];
      group.push(item);
      groups.set(domain, group);
    }

    const result: SchedulableUrl[] = [];
    while (groups.size > 0) {
      for (const [domain, group] of groups) {
        const next = group.shift();
        if (next) {
          result.push(next);
        }

        if (group.length === 0) {
          groups.delete(domain);
        }
      }
    }

    return result;
  }
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
}
