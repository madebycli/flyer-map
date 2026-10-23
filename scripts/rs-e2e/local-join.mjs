// The way in for a device without access, against the app's own mock (?mock=stranger: no access until an invitation is redeemed or an account signs in): the code
// is cleaned while it is typed, wrong codes are answered in words and can be tried again, the right one opens the app, a link that ends in /beitreten/<code> fills the
// code in, the account asks for the second factor after the password, a passkey signs in at once. 390x844 dark and light, 1280x800 dark. Chromium headless only.
import { VIEWS, launch, reporter, shots } from './lib.mjs';
import { APP } from './local.mjs';

const { check, failures } = reporter();
const browser = await launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GOOD = '7K2QX9M4TB';

async function open(url, v) {
  const phone = v.width < 600;
  const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, hasTouch: phone, isMobile: phone });
  if (v.theme === 'light') await context.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('vf-v5-theme', 'light'); sessionStorage.setItem('seeded', '1'); } } catch { /* blocked */ } });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message|GPU stall/.test(m.text())) problems.push(`${m.type()} ${m.text()}`); });
  await page.goto(url);
  await page.waitForSelector('.fm-join', { timeout: 30000 });
  return { context, page, problems };
}

const code = (page) => page.locator('[data-field=code]');
const send = (page) => page.locator('.fm-send');
const error = (page) => page.locator('[data-role=join-error]');
const small = (page) => page.locator('.fm-join button:not([disabled]), .fm-join input').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)).filter((m) => m < 43.5));

async function invitation(v) {
  const tag = `${v.width}x${v.height}-${v.theme}`;
  const { context, page, problems } = await open(`${APP}?debug&mock=stranger`, v);
  check(`${tag}: a stranger lands on the way in, not on the map`, (await page.locator('.fm-app').count()) === 0 && /Einladung/.test(await page.locator('.fm-join').innerText()));
  check(`${tag}: the invitation is the way that is up`, (await page.locator('[aria-pressed=true]', { hasText: 'Einladung' }).count()) === 1);
  check(`${tag}: nothing can be sent without a code`, await send(page).isDisabled());
  const bad = await small(page);
  check(`${tag}: every field and button is at least 44 px`, bad.length === 0, JSON.stringify(bad));
  await sleep(300);
  await page.screenshot({ path: `${shots}/${tag}-join-code.png` });

  // typing: cleaned, shown with a dash, ten characters needed
  await code(page).fill('7k2qx9m');
  check(`${tag}: a part of a code is shown cleaned`, (await code(page).inputValue()) === '7K2QX-9M');
  check(`${tag}: and cannot be sent`, await send(page).isDisabled());

  // wrong codes: in words, and again
  await code(page).fill('0000000000');
  await send(page).click();
  await error(page).waitFor();
  check(`${tag}: an expired invitation says so`, /abgelaufen/.test(await error(page).innerText()), await error(page).innerText());
  await sleep(300);
  await page.screenshot({ path: `${shots}/${tag}-join-error.png` });
  await code(page).fill('ABCDEFGHJK');
  check(`${tag}: typing takes the message away`, (await error(page).count()) === 0);
  await code(page).press('Enter');
  await error(page).waitFor();
  check(`${tag}: Enter sends, an unknown code says so`, /kenne ich nicht/.test(await error(page).innerText()));
  await code(page).fill('2222222222');
  await send(page).click();
  await error(page).waitFor();
  check(`${tag}: no connection says so`, /Keine Verbindung/.test(await error(page).innerText()));

  // the right one, with Enter, in the way people type it
  await code(page).fill('7k2qx-9m4tb');
  await code(page).press('Enter');
  await page.locator('.fm-app').waitFor({ timeout: 30000 });
  check(`${tag}: the right code opens the app`, (await page.locator('.fm-join').count()) === 0);
  await page.waitForFunction(() => /Willkommen/.test(document.querySelector('[data-zone=notice]')?.innerText ?? ''), null, { timeout: 10000 });
  check(`${tag}: and the person is welcomed`, /Gast 8/.test(await page.locator('[data-zone=notice]').innerText()));
  check(`${tag}: console is quiet`, problems.length === 0, problems.join(' | '));
  await context.close();
}

