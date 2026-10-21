import test from 'node:test';
import assert from 'node:assert/strict';
import { detectBrowser, guideFor } from '../src/pwa/steps.ts';

const UA = {
  iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1',
  iosBrave: 'Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1 Brave',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
  iosFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15',
  iosEdge: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/140.0 Mobile/15E148 Safari/605.1.15',
  iosInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0',
  iosWebView: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  androidChrome: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 15; SM-S931B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/140.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 15; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0',
  androidEdge: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 EdgA/140.0',
  androidWebView: 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36',
};

test('browsers are told apart on iOS and Android', () => {
  assert.equal(detectBrowser(UA.iosSafari, 'ios'), 'safari');
  assert.equal(detectBrowser(UA.iosBrave, 'ios'), 'brave', 'Brave on the iPad names itself at the end of the user agent');
  assert.equal(detectBrowser(UA.iosChrome, 'ios'), 'chrome');
  assert.equal(detectBrowser(UA.iosFirefox, 'ios'), 'firefox');
  assert.equal(detectBrowser(UA.iosEdge, 'ios'), 'edge');
  assert.equal(detectBrowser(UA.iosInstagram, 'ios'), 'inapp');
  assert.equal(detectBrowser(UA.iosWebView, 'ios'), 'inapp', 'a web view has no Safari token');
  assert.equal(detectBrowser(UA.androidChrome, 'android'), 'chrome');
  assert.equal(detectBrowser(UA.androidChrome, 'android', { brave: true }), 'brave', 'Brave on Android looks like Chrome: navigator.brave tells');
  assert.equal(detectBrowser(UA.androidSamsung, 'android'), 'samsung');
  assert.equal(detectBrowser(UA.androidFirefox, 'android'), 'firefox');
  assert.equal(detectBrowser(UA.androidEdge, 'android'), 'edge');
  assert.equal(detectBrowser(UA.androidWebView, 'android'), 'inapp');
});

test('with the system install button there are no steps, only the button', () => {
  const guide = guideFor('android', 'chrome', true);
  assert.equal(guide.direct, true);
  assert.deepEqual(guide.steps, []);
});

test('Android without the button: the menu path of that browser', () => {
  const chrome = guideFor('android', 'chrome', false);
  assert.equal(chrome.direct, false);
  assert.deepEqual(chrome.steps.map((s) => s.glyph), ['dots', 'install', 'confirm']);
  assert.deepEqual(guideFor('android', 'samsung', false).steps.map((s) => s.glyph), ['menu', 'addHome', 'confirm'], 'Samsung Internet has no three dots');
  assert.match(guideFor('android', 'inapp', false).steps[0].text, /Im Browser öffnen/u);
});

test('iOS: every browser has its own way, and none of them mentions three dots in a column or an install button', () => {
  assert.deepEqual(guideFor('ios', 'safari', false).steps.map((s) => s.glyph), ['share', 'addHome', 'confirm']);
  assert.deepEqual(guideFor('ios', 'chrome', false).steps.map((s) => s.glyph), ['share', 'addHome', 'confirm']);
  const brave = guideFor('ios', 'brave', false);
  assert.deepEqual(brave.steps.map((s) => s.glyph), ['share', 'more', 'addHome', 'confirm'], 'Brave: Teilen, then Mehr');
  assert.ok(brave.note);
  assert.deepEqual(guideFor('ios', 'firefox', false).steps.map((s) => s.glyph), ['dotsH', 'share', 'addHome', 'confirm']);
  assert.match(guideFor('ios', 'inapp', false).steps[0].text, /Safari/u);
  for (const browser of ['safari', 'chrome', 'brave', 'firefox', 'edge', 'opera', 'duckduckgo', 'other', 'inapp'] as const) {
    const g = guideFor('ios', browser, true);
    assert.equal(g.direct, false, 'iOS never has an install button, whatever an event says');
    assert.ok(g.steps.every((s) => s.glyph !== 'dots'), 'no vertical three dots on iOS');
  }
});
