import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function OrganizationAdminNavEnhancer() {
  const [nav, setNav] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const candidate = document.querySelector<HTMLElement>('nav[aria-label="Organizer Navigation"]');
    if (!candidate || candidate.querySelector('a[href="/admin/invites"]')) return;
    setNav(candidate);
  }, []);

  return nav ? createPortal(<a href="/admin/invites">Einladungen</a>, nav) : null;
}
