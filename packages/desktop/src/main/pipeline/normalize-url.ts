import { createHash } from 'node:crypto';

/** Tracking parameters to strip from URLs */
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_cid', 'fbclid', 'gclid', 'gclsrc', 'dclid',
  'msclkid', 'twclid', 'igshid', 'mc_cid', 'mc_eid',
  'ref', 'ref_src', 'ref_url', 'source', 'spm',
]);

/**
 * Normalize a URL for deduplication:
 * - Upgrade http to https
 * - Remove www. prefix
 * - Remove trailing slash
 * - Strip tracking parameters
 * - Sort remaining query params
 * - Remove fragment
 */
export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }

  // Upgrade to https
  if (url.protocol === 'http:') {
    url.protocol = 'https:';
  }

  // Remove www prefix
  if (url.hostname.startsWith('www.')) {
    url.hostname = url.hostname.slice(4);
  }

  // Strip tracking params
  const params = new URLSearchParams();
  url.searchParams.forEach((value, key) => {
    if (!TRACKING_PARAMS.has(key.toLowerCase())) {
      params.set(key, value);
    }
  });

  // Sort remaining params
  params.sort();
  url.search = params.toString() ? `?${params.toString()}` : '';

  // Remove fragment
  url.hash = '';

  // Remove trailing slash (but keep root /)
  let result = url.toString();
  if (result.endsWith('/') && url.pathname !== '/') {
    result = result.slice(0, -1);
  }

  return result;
}

/**
 * Generate a short hash from a normalized URL for filename uniqueness.
 */
export function urlHash(url: string): string {
  return createHash('sha256').update(normalizeUrl(url)).digest('hex').slice(0, 6);
}
