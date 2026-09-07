export const ORGANIZATION_ADMIN_PATHS = ["/start", "/login", "/join", "/reset", "/new", "/admin", "/admin/security"] as const;

export function isOrganizationAdminPath(pathname: string) {
  return pathname === "/start" ||
    pathname === "/login" ||
    pathname === "/join" ||
    pathname === "/reset" ||
    pathname === "/new" ||
    pathname === "/admin" ||
    pathname === "/admin/security" ||
    pathname.startsWith("/admin/campaign/");
}

function isAuthenticatedOrganizationDestination(pathname: string) {
  return pathname === "/new" ||
    pathname === "/admin" ||
    pathname === "/admin/security" ||
    pathname.startsWith("/admin/campaign/");
}

export function safeOrganizationNext(value: string | null | undefined, fallback = "/admin") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  let url: URL;
  try {
    url = new URL(value, "https://flyer-map.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "https://flyer-map.invalid" || !isAuthenticatedOrganizationDestination(url.pathname)) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

export function campaignIdFromOrganizationPath(pathname: string) {
  const match = pathname.match(/^\/admin\/campaign\/([^/]+)$/u);
  if (!match) return null;
  try {
    const value = decodeURIComponent(match[1]);
    return /^[A-Za-z0-9._:-]{1,200}$/u.test(value) ? value : null;
  } catch {
    return null;
  }
}
