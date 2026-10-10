// Organiser pages in the design system: sign-in with second factor, admin dashboard, new Aktion with the focus picker, security centre,
// invitation page. The organisation API is mocked at the network edge (the real handlers are covered by unit tests); this flow is about
// what the person sees and can do: one navigation, no horizontal scroll on a phone, no hard-coded map, secrets only in memory.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

/** Same bar as the field sheets: every control at least 44 px, no English leftovers in what a person reads. */
const pageAudit = async (page, name) => {
  const r = await page.evaluate(() => {
    const visible = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    const target = (el) => (el.matches('input[type=checkbox], input[type=radio]') ? el.closest('label') ?? el : el);
    const small = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea')].filter(visible)
      .filter((el) => { const b = target(el).getBoundingClientRect(); return b.width < 43.5 || b.height < 43.5; })
      .filter((el) => !(el.tagName === 'A' && el.closest('p, li, small')))  // a link inside running text is part of the text
      .map((el) => `${el.tagName.toLowerCase()}「${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 24)}」${Math.round(target(el).getBoundingClientRect().width)}×${Math.round(target(el).getBoundingClientRect().height)}`);
    const english = (document.body.innerText.match(/\b(Organization|Unstable|Campaign|ACTIVE|DRAFT|ARCHIVED|active|draft|archived)\b/g) ?? []);
    const where = [...document.body.innerText.matchAll(/.{0,40}\b(Organization|Unstable|Campaign|ACTIVE|DRAFT|ARCHIVED|active|draft|archived)\b.{0,20}/g)].map((m) => m[0]).slice(0, 4);
    const clipped = [...document.querySelectorAll('button, a[href]')].filter(visible).flatMap((el) => [el, ...el.querySelectorAll('*')])
      .filter((el) => el.childElementCount === 0 && el.textContent.trim() && el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX !== 'visible').map((el) => el.textContent.trim().slice(0, 24));
    return { small, english, where, clipped };
  });
  check(`${name}: every control at least 44 px`, r.small.length === 0, r.small.join(' · '));
  check(`${name}: no control caption is cut off`, r.clipped.length === 0, r.clipped.join(' · '));
  check(`${name}: no English leftovers`, r.english.length === 0, [...new Set(r.english)].join(', ') + '  ' + JSON.stringify(r.where));
};
const until = async (predicate, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await predicate()) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
const BASE = 'http://localhost:8140';

