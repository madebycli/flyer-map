import type { PreparationQuality } from '../../src/domain/preparationDiagnostics.ts';

export type SourceAttempt = {
  endpoint: string;
  providerAttempt: number;
  kind: 'roads' | 'buildings';
  status: number | null;
  contentType: string | null;
  contentLength: number | null;
  retryAfterSeconds: number | null;
  responseType: 'unavailable' | 'http_error' | 'empty' | 'html' | 'invalid_json' | 'json';
  remark: 'timeout' | 'memory' | 'other' | null;
  bytes: number;
  elapsedMs: number;
  aborted: boolean;
  code: string | null;
};

/** Persist only allowlisted metadata, never raw response/query/header/error text. */
export class SourceFailure extends Error {
  constructor(code: string, readonly attempts: SourceAttempt[], readonly quality?: PreparationQuality) {
    super(code);
  }
}

export function safeSourceEndpoint(url: string) {
  const parsed = new URL(url);
  // Custom paths and query strings can contain credentials. Only the two fixed
  // public provider routes are useful and safe to preserve verbatim.
  if (parsed.origin === 'https://overpass.private.coffee' && parsed.pathname === '/api/interpreter') return parsed.origin + parsed.pathname;
  if (parsed.origin === 'https://maps.mail.ru' && parsed.pathname === '/osm/tools/overpass/api/interpreter') return parsed.origin + parsed.pathname;
  return 'configured-upstream';
}

export function numericHeader(value: string | null): number | null {
  if (!value || !/^\d{1,10}$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

export function safeContentType(value: string | null): string | null {
  const mime = value?.split(';',1)[0].trim().toLowerCase();
  return mime && ['application/json','text/json','text/html','text/plain','application/octet-stream'].includes(mime) ? mime : null;
}
