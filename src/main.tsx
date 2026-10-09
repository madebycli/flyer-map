import { isOrganizationAdminPath } from "./organization/organizationRoutes";

/**
 * One entry, two apps. Organiser pages (sign-in, admin, security, invitations) load the new design system and none of the map CSS;
 * everything else is still the legacy field map until /v5 replaces it. Each side is a separate chunk, so neither pays for the other.
 */
const ORGANIZATION_PATHS = new Set(["/join", "/reset", "/admin/invites", "/admin/security"]);
const root = document.getElementById("root")!;
const { pathname } = window.location;

if (ORGANIZATION_PATHS.has(pathname) || isOrganizationAdminPath(pathname)) {
  void import("./organization/main.tsx").then((m) => m.mountOrganization(root));
} else {
  void import("./legacyMain.tsx").then((m) => m.mountLegacyApp(root));
}
