import { isOrganizationAdminPath } from "./organization/organizationRoutes";
import { toFieldMap } from "./v5/app/link.ts";
import { lockAppFeel } from "./pwa/appFeel.ts";
import { mountPwaChrome, showOver } from "./pwa/chrome.tsx";
import { InstallGuide } from "./pwa/InstallGuide.tsx";
import { captureInstallPrompt, detectPlatform, isStandalone, wantsGuide } from "./pwa/install.ts";
import { registerServiceWorker } from "./pwa/register.ts";
import { splash } from "./pwa/splash.ts";
import { StartPage } from "./pwa/StartPage.tsx";
import { coldStartUpdate } from "./pwa/update.ts";
import { applyTheme } from "./ui/index.ts";

/**
 * Entry of the single-page routes. Organiser pages (sign-in, admin, security, invitations) are mounted from here;
 * the old map address (`/?campaign=…`) forwards to the field map at /v5 with its token, the home of the installed app is the start page,
 * and anything else goes to the sign-in page.
 */
const root = document.getElementById("root")!;
const { pathname, search } = window.location;
const fieldMap = toFieldMap(new URL(window.location.href));

lockAppFeel();
splash.watch();
captureInstallPrompt();
registerServiceWorker();

async function start() {
  applyTheme(); // the guide and the start page come before any page of the app, and follow the chosen theme
  if (fieldMap) { window.location.replace(fieldMap); return; }
  const organiser = isOrganizationAdminPath(pathname) || pathname === "/join" || pathname === "/reset" || pathname === "/admin/invites";
  const home = pathname === "/" && (new URLSearchParams(search).get("source") === "pwa" || isStandalone());
  if (!organiser && !home) {
    const diagnostic = new URLSearchParams(search).get("diag") === "1" ? "?diag=1" : "";
    window.location.replace(`/login${diagnostic}`);
    return;
  }
  if (wantsGuide()) {
    const platform = detectPlatform(navigator.userAgent, navigator.maxTouchPoints);
    await new Promise<void>((resolve) => { showOver((done) => <InstallGuide platform={platform === "ios" ? "ios" : "android"} onContinue={() => { done(); resolve(); }} />); });
    splash.watch();
  }
  void coldStartUpdate(4000, undefined, () => splash.active()).then((reloading) => { if (reloading) splash.text("Neue Version wird geladen …"); });
  mountPwaChrome();
  if (home) {
    showOver(() => <StartPage />);
    splash.hide();
    return;
  }
  splash.text("Wird geladen …");
  const { mountOrganization } = await import("./organization/main.tsx");
  mountOrganization(root);
}
void start();
