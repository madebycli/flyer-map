import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.TEST_URL;
const username = process.env.SMOKE_USERNAME;
const password = process.env.SMOKE_PASSWORD;
const invitePassword = process.env.INVITE_PASSWORD;
const organizerSecret = process.env.ORGANIZER_TOTP_SECRET;
const organizationId = process.env.ORGANIZATION_ID;
const runId = process.env.GITHUB_RUN_ID;
if (!url || !username || !password || !invitePassword || !organizerSecret || !organizationId || !runId) {
  throw new Error('Browser gate inputs missing');
}

function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of value.replace(/=+$/u, '').toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Invalid base32 secret');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

async function nextCounter() {
  const waitMs = 30_000 - (Date.now() % 30_000) + 1_500;
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

async function login(page, accountUsername = username, accountPassword = password, secret = organizerSecret) {
  await page.goto(`${url}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Benutzername').fill(accountUsername);
  await page.getByLabel('Passwort').fill(accountPassword);
  await page.getByRole('button', { name: 'Weiter', exact: true }).click();
  await page.getByLabel('6-stelliger Code').waitFor();
  await nextCounter();
  await page.getByLabel('6-stelliger Code').fill(totp(secret));
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await page.waitForURL('**/admin');
  await page.getByRole('heading', { name: 'Aktionen', exact: true }).waitFor();
}

async function createCampaign(page, name) {
  await page.getByRole('button', { name: /Neue Aktion/u }).click();
  await page.waitForURL('**/new*');
  await page.getByLabel('Name der Aktion').fill(name);
  await page.getByRole('button', { name: 'Aktion erstellen', exact: true }).click();
  await page.waitForURL('**/admin/campaign/**');
  await page.getByRole('heading', { name, exact: true }).waitFor();
  await page.getByRole('button', { name: 'Aktionen', exact: true }).first().click();
  await page.waitForURL('**/admin');
}

const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
try {
  let context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  let page = await context.newPage();
  page.setDefaultTimeout(25_000);

  await login(page);
  const campaignA = `Browser Aktion A ${runId}`;
  const campaignB = `Browser Aktion B ${runId}`;
  await createCampaign(page, campaignA);
  await createCampaign(page, campaignB);

  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await page.waitForURL('**/login');
  await context.clearCookies();
  await context.close();

  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(25_000);
  await login(page);
  await page.getByText(campaignA, { exact: true }).waitFor();
  await page.getByText(campaignB, { exact: true }).waitFor();
  await page.screenshot({ path: '/tmp/admin-v9/desktop-persisted-campaigns.png', fullPage: true });

  const invite = await page.evaluate(async ({ organizationId }) => {
    const response = await fetch(`/api/organizations/${encodeURIComponent(organizationId)}/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'admin',
        capabilities: ['campaign.manage', 'audit.read'],
        expiresInHours: 1,
      }),
    });
    const payload = await response.json();
    if (response.status !== 201 || typeof payload?.secret !== 'string') {
      throw new Error(`Invite create failed: ${response.status}`);
    }
    return payload;
  }, { organizationId });

  await context.close();
  const inviteContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const invitePage = await inviteContext.newPage();
  invitePage.setDefaultTimeout(25_000);
  const invitedUsername = `invited.admin.${runId}`;
  await invitePage.goto(`${url}/join#token=${encodeURIComponent(invite.secret)}`, { waitUntil: 'domcontentloaded' });
  if (invitePage.url().includes('#token=')) throw new Error('Invite token remained in browser URL');
  await invitePage.getByLabel('Benutzername').fill(invitedUsername);
  await invitePage.getByLabel('Passwort', { exact: true }).fill(invitePassword);
  await invitePage.getByLabel('Passwort wiederholen').fill(invitePassword);
  await invitePage.getByRole('button', { name: 'Account anlegen', exact: true }).click();
  await invitePage.getByRole('heading', { name: 'MFA jetzt einrichten', exact: true }).waitFor();
  const inviteOtpUri = await invitePage.locator('code.org-break-code').textContent();
  const inviteSecret = inviteOtpUri ? new URL(inviteOtpUri).searchParams.get('secret') : null;
  if (!inviteSecret) throw new Error('Invited account TOTP secret missing');
  await invitePage.getByLabel('6-stelliger Code').fill(totp(inviteSecret));
  await invitePage.getByRole('button', { name: 'MFA bestätigen & Admin öffnen', exact: true }).click();
  await invitePage.waitForURL('**/admin');
  await invitePage.getByRole('heading', { name: 'Aktionen', exact: true }).waitFor();
  const inviteMe = await invitePage.evaluate(async () => {
    const response = await fetch('/api/organization/me');
    return { status: response.status, body: await response.json() };
  });
  if (inviteMe.status !== 200 || inviteMe.body?.account?.username !== invitedUsername || inviteMe.body?.memberships?.[0]?.role !== 'admin') {
    throw new Error('Clean-browser invite enrollment contract failed');
  }
  await invitePage.screenshot({ path: '/tmp/admin-v9/invite-clean-browser.png', fullPage: true });
  await inviteContext.close();

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await mobileContext.newPage();
  mobile.setDefaultTimeout(25_000);
  await login(mobile);
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 2) throw new Error(`Mobile horizontal overflow: ${overflow}`);
  await mobile.screenshot({ path: '/tmp/admin-v9/mobile-admin.png', fullPage: true });
  await mobileContext.close();

  await fs.writeFile('/tmp/admin-v9/browser-status.json', JSON.stringify({
    ok: true,
    desktopChromium: true,
    campaignA: true,
    campaignB: true,
    logout: true,
    storageAndCookiesCleared: true,
    freshBrowserContextRelogin: true,
    serverPersistence: true,
    inviteCleanBrowser: true,
    invitedAdminMfa: true,
    mobileChromium: true,
    mobileOverflow: false,
  }) + '\n');
} finally {
  await browser.close();
}
