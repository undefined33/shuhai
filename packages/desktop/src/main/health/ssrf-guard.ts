import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type DnsLookup = (hostname: string) => Promise<string[]>;

const LOCAL_HOSTNAMES = new Set(['localhost', 'localhost.localdomain']);

export function isSafeUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname || LOCAL_HOSTNAMES.has(hostname)) {
    return false;
  }

  if (isIP(hostname) !== 0 && isPrivateIp(hostname)) {
    return false;
  }

  return true;
}

export function isPrivateIp(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  const ipv4FromMapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (ipv4FromMapped) {
    return isPrivateIp(ipv4FromMapped);
  }

  if (isIP(normalized) === 4) {
    const [first = 0, second = 0] = normalized.split('.').map(Number);
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  if (isIP(normalized) === 6) {
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    );
  }

  return false;
}

export async function resolveSafeUrl(
  url: string,
  dnsLookup: DnsLookup = defaultDnsLookup,
): Promise<boolean> {
  if (!isSafeUrl(url)) {
    return false;
  }

  const hostname = normalizeHostname(new URL(url).hostname);
  if (isIP(hostname) !== 0) {
    return true;
  }

  const addresses = await dnsLookup(hostname);
  return addresses.length > 0 && addresses.every((address) => !isPrivateIp(address));
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
}

async function defaultDnsLookup(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((result) => result.address);
}
