import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AppBar, Button, Card, Dialog, Field, Loading, Notice, Secret, TextInput, type NavItem } from "../ui/index.ts";
import { OrganizationApiError, completeOrganizationTotp, getOrganizationMe, logoutOrganization, type OrganizationMeDto } from "./organizationApiClient.ts";

export type Navigate = (path: string, replace?: boolean) => void;
export type Loaded<T> = { loading: boolean; value: T | null; error: string | null };

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Unbekannter Fehler.");

/** The signed-in account; a missing session sends the person to the sign-in page and back to where they were. */
export function useOrganizationMe(next: string, onUnauthorized: (loginPath: string) => void): Loaded<OrganizationMeDto> {
  const [state, setState] = useState<Loaded<OrganizationMeDto>>({ loading: true, value: null, error: null });
  useEffect(() => {
    let active = true;
    getOrganizationMe()
      .then((value) => { if (active) setState({ loading: false, value, error: null }); })
      .catch((cause: unknown) => {
        if (!active) return;
        if (cause instanceof OrganizationApiError && cause.status === 401) { onUnauthorized(`/login?next=${encodeURIComponent(next)}`); return; }
        setState({ loading: false, value: null, error: errorMessage(cause) });
      });
    return () => { active = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export type AdminPage = "campaigns" | "new" | "invites" | "security";

/** One navigation for every admin page: the same entries everywhere, the current one marked. */
export function AdminBar({ me, current, navigate }: { me: OrganizationMeDto; current?: AdminPage; navigate?: Navigate }) {
  const [busy, setBusy] = useState(false);
  const canCreateCampaign = me.memberships.some((membership) => membership.role === "organizer");
  const go = (path: string) => (navigate ? { onClick: () => navigate(path) } : { href: path });
  const nav: NavItem[] = [
    { label: "Aktionen", current: current === "campaigns", ...go("/admin") },
    ...(canCreateCampaign ? [{ label: "Neue Aktion", current: current === "new", ...go("/new") }] : []),
    { label: "Einladungen", current: current === "invites", href: "/admin/invites" },
    { label: "Sicherheit", current: current === "security", href: "/admin/security" },
    { label: "Feldkarte", href: "/" },
  ];
  const logout = async () => {
    if (busy) return;
    setBusy(true);
    try { await logoutOrganization(); } finally { if (navigate) navigate("/login", true); else window.location.replace("/login"); }
  };
  return (
    <AppBar
      nav={nav}
      onBrand={navigate ? () => navigate("/admin") : undefined}
      account={<><span>{me.account.username}</span><Button tone="quiet" disabled={busy} onClick={() => void logout()}>Abmelden</Button></>}
    />
  );
}

export const PageLoading = ({ children }: { children: ReactNode }) => <Loading>{children}</Loading>;

/** Pick one of several organisations; a single one is just named. */
export function OrganizationLine({ me, organizationId, onChange }: { me: OrganizationMeDto; organizationId: string; onChange: (id: string) => void }) {
  const membership = me.memberships.find((item) => item.organizationId === organizationId) ?? me.memberships[0];
  if (me.memberships.length > 1) {
    return (
      <Field label="Organisation">
        <select className="ui-input" value={membership?.organizationId ?? ""} onChange={(event) => onChange(event.target.value)}>
          {me.memberships.map((item) => <option key={item.id} value={item.organizationId}>{item.organizationName}</option>)}
        </select>
      </Field>
    );
  }
  return membership ? <p className="ui-muted">{membership.organizationName} · {membership.role === "organizer" ? "Organizer" : "Admin"}</p> : null;
}

/** Authenticator enrolment: QR code, manual key, one-time recovery codes, and the 6-digit confirmation. Used wherever TOTP is (re)started. */
export function TotpEnrollment({ enrollment, title, intro, confirmLabel, onConfirmed, extra }: {
  enrollment: { otpauthUri: string; recoveryCodes: string[] };
  title: string;
  intro: ReactNode;
  confirmLabel: string;
  onConfirmed: () => void;
  extra?: ReactNode;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await completeOrganizationTotp(code); onConfirmed(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  };
  return (
    <Card eyebrow="Zweiter Faktor" title={title} icon="shield">
      <p>{intro}</p>
      <div className="ui-qr"><QRCodeSVG value={enrollment.otpauthUri} size={196} level="M" /></div>
      <details><summary>Setup-Schlüssel manuell anzeigen</summary><code className="ui-code">{enrollment.otpauthUri}</code></details>
      <h3>Recovery-Codes</h3>
      <p>Jeder Code funktioniert genau einmal. Sicher offline aufbewahren.</p>
      <Secret value={enrollment.recoveryCodes.join("\n")} copyLabel="Codes kopieren" />
      <form className="ui-form" onSubmit={(event) => void confirm(event)}>
        <Field label="6-stelliger Code"><TextInput inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} required /></Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button tone="primary" busy={busy} disabled={code.length !== 6}>{confirmLabel}</Button>
      </form>
      {extra}
    </Card>
  );
}

/** A secret link that is shown once and exists only in this tab. */
export function OneTimeLinkDialog({ title, link, onClose }: { title: string; link: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [link]);
  return (
    <Dialog title={title} eyebrow="One-time-Link" onClose={onClose}>
      <p>Der Link wird aus Sicherheitsgründen nur in diesem Tab gehalten. Nach einem Neuladen kann der geheime Token nicht erneut aus der Datenbank gelesen werden.</p>
      <code className="ui-code">{link}</code>
      <div className="ui-actions">
        <Button tone="primary" icon="upload" onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}>{copied ? "Kopiert ✓" : "Link kopieren"}</Button>
        <Button onClick={onClose}>Schließen</Button>
      </div>
    </Dialog>
  );
}

/** The token travels in the URL fragment; it is read once and removed from the address bar. */
export function consumeFragmentToken() {
  const params = new URLSearchParams(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash);
  const token = params.get("token") ?? "";
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return token;
}

export const formatDate = (iso: string) => new Date(iso).toLocaleString("de-DE");
