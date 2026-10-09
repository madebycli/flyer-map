import { StrictMode, Suspense, lazy, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { Loading, applyTheme } from "../ui/index.ts";
import "../ui/ui.css";

const OrganizationApp = lazy(() => import("./OrganizationApp.tsx").then((m) => ({ default: m.OrganizationApp })));
const InviteCenter = lazy(() => import("./OrganizationInviteCenter.tsx").then((m) => ({ default: m.OrganizationInviteCenter })));
const SecurityCenter = lazy(() => import("./OrganizationSecurityCenter.tsx").then((m) => ({ default: m.OrganizationSecurityCenter })));
const InviteRedeem = lazy(() => import("./OrganizationPublicLinks.tsx").then((m) => ({ default: m.OrganizationInviteRedeemPage })));
const PasswordReset = lazy(() => import("./OrganizationPublicLinks.tsx").then((m) => ({ default: m.OrganizationPasswordResetPage })));

/** The organiser side of the app: sign-in, admin, security, invitations. One entry, one design system, none of the legacy map CSS. */
const PAGES: Record<string, { title: string; page: ReactElement }> = {
  "/join": { title: "Einladung | Flyer Map", page: <InviteRedeem /> },
  "/reset": { title: "Passwort-Reset | Flyer Map", page: <PasswordReset /> },
  "/admin/invites": { title: "Einladungen | Flyer Map", page: <InviteCenter /> },
  "/admin/security": { title: "Sicherheit | Flyer Map", page: <SecurityCenter /> },
};

export function mountOrganization(root: HTMLElement) {
  applyTheme();
  const entry = PAGES[window.location.pathname] ?? { title: "Organizer Admin | Flyer Map", page: <OrganizationApp /> };
  document.title = entry.title;
  createRoot(root).render(<StrictMode><Suspense fallback={<Loading>Lade …</Loading>}>{entry.page}</Suspense></StrictMode>);
}
