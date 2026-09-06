import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const artifactDir = '/tmp/admin-v9';
const url = process.env.TEST_URL;
const username = process.env.SMOKE_USERNAME;
const password = process.env.SMOKE_PASSWORD;
const organizerSecret = process.env.ORGANIZER_TOTP_SECRET;
const campaignId = process.env.PLAN031_CAMPAIGN_ID;
const roomLabel = process.env.PLAN031_BROWSER_ROOM_LABEL;
const workerName = process.env.ADMIN_WORKER_NAME;
const workerVersionId = process.env.WORKER_VERSION_ID;
let currentStage = 'inputs';

async function saveJson(name, payload) {
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(`${artifactDir}/${name}`, `${JSON.stringify(payload)}\n`);
}

function safeErrorMessage(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[A-Z2-7]{24,}/gu, '[redacted]')
    .replace(/[A-Za-z0-9_-]{40,}/gu, '[redacted]')
    .slice(0, 1000);
}

async function markStage(stage) {
  currentStage = stage;
  await saveJson('plan031-browser-progress.json', { ok: true, stage });
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
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
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

async function login(page) {
  await page.goto(`${url}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Benutzername').fill(username);
  await page.getByLabel('Passwort').fill(password);
  await page.getByRole('button', { name: 'Weiter', exact: true }).click();
  await page.getByLabel('6-stelliger Code').waitFor();
  await nextCounter();
  await page.getByLabel('6-stelliger Code').fill(totp(organizerSecret));
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await page.waitForURL('**/admin');
  await page.getByRole('heading', { name: 'Aktionen', exact: true }).waitFor();
}

async function openFieldApp(page) {
  await page.goto(`${url}/?campaign=${encodeURIComponent(campaignId)}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Menü öffnen', exact: true }).waitFor();
}

async function openLauncher(page) {
  await page.getByRole('button', { name: 'Menü öffnen', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Menü' });
  await menu.waitFor();
  for (const label of ['Team', 'Rooms', 'Fortschritt', 'Kommentare', 'Streets', 'Gebiet', 'Einstellungen']) {
    await menu.getByRole('button', { name: label }).waitFor();
  }
  return menu;
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  if (overflow.width > overflow.viewport + 2) throw new Error(`Horizontal overflow: ${overflow.width}/${overflow.viewport}`);
}

async function main() {
  const missing = [
    ['TEST_URL', url], ['SMOKE_USERNAME', username], ['SMOKE_PASSWORD', password],
    ['ORGANIZER_TOTP_SECRET', organizerSecret], ['PLAN031_CAMPAIGN_ID', campaignId],
    ['PLAN031_BROWSER_ROOM_LABEL', roomLabel], ['ADMIN_WORKER_NAME', workerName],
    ['WORKER_VERSION_ID', workerVersionId],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Missing inputs: ${missing.join(',')}`);

  const versionContext = {
    extraHTTPHeaders: {
      'Cloudflare-Workers-Version-Overrides': `${workerName}="${workerVersionId}"`,
    },
  };

  let browser;
  try {
    await markStage('launch');
    browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });

    await markStage('desktop_login');
    const desktop = await browser.newContext({ ...versionContext, viewport: { width: 1440, height: 900 } });
    const page = await desktop.newPage();
    page.setDefaultTimeout(25_000);
    await login(page);
    await openFieldApp(page);
    await assertNoHorizontalOverflow(page);

    await markStage('desktop_launcher');
    let menu = await openLauncher(page);
    const launcherButtons = await menu.locator('.platform-app-item').count();
    if (launcherButtons !== 7) throw new Error(`Expected 7 launcher buttons, got ${launcherButtons}`);

    await markStage('desktop_legacy_navigation');
    const settingsButton = menu.getByRole('button', { name: 'Einstellungen', exact: true });
    await saveJson('desktop-legacy-before.json', await page.evaluate(() => ({
      settingsButtons: [...document.querySelectorAll('button')].filter((node) => node.textContent?.trim() === 'Einstellungen').map((node) => ({
        disabled: node.disabled,
        rect: node.getBoundingClientRect().toJSON(),
        pointerEvents: getComputedStyle(node).pointerEvents,
      })),
      activeElement: document.activeElement?.outerHTML?.slice(0, 300) ?? null,
      overlays: document.querySelectorAll('.field-sheet-overlay').length,
    })));
    await settingsButton.click({ timeout: 10_000 });
    await page.waitForTimeout(250);
    await saveJson('desktop-legacy-debug.json', await page.evaluate(() => ({
      settingsCount: document.querySelectorAll('section.settings-sheet').length,
      bottomSheetCount: document.querySelectorAll('section.bottom-sheet').length,
      visibleSections: [...document.querySelectorAll('section')].map((node) => ({
        className: node.className,
        ariaLabel: node.getAttribute('aria-label'),
        visible: Boolean(node.getClientRects().length),
      })).filter((entry) => entry.visible).slice(-16),
      overlayCount: document.querySelectorAll('.field-sheet-overlay').length,
    })));
    const settingsSheet = page.locator('section.settings-sheet');
    await settingsSheet.waitFor();
    await settingsSheet.getByRole('button', { name: 'Schließen', exact: true }).click();
    menu = await openLauncher(page);
    await menu.getByRole('button', { name: 'Team', exact: true }).click();
    const teamManagementSheet = page.locator('section.bottom-sheet[aria-label="Teams verwalten"]');
    await teamManagementSheet.waitFor();
    await teamManagementSheet.getByRole('button', { name: 'Schließen', exact: true }).click();

    await markStage('desktop_rooms');
    await menu.getByRole('button', { name: 'Rooms' }).click();
    const rooms = page.getByRole('dialog', { name: 'Rooms' });
    await rooms.waitFor();
    await rooms.getByText(roomLabel, { exact: true }).waitFor();
    await rooms.getByText('Nicht gelistet', { exact: true }).waitFor();
    await rooms.getByText(roomLabel, { exact: true }).click();
    await rooms.getByRole('button', { name: 'Join-Zugang anzeigen', exact: true }).waitFor();

    await markStage('desktop_reveal');
    await rooms.getByRole('button', { name: 'Join-Zugang anzeigen', exact: true }).click();
    const accessDialog = page.getByRole('dialog', { name: roomLabel });
    await accessDialog.waitFor();
    const roomCode = (await accessDialog.locator('.team-center-room-code').textContent())?.trim() ?? '';
    const roomLink = await accessDialog.getByLabel('Room-Link').inputValue();
    if (!/^[A-Z0-9]{8,16}$/u.test(roomCode.replace(/-/gu, ''))) throw new Error('Rendered room code format invalid');
    if (!roomLink.includes(`#groupJoin=`) || !roomLink.includes(`campaign=${encodeURIComponent(campaignId)}`)) throw new Error('Rendered room link invalid');
    await accessDialog.getByRole('button', { name: 'Dialog schließen', exact: true }).click();

    await markStage('desktop_sheet_and_hubs');
    const handle = rooms.getByRole('button', { name: 'Fensterhöhe ändern', exact: true });
    await handle.press('End');
    if ((await rooms.getAttribute('data-snap')) !== 'full') throw new Error('Rooms sheet did not reach full snap');
    await rooms.locator('.field-sheet-body').evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await rooms.getByRole('button', { name: 'Room beenden', exact: true }).waitFor();
    await rooms.getByRole('button', { name: 'Rooms schließen', exact: true }).click();

    menu = await openLauncher(page);
    await menu.getByRole('button', { name: 'Kommentare' }).click();
    const comments = page.getByRole('dialog', { name: 'Kommentare' });
    await comments.waitFor();
    await comments.getByRole('button', { name: 'Kommentare schließen', exact: true }).click();
    menu = await openLauncher(page);
    await menu.getByRole('button', { name: 'Streets' }).click();
    const streets = page.getByRole('dialog', { name: 'Streets' });
    await streets.waitFor();
    await streets.getByRole('button', { name: 'Streets schließen', exact: true }).click();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: `${artifactDir}/plan031-desktop-field.png`, fullPage: true });

    const storageState = await desktop.storageState();
    await desktop.close();

    await markStage('mobile_field');
    const mobile = await browser.newContext({ ...versionContext, viewport: { width: 390, height: 844 }, storageState, hasTouch: true, isMobile: true });
    const mobilePage = await mobile.newPage();
    mobilePage.setDefaultTimeout(25_000);
    await openFieldApp(mobilePage);
    await assertNoHorizontalOverflow(mobilePage);
    menu = await openLauncher(mobilePage);
    if ((await menu.getAttribute('data-snap')) !== 'expanded') throw new Error('Mobile launcher did not open expanded');
    await menu.getByRole('button', { name: 'Rooms' }).click();
    const mobileRooms = mobilePage.getByRole('dialog', { name: 'Rooms' });
    await mobileRooms.waitFor();
    if ((await mobileRooms.getAttribute('data-snap')) !== 'expanded') throw new Error('Mobile Rooms did not open expanded');
    const box = await mobileRooms.boundingBox();
    if (!box || box.height < 450 || box.height > 600) throw new Error(`Unexpected mobile expanded height: ${box?.height ?? 'none'}`);
    await mobileRooms.getByText(roomLabel, { exact: true }).click();
    await mobileRooms.locator('.field-sheet-body').evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await mobileRooms.getByRole('button', { name: 'Join-Zugang anzeigen', exact: true }).waitFor();
    const mobileHandle = mobileRooms.getByRole('button', { name: 'Fensterhöhe ändern', exact: true });
    await mobileHandle.press('End');
    if ((await mobileRooms.getAttribute('data-snap')) !== 'full') throw new Error('Mobile Rooms did not reach full snap');
    await assertNoHorizontalOverflow(mobilePage);
    await mobilePage.screenshot({ path: `${artifactDir}/plan031-mobile-rooms.png`, fullPage: true });
    await mobile.close();

    await saveJson('plan031-browser.json', {
      ok: true,
      desktop: { width: 1440, height: 900, launcherItems: 7, reveal: true, focusedHubs: ['Rooms', 'Kommentare', 'Streets'] },
      mobile: { width: 390, height: 844, initialSnap: 'expanded', fullSnap: true, horizontalOverflow: false },
    });
  } catch (error) {
    await saveJson('plan031-browser-failure.json', { ok: false, stage: currentStage, error: safeErrorMessage(error) });
    throw error;
  } finally {
    await browser?.close();
  }
}

await main();