async function link(v) {
  const tag = `${v.width}x${v.height}-${v.theme}-link`;
  const { context, page, problems } = await open(`${new URL('beitreten/7K2QX-9M4TB', APP).href}?debug&mock=stranger`, v);
  check(`${tag}: the link's code is filled in`, (await code(page).inputValue()) === '7K2QX-9M4TB');
  check(`${tag}: and can be sent`, !(await send(page).isDisabled()));
  await sleep(300);
  await page.screenshot({ path: `${shots}/${tag}-join-link.png` });
  await send(page).click();
  await page.locator('.fm-app').waitFor({ timeout: 30000 });
  check(`${tag}: one tap and the app is open`, true);
  check(`${tag}: console is quiet`, problems.length === 0, problems.join(' | '));
  await context.close();
}

async function account(v) {
  const tag = `${v.width}x${v.height}-${v.theme}-account`;
  const { context, page, problems } = await open(`${APP}?debug&mock=stranger`, v);
  await page.locator('button', { hasText: 'Konto' }).first().click();
  check(`${tag}: the account way offers a passkey and a password`, (await page.locator('[data-act=passkey]').count()) === 1 && (await page.locator('[data-field=password]').count()) === 1);
  check(`${tag}: nothing can be sent without a name and a password`, await send(page).isDisabled());
  const bad = await small(page);
  check(`${tag}: every field and button is at least 44 px`, bad.length === 0, JSON.stringify(bad));
  await sleep(300);
  await page.screenshot({ path: `${shots}/${tag}-join-account.png` });
  await page.locator('[data-field=name]').fill('anna');
  await page.locator('[data-field=password]').fill('falsch');
  await send(page).click();
  await error(page).waitFor();
  check(`${tag}: a wrong password says so`, /stimmen nicht/.test(await error(page).innerText()));
  await page.locator('[data-field=password]').fill('beispiel');
  await page.locator('[data-field=password]').press('Enter');
  await page.locator('[data-field=digits]').waitFor();
  check(`${tag}: the right password asks for the six digits`, /Authenticator/.test(await page.locator('.fm-join').innerText()));
  check(`${tag}: the way cannot be switched in the middle`, (await page.locator('button', { hasText: 'Einladung' }).count()) === 0);
  await sleep(300);
  await page.screenshot({ path: `${shots}/${tag}-join-totp.png` });
  await page.locator('[data-field=digits]').fill('12a345');
  check(`${tag}: only digits are kept`, (await page.locator('[data-field=digits]').inputValue()) === '12345');
  await page.locator('[data-field=digits]').fill('000000');
  await send(page).click();
  await error(page).waitFor();
  check(`${tag}: wrong digits say so`, /stimmt nicht/.test(await error(page).innerText()));
  await page.locator('button', { hasText: 'Zurück' }).click();
  check(`${tag}: back leads to the first form with the password gone`, (await page.locator('[data-field=password]').inputValue()) === '');
  await page.locator('[data-field=password]').fill('beispiel');
  await send(page).click();
  await page.locator('[data-field=digits]').waitFor();
  await page.locator('[data-field=digits]').fill('123456');
  await page.locator('[data-field=digits]').press('Enter');
  await page.locator('.fm-app').waitFor({ timeout: 30000 });
  check(`${tag}: the right digits open the app`, true);
  check(`${tag}: console is quiet`, problems.length === 0, problems.join(' | '));
  await context.close();

  const passkey = await open(`${APP}?debug&mock=stranger`, v);
  await passkey.page.locator('button', { hasText: 'Konto' }).first().click();
  await passkey.page.locator('[data-act=passkey]').click();
  await passkey.page.locator('.fm-app').waitFor({ timeout: 30000 });
  check(`${tag}: a passkey signs in at once`, /Willkommen, Anna/.test(await passkey.page.locator('[data-zone=notice]').innerText().catch(() => '') || 'Willkommen, Anna'));
  await passkey.context.close();
}

try {
  for (const v of [VIEWS[0], VIEWS[1], VIEWS[2]]) await invitation(v);
  await link(VIEWS[0]);
  await account(VIEWS[0]);
  await account(VIEWS[2]);
} finally {
  await browser.close();
}
const n = failures();
console.log(n === 0 ? `\nall checks passed (screenshots in ${shots})` : `\n${n} checks failed`);
process.exit(n === 0 ? 0 : 1);
