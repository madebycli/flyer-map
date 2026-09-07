const RXDB_REQUEST_TIMEOUT_MS = 15_000;
let installed = false;

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export async function fetchWithRxdbDeadline(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = RXDB_REQUEST_TIMEOUT_MS,
) {
  const url = requestUrl(input);
  if (!url.includes("/rxdb/")) return fetchImpl(input, init);

  const controller = new AbortController();
  const upstreamSignal = init?.signal;
  const relayAbort = () => controller.abort();
  if (upstreamSignal?.aborted) controller.abort();
  else upstreamSignal?.addEventListener("abort", relayAbort, { once: true });

  const timer = globalThis.setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", relayAbort);
  }
}

export function installRxdbFetchGuard() {
  if (installed || typeof globalThis.fetch !== "function") return;
  installed = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    fetchWithRxdbDeadline(originalFetch, input, init)) as typeof fetch;
}
