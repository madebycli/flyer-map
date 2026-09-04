import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const artifactDir = '/tmp/admin-v9';
const url = process.env.TEST_URL;
const username = process.env.SMOKE_USERNAME;
const password = process.env.SMOKE_PASSWORD;
const invitePassword = process.env.INVITE_PASSWORD;
const organizerSecret = process.env.ORGANIZER_TOTP_SECRET;
const organizationId = process.env.ORGANIZATION_ID;
const runId = process.env.GITHUB_RUN_ID;
const workerName = process.env.ADMIN_WORKER_NAME;
const workerVersionId = process.env.WORKER_VERSION_ID;
let currentStage = 'inputs';

async function saveJson(name, payload) {
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(`${artifactDir}/${name}`, `${JSON.stringify(payload)}\n`);
}

function safeErrorMessage(error) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/(#token=)[^\s"'<>]+/giu, '$1[redacted]')
    .replace(/(token=)[^\s"'&<>]+/giu, '$1[redacted]')
    .replace(/[A-Z2-7]{32,}/gu, '[redacted]')
    .replace(/[A-Za-z0-9_-]{48,}/gu, '[redacted]')
    .slice(0, 1000);
}

async function markStage(stage) {
  currentStage = stage;
  await saveJson('browser-progress.json', { ok: true, stage });
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

async function main() {
  const missing = [
    ['TEST_URL', url],
    ['SMOKE_USERNAME', username],
    ['SMOKE_PASSWORD', password],
    ['INVITE_PASSWORD', invitePassword],
    ['ORGANIZER_TOTP_SECRET', organizerSecret],
    ['ORGANIZATION_ID', organizationId],
    ['GITHUB_RUN_ID', runId],
    ['ADMIN_WORKER_NAME', workerName],
    ['WORKER_VERSION_ID', workerVersionId],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    await saveJson('browser-failure.json', { ok: false, stage: currentStage, error: `Missing inputs: ${missing.join(',')}` });
    throw new Error('Browser gate inputs missing');
  }

  const versionContext = {
    extraHTTPHeaders: {
      'Cloudflare-Workers-Version-Overrides': `${workerName}="${workerVersionId}"`,
    },
  };

  let browser;
  try {
    await markStage('launch');
    browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });

    await markStage('organizer_login');
    let context = await browser.newContext({ ...versionContext, viewport: { width: 1440, height: 1000 } });
    let page = await context.newPage();
    page.setDefaultTimeout(25_000);
    await login(page);

    await markStage('campaign_create');
    const campaignA = `Browser Aktion A ${runId}`;
    const campaignB = `Browser Aktion B ${runId}`;
    await createCampaign(page, campaignA);
    await createCampaign(page, campaignB);

    await markStage('logout');
    await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
    await page.waitForURL('**/login');
    await context.clearCookies();
    await context.close();

    await markStage('fresh_context_persistence');
    context = await browser.newContext({ ...versionContext, viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    page.setDefaultTimeout(25_000);
    await login(page);
    await page.getByText(campaignA, { exact: true }).waitFor();
    await page.getByText(campaignB, { exact: true }).waitFor();
    await page.screenshot({ path: `${artifactDir}/desktop-persisted-campaigns.png`, fullPage: true });

    await markStage('invite_create');
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
    await markStage('invite_enrollment');
    const inviteContext = await browser.newContext({ ...versionContext, viewport: { width: 1280, height: 900 } });
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
    await invitePage.screenshot({ path: `${artifactDir}/invite-clean-browser.png`, fullPage: true });
    await inviteContext.close();

    await markStage('mobile');
    const mobileContext = await browser.newContext({
      ...versionContext,
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
    await mobile.screenshot({ path: `${artifactDir}/mobile-admin.png`, fullPage: true });
    await mobileContext.close();

    await markStage('complete');
    await saveJson('browser-status.json', {
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
      pinnedWorkerVersion: true,
    });
  } catch (error) {
    await saveJson('browser-failure.json', {
      ok: false,
      stage: currentStage,
      error: safeErrorMessage(error),
    });
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

await main();
