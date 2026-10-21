import { StrictMode, Suspense, lazy, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { applyTheme } from "../ui/index.ts";
import { useEffect } from "react";
import { splash } from "../pwa/splash.ts";
import "../ui/ui.css";

const OrganizationApp = lazy(() => import("./OrganizationApp.tsx").then((m) => ({ default: m.OrganizationApp })));
const InviteRedeem = lazy(() => import("./OrganizationPublicLinks.tsx").then((m) => ({ default: m.OrganizationInviteRedeemPage })));
const PasswordReset = lazy(() => import("./OrganizationPublicLinks.tsx").then((m) => ({ default: m.OrganizationPasswordResetPage })));

/** The organiser side of the app: sign-in, admin, security, invitations. One entry, one design system, none of the legacy map CSS. */
const PAGES: Record<string, { title: string; page: ReactElement }> = {
  "/join": { title: "Einladung | Flyer Map", page: <InviteRedeem /> },
  "/reset": { title: "Passwort-Reset | Flyer Map", page: <PasswordReset /> },
};

/** Pages that load nothing of their own (sign-in, invitations, reset) take the start screen away as soon as they stand. The admin pages do it when the account is loaded. */
function SplashGate() {
  useEffect(() => { requestAnimationFrame(() => splash.hide()); }, []);
  return null;
}

export function mountOrganization(root: HTMLElement) {
  applyTheme();
  const { pathname } = window.location;
  const entry = PAGES[pathname] ?? { title: "Organizer Admin | Flyer Map", page: <OrganizationApp /> };
  const ownLoading = pathname.startsWith("/admin") || pathname === "/new";
  document.title = entry.title;
  createRoot(root).render(<StrictMode><Suspense fallback={null}>{entry.page}{ownLoading ? null : <SplashGate />}</Suspense></StrictMode>);
}
