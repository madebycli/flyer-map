// Store and sync of the Rust app against the local Worker (scripts/rs-e2e/app-local.sh): what a device marks reaches the server (read back through /state),
// another device converges, edits made offline are kept on the device and sent after the reconnection (also after the page was closed in between), the
// last writer wins when two devices disagree, and the server, not the screen, decides what a link may write.
import { launch, mapReady, reporter } from './lib.mjs';
import { APP, CAMPAIGN, api, buildPacks, contextAs, serverStatuses } from './local.mjs';

const { check, failures } = reporter();
const browser = await launch();
await buildPacks();
const address = `${APP}?debug&campaign=${CAMPAIGN}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function device(who) {
  const context = await contextAs(browser, who, { viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message|GPU stall|Failed to load resource/.test(m.text())) problems.push(`${m.type()} ${m.text()}`); });
  await open(page);
  return { context, page, problems };
}
async function open(page) {
  await page.goto(address);
  await page.waitForSelector('.fm-app', { timeout: 30000 });
  await page.waitForFunction(() => window.__rsApp && Number(document.querySelector('.v5-pill')?.dataset.total) > 50, null, { timeout: 40000 });
  await page.waitForFunction(() => JSON.parse(window.__rsApp.sync()).cursor >= 0 && JSON.parse(window.__rsApp.sync()).state === 'idle', null, { timeout: 20000 });
}
const syncOf = (page) => page.evaluate(() => JSON.parse(window.__rsApp.sync()));
const statusOf = (page, key) => page.evaluate((k) => window.__rsApp.status(k), key);
const done = async (page) => Number(await page.locator('.v5-pill').getAttribute('data-done'));
const quiet = (page, ms = 20000) => page.waitForFunction(() => { const s = JSON.parse(window.__rsApp.sync()); return s.state === 'idle' && s.queued === 0; }, null, { timeout: ms });

const baseline = Object.keys(await serverStatuses()).length;
const A = await device('admin');
const B = await device('admin');
// keys nobody marked yet (a stack that is used again starts from what the earlier run left)
const taken = await serverStatuses();
const pool = (await A.page.evaluate(() => window.__rsApp.keys('area_n', 1000))).filter((k) => !(k in taken));
const keys = pool.slice(0, 12);
check('the field has houses to mark', keys.length === 12, `${keys.length} keys`);

// 1. a device marks: the store takes it, the pill counts it, the server holds it
const doneBefore = await done(A.page);
const first = keys.slice(0, 5);
check('marking five houses changes five keys', (await A.page.evaluate((k) => window.__rsApp.mark(k, 'completed'), first)) === 5);
check('the pill counts them at once', (await done(A.page)) === doneBefore + 5, `${doneBefore} -> ${await done(A.page)}`);
await quiet(A.page);
let server = await serverStatuses();
check('the server holds the five marks (read back through /state)', first.every((k) => server[k] === 'completed') && Object.keys(server).length === baseline + 5, `${Object.keys(server).length - baseline} new`);
check('marking the same status again changes nothing', (await A.page.evaluate((k) => window.__rsApp.mark(k, 'completed'), first)) === 0);

// 2. the other device converges (it polls)
await B.page.waitForFunction((k) => k.every((key) => window.__rsApp.status(key) === 'completed'), first, { timeout: 40000 });
check('a second device receives the marks and counts them', (await done(B.page)) === doneBefore + 5);

// 3. offline: marks wait on the device, the quick bar says so, nothing reaches the server; back online they are sent
await A.context.setOffline(true);
const offlineKeys = keys.slice(5, 8);
await A.page.evaluate((k) => window.__rsApp.mark(k, 'later'), offlineKeys);
await A.page.waitForFunction(() => JSON.parse(window.__rsApp.sync()).state === 'offline', null, { timeout: 30000 });
const s = await syncOf(A.page);
check('offline: the three edits are queued and the state says offline', s.state === 'offline' && s.queued === 3, JSON.stringify(s));
check('offline: the quick bar button shows it', await A.page.locator('[data-quick=sync]').evaluate((el) => el.classList.contains('offline') && el.textContent.includes('3')));
const meanwhile = await serverStatuses();
check('offline: the server knows nothing of them', offlineKeys.every((k) => meanwhile[k] === undefined));
await A.context.setOffline(false);
await quiet(A.page, 40000);
server = await serverStatuses();
check('back online: the three edits are on the server', offlineKeys.every((k) => server[k] === 'later'));

// 4. queued edits survive the page: offline, mark, close the page, open a new one online: the edits are sent from the restored queue
await A.context.setOffline(true);
const kept = keys.slice(8, 10);
await A.page.evaluate((k) => window.__rsApp.mark(k, 'not-deliverable'), kept);
await sleep(600);
await A.page.close();
await A.context.setOffline(false);
const A2 = await A.context.newPage();
await open(A2);
await quiet(A2, 40000);
server = await serverStatuses();
check('after a restart the queued edits were restored and sent', kept.every((k) => server[k] === 'not-deliverable'));
check('and this device shows them', (await statusOf(A2, kept[0])) === 'not-deliverable');

// 5. two devices disagree: the later writer wins everywhere
const contested = keys[10];
await A2.evaluate((k) => window.__rsApp.mark([k], 'completed'), contested);
await sleep(1200);
await B.page.evaluate((k) => window.__rsApp.mark([k], 'later'), contested);
await Promise.all([quiet(A2, 40000), quiet(B.page, 40000)]);
// One of the two wins, the same everywhere. Which one is the order of the clocks: in this stack the Worker's clock stands still (TEST_FIXED_NOW_MS, so the seeded
// sessions stay valid), and every pull sets the device clocks back to it, so the order of two edits made a second apart is not the order they were made in.
// (With a server whose clock runs, the later edit wins; the contract tests of flyermap-core and flyermap-sync prove that.)
server = await serverStatuses();
const winner = server[contested];
await A2.waitForFunction(([k, w]) => window.__rsApp.status(k) === w, [contested, winner], { timeout: 40000 });
await B.page.waitForFunction(([k, w]) => window.__rsApp.status(k) === w, [contested, winner], { timeout: 40000 });
check('two devices that disagree end up with the same status, the server\'s', ['completed', 'later'].includes(winner) && (await statusOf(A2, contested)) === winner && (await statusOf(B.page, contested)) === winner, `winner ${winner}`);

// 6. rights: a group link marks in its own Gebiet only; the screen does not even offer the other, and the server refuses it when asked anyway
const E = await device('editor');
const foreign = await E.page.evaluate(() => window.__rsApp.keys('area_o', 1));
check('the group link has no data of the other Gebiet', foreign.length === 0);
const refused = await api('editor', '/ops', { method: 'POST', body: JSON.stringify({ ops: [{ id: '000mywpiw48-0000-ui', key: keys[11], status: 'completed', area: 'area_o' }] }) });
check('the server refuses a write the link may not do', refused.status === 403 || (refused.body.rejected ?? []).length === 1, `${refused.status} ${JSON.stringify(refused.body).slice(0, 120)}`);
check('and the state did not change', (await serverStatuses())[keys[11]] === undefined);
const own = pool.slice(20, 21);
check('the group link marks in its own Gebiet', (await E.page.evaluate((k) => window.__rsApp.mark(k, 'completed'), own)) === 1);
await quiet(E.page);
check('and the server takes it', (await serverStatuses())[own[0]] === 'completed');

for (const [name, d] of [['A', A], ['B', B], ['E', E]]) check(`console of device ${name} is quiet`, d.problems.length === 0, d.problems.join(' | '));
await browser.close();
const n = failures();
console.log(n === 0 ? '\nall checks passed' : `\n${n} checks failed`);
process.exit(n === 0 ? 0 : 1);
