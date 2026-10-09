/**
 * Access links keep working: the same links people already hold (`/?campaign=…#access=…` for a Gruppe or a viewer,
 * `/?campaign=…&collection=1#collection=…` for an Abhol-Helfer) open the field map. The token travels in the URL fragment,
 * is exchanged for a session cookie once, and is removed from the address bar.
 */
export type LinkIntent = { kind: 'access' | 'collection'; token: string };
export type Redeemed = 'ok' | 'invalid' | 'offline';

const LENGTH = { access: [32, 256], collection: [64, 256] } as const;

/** The token in a URL fragment, if it has a plausible shape (the server decides whether it is valid). */
export function linkIntent(hash: string): LinkIntent | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  for (const kind of ['access', 'collection'] as const) {
    const token = params.get(kind);
    if (token && token.length >= LENGTH[kind][0] && token.length <= LENGTH[kind][1]) return { kind, token };
  }
  return null;
}

export async function redeemLink(campaignId: string, intent: LinkIntent, fetchImpl: typeof fetch = fetch): Promise<Redeemed> {
  const path = intent.kind === 'collection' ? '/api/collection/access/redeem' : '/api/access/redeem';
  let response: Response;
  try {
    response = await fetchImpl(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ campaignId, token: intent.token }) });
  } catch {
    return 'offline';
  }
  if (response.ok) return 'ok';
  return response.status >= 500 || response.status === 429 ? 'offline' : 'invalid';
}

/** Where a link to the old map address goes: `/?campaign=X[&collection=1]#…` → `/v5?campaign=X[&kind=collection]#…`. */
export function toFieldMap(url: URL): string | null {
  if (url.pathname !== '/') return null;
  const campaign = url.searchParams.get('campaign');
  if (!campaign || !/^[A-Za-z0-9._:-]{1,160}$/.test(campaign)) return null;
  const next = new URLSearchParams({ campaign });
  if (url.searchParams.get('collection') === '1' || linkIntent(url.hash)?.kind === 'collection') next.set('kind', 'collection');
  return `/v5?${next.toString()}${url.hash}`;
}

/** The address a person sends to a helper: the field map with the token in the fragment. */
export function linkFor(origin: string, campaignId: string, intent: LinkIntent): string {
  const next = new URLSearchParams({ campaign: campaignId });
  if (intent.kind === 'collection') next.set('kind', 'collection');
  return `${origin}/v5?${next.toString()}#${new URLSearchParams({ [intent.kind]: intent.token }).toString()}`;
}
