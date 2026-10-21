import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform, guideWanted, isStandalone, readSkip, saveSkip } from '../src/pwa/install.ts';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const MAC = IPAD_DESKTOP;
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

test('platform detection: iPhone, iPad (also in desktop mode), Android, everything else', () => {
  assert.equal(detectPlatform(IPHONE), 'ios');
  assert.equal(detectPlatform(IPAD_DESKTOP, 5), 'ios', 'an iPad that reports a Mac but has a touch screen');
  assert.equal(detectPlatform(MAC, 0), 'other', 'a real Mac has no touch screen');
  assert.equal(detectPlatform(ANDROID, 5), 'android');
  assert.equal(detectPlatform(WINDOWS, 0), 'other');
});

test('standalone: iOS flag or display-mode', () => {
  assert.equal(isStandalone({ navigator: { standalone: true } }), true);
  assert.equal(isStandalone({ matchMedia: (q) => ({ matches: q.includes('standalone') }) }), true);
  assert.equal(isStandalone({ matchMedia: () => ({ matches: false }), navigator: { standalone: false } }), false);
  assert.equal(isStandalone({}), false);
});

test('the guide shows on a phone in a browser tab only, and not for a week after "open in the browser anyway"', () => {
  const base = { platform: 'ios' as const, standalone: false, skippedUntil: 0, now: 1_000, automation: false };
  assert.equal(guideWanted(base), true);
  assert.equal(guideWanted({ ...base, platform: 'android' }), true);
  assert.equal(guideWanted({ ...base, platform: 'other' }), false, 'desktop never');
  assert.equal(guideWanted({ ...base, standalone: true }), false, 'the installed app never');
  assert.equal(guideWanted({ ...base, automation: true }), false, 'tests never');
  const memory = new Map<string, string>();
  const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v); } };
  saveSkip(1_000, storage);
  const until = readSkip(storage);
  assert.equal(until, 1_000 + 7 * 86_400_000);
  assert.equal(guideWanted({ ...base, skippedUntil: until, now: 2_000 }), false);
  assert.equal(guideWanted({ ...base, skippedUntil: until, now: until + 1 }), true, 'after a week it asks again');
  assert.equal(readSkip(null), 0);
});

import { pastedLinkTarget } from '../src/pwa/link.ts';
const ORIGIN = 'https://flyer-map-unstable.example.workers.dev';

test('a pasted link opens inside the app, secret part kept; anything else is refused', () => {
  const token = 'a'.repeat(40);
  assert.equal(pastedLinkTarget(`${ORIGIN}/v5?campaign=campaign_1#access=${token}`, ORIGIN), `/v5?campaign=campaign_1#access=${token}`);
  assert.equal(pastedLinkTarget(`  ${ORIGIN}/v5?campaign=campaign_1&kind=collection#collection=${token}  `, ORIGIN), `/v5?campaign=campaign_1&kind=collection#collection=${token}`);
  assert.equal(pastedLinkTarget(`/v5?campaign=c1&room=r1#j=${token}`, ORIGIN), `/v5?campaign=c1&room=r1#j=${token}`, 'a path alone works, a room link too');
  assert.equal(pastedLinkTarget(`${ORIGIN}/?campaign=old#access=${token}`, ORIGIN), `/v5?campaign=old#access=${token}`, 'the old map address is the same app');
  assert.equal(pastedLinkTarget(`https://evil.example/v5?campaign=c1#access=${token}`, ORIGIN), null, 'another site is never followed');
  assert.equal(pastedLinkTarget(`${ORIGIN}/admin?campaign=c1`, ORIGIN), null, 'only the field map');
  assert.equal(pastedLinkTarget('hallo welt', ORIGIN), null);
  assert.equal(pastedLinkTarget('', ORIGIN), null);
  assert.equal(pastedLinkTarget('javascript:alert(1)', ORIGIN), null);
  assert.equal(pastedLinkTarget(`${ORIGIN}/v5`, ORIGIN), null, 'no Aktion in it');
});