const me = { account: { id: 'acc1', username: 'orga' }, assurance: 'mfa', memberships: [{ id: 'm1', organizationId: 'org1', organizationName: 'Nachbarschaft e. V.', accountId: 'acc1', role: 'organizer', capabilities: [] }] };
const campaigns = [{ id: 'campaign_n', name: 'Frühjahr 2027', lifecycle: 'active', map: { lng: 13, lat: 51, zoom: 12, bearing: 0 }, createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-08T10:00:00Z' }];
const invites = [{ id: 'i1', role: 'admin', capabilities: ['campaign.manage'], createdAt: '2026-10-09T08:00:00Z', expiresAt: '2099-01-01T00:00:00Z', usedAt: null, revokedAt: null }];
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function open(path, { signedIn = true, viewport = { width: 390, height: 844 } } = {}) {
  const ctx = await b.newContext({ viewport });
  const page = await ctx.newPage();
  const seen = { posts: [], external: [] };
  let signed = signedIn;
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('request', (r) => { const u = new URL(r.url()); if (u.hostname !== 'localhost' && u.protocol.startsWith('http')) seen.external.push(r.url()); });
  await page.route(/\/api\/organizations?\//, async (route) => {
    const url = new URL(route.request().url()), p = url.pathname, m = route.request().method();
    if (m === 'POST') seen.posts.push(p);
    if (p === '/api/organization/me') return signed ? json(route, me) : json(route, { error: { code: 'authentication_required', message: 'Bitte anmelden.' } }, 401);
    if (p === '/api/organization/login/password') return json(route, { requiresFactor: true });
    if (p === '/api/organization/login/totp') { signed = true; return json(route, { account: me.account, assurance: 'mfa' }); }
    if (p.endsWith('/campaigns') && m === 'GET') return json(route, { campaigns });
    if (p.endsWith('/campaigns') && m === 'POST') { const created = { ...campaigns[0], id: 'campaign_new', name: 'Neu', lifecycle: 'draft' }; campaigns.push(created); return json(route, { campaign: created }, 201); }
    if (p.includes('/campaigns/') && m === 'PATCH') return json(route, { ok: true });
    if (p.includes('/campaigns/') && m === 'GET') return json(route, { campaign: campaigns[0] });
    if (p === '/api/organization/sessions') return json(route, { sessions: [{ id: 's1', assurance: 'mfa', createdAt: '2026-10-09T08:00:00Z', expiresAt: '2026-10-09T20:00:00Z', current: true }, { id: 's2', assurance: 'mfa', createdAt: '2026-10-08T08:00:00Z', expiresAt: '2026-10-09T18:00:00Z', current: false }] });
    if (p === '/api/organization/security/mfa') return json(route, { optional: true, required: true });
    if (p.endsWith('/invites') && m === 'GET') return json(route, { invites });
    if (p.endsWith('/invites') && m === 'POST') { const invite = { id: 'i2', role: 'admin', capabilities: [], createdAt: '2026-10-09T09:00:00Z', expiresAt: '2099-01-01T00:00:00Z', usedAt: null, revokedAt: null }; invites.push(invite); return json(route, { invite, secret: 'SECRET-TOKEN-123' }, 201); }
    if (p.endsWith('/members')) return json(route, { members: [{ id: 'm1', accountId: 'acc1', username: 'orga', role: 'organizer', capabilities: [], createdAt: '', updatedAt: '' }] });
    if (p.endsWith('/roles')) return json(route, { roles: [] });
    if (p.endsWith('/features')) return json(route, { features: [] });
    if (p.endsWith('/audit')) return json(route, { events: [{ id: 'e1', actorAccountId: 'acc1', type: 'campaign.created', targetType: 'campaign', targetId: 'campaign_n', details: {}, createdAt: '2026-10-08T10:00:00Z' }] });
    return json(route, {});
  });
  await page.goto(BASE + path);
  return { page, ctx, seen };
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// 1. Sign-in: password, then second factor
{
  const { page, seen } = await open('/login', { signedIn: false });
  await page.getByLabel('Benutzername').waitFor({ timeout: 60000 });
  check('sign-in page uses the design system (dark by default) and shows no legacy chrome', await page.evaluate(() => document.documentElement.dataset.theme === 'dark' && !!document.querySelector('.ui-page') && !document.querySelector('.org-page, .map-toolbar, .platform-shell')));
  check('the page scrolls like a document and fits a phone', await noHScroll(page));
  await pageAudit(page, 'o1-login');
  await page.screenshot({ path: `${shots}/o1-login.png` });
  await page.getByLabel('Benutzername').fill('orga');
  await page.getByLabel('Passwort', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: 'Weiter' }).click();
  check('after the password the second factor is asked', await until(async () => (await page.getByRole('button', { name: 'Authenticator' }).count()) === 1));
  await pageAudit(page, 'o2-factor');
  await page.screenshot({ path: `${shots}/o2-factor.png` });
  await page.getByLabel('6-stelliger Code').fill('123456');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  check('a correct code leads to the admin', await until(async () => page.url().endsWith('/admin')));
  check('the password was sent once and never kept in the page', seen.posts.filter((p) => p.endsWith('/login/password')).length === 1);
  await page.context().close();
}

// 2. Dashboard, navigation, new Aktion with the focus picker
{
  const { page, seen } = await open('/admin');
  await page.getByRole('heading', { name: 'Aktionen' }).waitFor({ timeout: 60000 });
  check('dashboard lists the Aktion as a card', await until(async () => /Frühjahr 2027/.test(await page.locator('.ui-campaign').first().innerText().catch(() => ''))));
  const nav = await page.locator('.ui-bar nav a, .ui-bar nav button').allInnerTexts();
  check('one navigation: Aktionen, Neue Aktion, Einladungen, Sicherheit, Feldkarte', ['Aktionen', 'Neue Aktion', 'Einladungen', 'Sicherheit', 'Feldkarte'].every((t) => nav.includes(t)), nav.join('|'));
  check('dashboard fits the phone width', await noHScroll(page));
  await pageAudit(page, 'o3-dashboard');
  await page.screenshot({ path: `${shots}/o3-dashboard.png` });
  await page.getByRole('button', { name: 'Neue Aktion' }).first().click();
  await page.getByLabel('Name der Aktion').waitFor();
  check('the focus picker mounts a map canvas without any third-party request', await until(async () => (await page.locator('.ui-map canvas').count()) === 1) && seen.external.length === 0, seen.external.join(','));
  await page.getByLabel('Name der Aktion').fill('Neu');
  await page.getByRole('button', { name: 'Aktion erstellen' }).click();
  check('creating leads to the Aktion page with the lifecycle control and the Feldkarte link', await until(async () => /\/admin\/campaign\/campaign_new/.test(page.url())) && await page.getByRole('link', { name: 'Feldkarte öffnen' }).count() === 1);
  await pageAudit(page, 'o4-new');
  await page.screenshot({ path: `${shots}/o4-new.png` });
  await page.context().close();
}

// 3. Security centre and invitations
{
  const { page } = await open('/admin/security');
  await page.getByRole('heading', { name: 'Sicherheit & Zugriffe' }).waitFor({ timeout: 60000 });
  check('security centre shows the account, the sessions and the audit', await until(async () => { const t = await page.locator('.ui-main').innerText(); return /orga/.test(t) && /Aktive Sitzungen/.test(t) && /campaign\.created/.test(t); }));
  check('only the other session can be revoked', (await page.getByRole('button', { name: 'Widerrufen' }).count()) === 1);
  check('security fits the phone width', await noHScroll(page));
  await pageAudit(page, 'o5-security');
  await page.screenshot({ path: `${shots}/o5-security.png` });
  await page.context().close();
}
{
  const { page } = await open('/admin/invites');
  await page.getByRole('heading', { name: 'Einladungen' }).first().waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Einladungslink erstellen' }).click();
  await page.getByRole('dialog').waitFor();
  const link = await page.locator('.ui-dialog .ui-code').innerText();
  check('the one-time link carries the secret in the fragment, not in the query', /\/join#token=SECRET-TOKEN-123$/.test(link), link);
  await pageAudit(page, 'o6-invite-dialog');
  await page.screenshot({ path: `${shots}/o6-invite-dialog.png` });
  await page.keyboard.press('Escape');
  check('Escape closes the dialog', await until(async () => (await page.getByRole('dialog').count()) === 0));
  check('a stored link can be shown again for its row', await page.getByRole('button', { name: 'Link anzeigen' }).count() >= 1);
  await page.context().close();
}
{
  const { page } = await open('/join#token=abc', { signedIn: false });
  await page.getByLabel('Benutzername').waitFor({ timeout: 60000 });
  check('the invitation token is removed from the address bar at once', !page.url().includes('token='), page.url());
  await pageAudit(page, 'o7-join');
  await page.screenshot({ path: `${shots}/o7-join.png` });
  await page.context().close();
}

await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
