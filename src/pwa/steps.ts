import type { Platform } from './install.ts';

/** Which browser the person is in: the way to "add to home screen" is different in each (and on iOS only Safari-like menus offer it). */
export type Browser = 'safari' | 'chrome' | 'firefox' | 'edge' | 'opera' | 'brave' | 'samsung' | 'duckduckgo' | 'inapp' | 'other';

export function detectBrowser(userAgent: string, platform: Platform, hints: { brave?: boolean } = {}): Browser {
  const ua = userAgent;
  const inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|TikTok|musical_ly|Snapchat|Twitter|LinkedInApp|GSA\//.test(ua);
  if (platform === 'ios') {
    if (inApp) return 'inapp';
    if (/CriOS/.test(ua)) return 'chrome';
    if (/FxiOS/.test(ua)) return 'firefox';
    if (/EdgiOS/.test(ua)) return 'edge';
    if (/OPiOS|OPT\//.test(ua)) return 'opera';
    if (/DuckDuckGo/.test(ua)) return 'duckduckgo';
    if (/Brave/i.test(ua) || hints.brave) return 'brave';
    return /Safari\//.test(ua) ? 'safari' : 'inapp'; // a web view has no Safari token
  }
  if (platform === 'android') {
    if (inApp || /; wv\)/.test(ua)) return 'inapp';
    if (/SamsungBrowser/.test(ua)) return 'samsung';
    if (/Firefox\//.test(ua)) return 'firefox';
    if (/EdgA\//.test(ua)) return 'edge';
    if (/OPR\//.test(ua)) return 'opera';
    if (hints.brave) return 'brave';
    return /Chrome\//.test(ua) ? 'chrome' : 'other';
  }
  return 'other';
}

/** The symbols the guide can draw; each step names the one the person has to find. */
export type GlyphId = 'share' | 'addHome' | 'confirm' | 'dots' | 'dotsH' | 'install' | 'more' | 'menu' | 'openBrowser';
export type Step = { glyph: GlyphId; title: string; text: string; hot?: boolean };
export type Guide = { direct: boolean; steps: Step[]; note: string | null };

const S = {
  share: (text: string): Step => ({ glyph: 'share', title: 'Teilen', text, hot: true }),
  menuH: (text: string): Step => ({ glyph: 'dotsH', title: 'Menü öffnen', text, hot: true }),
  menuV: (text: string): Step => ({ glyph: 'dots', title: 'Menü öffnen', text, hot: true }),
  more: (): Step => ({ glyph: 'more', title: 'Mehr', text: 'Fehlt „Zum Home-Bildschirm“ in der Liste, tippe auf „Mehr“ und wische nach unten.' }),
  addHome: (): Step => ({ glyph: 'addHome', title: 'Zum Home-Bildschirm', text: 'Tippe auf „Zum Home-Bildschirm“.' }),
  confirmIos: (): Step => ({ glyph: 'confirm', title: 'Hinzufügen', text: 'Bestätige mit „Hinzufügen“. Danach startest du die App vom Home-Bildschirm.' }),
};

/** What to show for this browser. With the system's own install button (Android/Chrome family) there are no steps at all: one tap. */
export function guideFor(platform: Exclude<Platform, 'other'>, browser: Browser, canPrompt: boolean): Guide {
  if (platform === 'android') {
    if (canPrompt) return { direct: true, steps: [], note: null };
    if (browser === 'inapp') return { direct: false, note: null, steps: [{ glyph: 'openBrowser', title: 'Im Browser öffnen', text: 'Öffne den Link in Chrome: Menü ⋮ und „Im Browser öffnen“. Dort kannst du die App installieren.', hot: true }] };
    if (browser === 'samsung') return { direct: false, note: null, steps: [
      { glyph: 'menu', title: 'Menü öffnen', text: 'Tippe unten rechts auf das Menü ≡.', hot: true },
      { glyph: 'addHome', title: 'Zum Startbildschirm', text: 'Wähle „Seite hinzufügen zu“ und dann „Startbildschirm“.' },
      { glyph: 'confirm', title: 'Hinzufügen', text: 'Bestätige mit „Hinzufügen“.' },
    ] };
    if (browser === 'firefox') return { direct: false, note: null, steps: [
      S.menuV('Tippe oben rechts auf die drei Punkte.'),
      { glyph: 'install', title: 'Installieren', text: 'Wähle „Installieren“ (oder „Zum Startbildschirm hinzufügen“).' },
      { glyph: 'confirm', title: 'Hinzufügen', text: 'Bestätige. Die App liegt dann auf deinem Startbildschirm.' },
    ] };
    return { direct: false, note: null, steps: [
      S.menuV('Tippe oben rechts auf die drei Punkte.'),
      { glyph: 'install', title: 'App installieren', text: 'Wähle „App installieren“ oder „Zum Startbildschirm hinzufügen“.' },
      { glyph: 'confirm', title: 'Installieren', text: 'Bestätige. Die App liegt dann auf deinem Startbildschirm.' },
    ] };
  }
  // iOS: no install button exists; the way depends on the browser
  switch (browser) {
    case 'safari': return { direct: false, note: null, steps: [S.share('Tippe auf das Teilen-Symbol, unten in der Leiste (iPad: oben rechts).'), S.addHome(), S.confirmIos()] };
    case 'chrome': return { direct: false, note: null, steps: [S.share('Tippe oben rechts in der Adressleiste auf das Teilen-Symbol.'), S.addHome(), S.confirmIos()] };
    case 'brave': return { direct: false, note: 'Mit weniger Schritten geht es in Safari.', steps: [S.share('Tippe unten auf das Teilen-Symbol (oder im Menü ⋯ auf „Teilen“).'), S.more(), S.addHome(), S.confirmIos()] };
    case 'firefox':
    case 'edge': return { direct: false, note: 'Mit weniger Schritten geht es in Safari.', steps: [S.menuH('Tippe auf das Menü ⋯ des Browsers.'), { glyph: 'share', title: 'Teilen', text: 'Wähle „Teilen“.' }, S.addHome(), S.confirmIos()] };
    case 'inapp': return { direct: false, note: null, steps: [{ glyph: 'openBrowser', title: 'In Safari öffnen', text: 'Tippe auf ⋯ oder das Kompass-Symbol und wähle „In Safari öffnen“. Dort kannst du die App hinzufügen.', hot: true }] };
    default: return { direct: false, note: 'Fehlt „Zum Home-Bildschirm“, öffne die Seite in Safari.', steps: [S.share('Suche das Teilen-Symbol in der Leiste oder im Menü ⋯.'), S.addHome(), S.confirmIos()] };
  }
}
