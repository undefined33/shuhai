export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' https://api.deepseek.com",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

type ResponseHeaders = Record<string, string | string[]>;

export function withContentSecurityPolicy(headers: ResponseHeaders = {}): ResponseHeaders {
  return {
    ...headers,
    'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
  };
}
