/** Small helpers of the installed app's start page (kept free of React so they can be tested). */
const LAST_KEY = 'vf-last-campaign';
export const rememberCampaign = (id: string) => { try { localStorage.setItem(LAST_KEY, id); } catch { /* private mode */ } };
export const lastCampaign = (): string | null => { try { return localStorage.getItem(LAST_KEY); } catch { return null; } };

/**
 * Where an invitation link points inside this app, or null when it is not one of ours.
 * Accepts the whole link (with its address) or just its path; the secret part after # is kept: opening the result redeems it like the original.
 */
export function pastedLinkTarget(text: string, origin: string): string | null {
  const raw = text.trim();
  if (!raw || raw.length > 2000 || /\s/.test(raw)) return null;
  let url: URL;
  try { url = new URL(raw, origin); } catch { return null; }
  if (url.origin !== origin) return null;
  const campaign = url.searchParams.get('campaign');
  const room = url.searchParams.has('room');
  if (!campaign && !room) return null;
  if (url.pathname !== '/v5' && url.pathname !== '/') return null;
  return `/v5${url.search}${url.hash}`;
}
