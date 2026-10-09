import { isOrganizationAdminPath } from "./organization/organizationRoutes";
import { toFieldMap } from "./v5/app/link.ts";

/**
 * Entry of the single-page routes. Organiser pages (sign-in, admin, security, invitations) are mounted from here;
 * the old map address (`/?campaign=…`) forwards to the field map at /v5 with its token, and anything else goes to the sign-in page.
 */
const root = document.getElementById("root")!;
const { pathname, search } = window.location;
const fieldMap = toFieldMap(new URL(window.location.href));

if (fieldMap) {
  window.location.replace(fieldMap);
} else if (isOrganizationAdminPath(pathname) || pathname === "/join" || pathname === "/reset" || pathname === "/admin/invites") {
  void import("./organization/main.tsx").then((m) => m.mountOrganization(root));
} else {
  const diagnostic = new URLSearchParams(search).get("diag") === "1" ? "?diag=1" : "";
  window.location.replace(`/login${diagnostic}`);
}
