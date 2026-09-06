import { useEffect, useMemo, useState } from "react";
import {
  buildCampaignAccessUrl,
  buildCampaignAdminPasswordResetUrl,
  buildCampaignAdminSetupUrl,
  createCampaignAccessGrant,
  createCampaignAdminPasswordResetInvite,
  createCampaignAdminSetupInvite,
  disableCampaignAdminAccount,
  fetchCampaignAdminAccounts,
  fetchAccessGrants,
  revokeCampaignAccessGrant,
  renameCampaignAdminAccount,
  type CampaignAdminAccount,
  type AccessGrant,
  type AccessInfo,
  type PersistentAccessRole,
} from "../data/campaignApi";
import type { Campaign, MapCameraView, Team } from "../domain/campaign";
import { saveLanguage, t, type Language } from "../i18n";
import { ShareLinkModal } from "../share/ShareLinkModal.tsx";

type Props = {
  language: Language;
  campaign: Campaign;
  teams: Team[];
  access: AccessInfo | null;
  currentCamera: MapCameraView | null;
  initialAccessUrl: string | null;
  onLanguageChange: (language: Language) => void;
  onRenameCampaign: (name: string) => void;
  onNormalizeCampaignName: () => void;
  onCommitCampaignDraft: () => void;
  onSaveCurrentFocus: () => void;
  onJumpToFocus: () => void;
  onRemoveFocus: () => void;
  onResetPersonalCamera: () => void;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

function roleLabel(language: Language, role: PersistentAccessRole) {
  if (role === "admin") return t(language, "admin");
  if (role === "team-editor") return t(language, "editor");
  return t(language, "viewer");
}

function shareLabel(role: PersistentAccessRole) {
  if (role === "team-editor") return "Team-Link";
  if (role === "viewer") return "Nur-Lesen-Link";
  return "Admin-Zugangslink";
}

function shareDescription(role: PersistentAccessRole) {
  if (role === "team-editor") {
    return "Dieser Link darf im ganzen Team geteilt werden und bleibt bis zum Widerruf gültig.";
  }
  if (role === "viewer") {
    return "Dieser Link ist teilbar, wiederverwendbar und bleibt bis zum Widerruf nur lesbar.";
  }
  return "Dieser Link richtet einen weiteren Campaign-Admin ein. Teile ihn nur mit der vorgesehenen Person.";
}

export function SettingsSheet({
  language,
  campaign,
  teams,
  access,
  currentCamera,
  initialAccessUrl,
  onLanguageChange,
  onRenameCampaign,
  onNormalizeCampaignName,
  onCommitCampaignDraft,
  onSaveCurrentFocus,
  onJumpToFocus,
  onRemoveFocus,
  onResetPersonalCamera,
  onClose,
  collapsed,
  onToggleCollapsed,
}: Props) {
  const isAdmin = access?.role === "admin";
  const organizationManaged =
    (access as (AccessInfo & { identityProvider?: "organization" }) | null)?.identityProvider === "organization";
  const [grants, setGrants] = useState<AccessGrant[]>([]);
  const [adminAccounts, setAdminAccounts] = useState<CampaignAdminAccount[]>([]);
  const [role, setRole] = useState<PersistentAccessRole>("viewer");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [createdUrl, setCreatedUrl] = useState<string | null>(initialAccessUrl);
  const [createdRole, setCreatedRole] = useState<PersistentAccessRole>("admin");
  const [copyDone, setCopyDone] = useState(false);
  const [shareTarget, setShareTarget] = useState<"access" | "admin" | "reset" | null>(null);
  const [adminSetupUrl, setAdminSetupUrl] = useState<string | null>(null);
  const [adminSetupCopied, setAdminSetupCopied] = useState(false);
  const [adminResetUrl, setAdminResetUrl] = useState<string | null>(null);
  const [adminResetUsername, setAdminResetUsername] = useState<string | null>(null);
  const [adminResetCopied, setAdminResetCopied] = useState(false);
  const [editingAdminAccountId, setEditingAdminAccountId] = useState<string | null>(null);
  const [adminUsernameDraft, setAdminUsernameDraft] = useState("");
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessError, setAccessError] = useState(false);
  const [adminAccountError, setAdminAccountError] = useState<string | null>(null);

  const activeGrants = useMemo(
    () => grants.filter((grant) => grant.revokedAt === null),
    [grants],
  );

  const reloadGrants = async () => {
    if (!isAdmin) return;
    try {
      setAccessError(false);
      setGrants(await fetchAccessGrants(campaign.id));
    } catch {
      setAccessError(true);
    }
  };

  const reloadAdminAccounts = async () => {
    if (!isAdmin || organizationManaged) return;
    try {
      setAdminAccounts(await fetchCampaignAdminAccounts(campaign.id));
    } catch {
      // Legacy Campaigns may not have the local password-account schema.
    }
  };

  useEffect(() => {
    void reloadGrants();
    void reloadAdminAccounts();
  }, [campaign.id, isAdmin, organizationManaged]);

  useEffect(() => {
    if (!teamId && teams[0]) setTeamId(teams[0].id);
  }, [teams, teamId]);

  useEffect(() => {
    if (organizationManaged && role === "admin") setRole("viewer");
  }, [organizationManaged, role]);

  useEffect(() => {
    if (initialAccessUrl) setCreatedUrl(initialAccessUrl);
  }, [initialAccessUrl]);

  const changeLanguage = (nextLanguage: Language) => {
    saveLanguage(nextLanguage);
    onLanguageChange(nextLanguage);
  };

  const createAccess = async () => {
    if (
      !isAdmin ||
      (organizationManaged && role === "admin") ||
      (role === "team-editor" && !teamId)
    ) return;
    setAccessBusy(true);
    setAccessError(false);
    setCreatedUrl(null);
    try {
      const created = await createCampaignAccessGrant(campaign.id, {
        role,
        teamId: role === "team-editor" ? teamId : null,
        label,
      });
      setCreatedUrl(buildCampaignAccessUrl(campaign.id, created.token));
      setCreatedRole(role);
      setLabel("");
      await reloadGrants();
    } catch {
      setAccessError(true);
    } finally {
      setAccessBusy(false);
    }
  };

  const revoke = async (grantId: string) => {
    if (!isAdmin) return;
    setAccessBusy(true);
    setAccessError(false);
    try {
      await revokeCampaignAccessGrant(campaign.id, grantId);
      await reloadGrants();
    } catch {
      setAccessError(true);
    } finally {
      setAccessBusy(false);
    }
  };

  const copyCreatedUrl = async () => {
    if (!createdUrl) return;
    try {
      await navigator.clipboard.writeText(createdUrl);
      setCopyDone(true);
      window.setTimeout(() => setCopyDone(false), 1600);
    } catch {
      setCopyDone(false);
    }
  };

  const createAdminSetup = async () => {
    if (!isAdmin || organizationManaged) return;
    setAccessBusy(true);
    setAdminAccountError(null);
    try {
      const invite = await createCampaignAdminSetupInvite(campaign.id);
      setAdminSetupUrl(buildCampaignAdminSetupUrl(campaign.id, invite.token));
    } catch (cause) {
      setAdminAccountError(cause instanceof Error ? cause.message : "Admin-Konto konnte nicht vorbereitet werden.");
    } finally {
      setAccessBusy(false);
    }
  };

  const copyAdminSetupUrl = async () => {
    if (!adminSetupUrl) return;
    try {
      await navigator.clipboard.writeText(adminSetupUrl);
      setAdminSetupCopied(true);
      window.setTimeout(() => setAdminSetupCopied(false), 1600);
    } catch {
      setAdminSetupCopied(false);
    }
  };

  const disableAdminAccount = async (accountId: string) => {
    if (!isAdmin || organizationManaged) return;
    if (!window.confirm("Dieses Admin-Konto wird gesperrt und seine Sitzungen werden sofort beendet. Fortfahren?")) return;
    setAccessBusy(true);
    setAdminAccountError(null);
    try {
      await disableCampaignAdminAccount(campaign.id, accountId);
      await reloadAdminAccounts();
    } catch (cause) {
      setAdminAccountError(cause instanceof Error ? cause.message : "Admin-Konto konnte nicht gesperrt werden.");
    } finally {
      setAccessBusy(false);
    }
  };

  const saveAdminUsername = async (accountId: string) => {
    if (!isAdmin || organizationManaged || !adminUsernameDraft.trim()) return;
    setAccessBusy(true);
    setAdminAccountError(null);
    try {
      await renameCampaignAdminAccount(campaign.id, accountId, adminUsernameDraft.trim());
      setEditingAdminAccountId(null);
      setAdminUsernameDraft("");
      await reloadAdminAccounts();
    } catch (cause) {
      setAdminAccountError(cause instanceof Error ? cause.message : "Benutzername konnte nicht geändert werden.");
    } finally {
      setAccessBusy(false);
    }
  };

  const createAdminPasswordReset = async (account: CampaignAdminAccount) => {
    if (!isAdmin || organizationManaged) return;
    setAccessBusy(true);
    setAdminAccountError(null);
    try {
      const invite = await createCampaignAdminPasswordResetInvite(campaign.id, account.id);
      setAdminResetUrl(buildCampaignAdminPasswordResetUrl(campaign.id, invite.token));
      setAdminResetUsername(invite.username);
      setAdminResetCopied(false);
      setShareTarget("reset");
    } catch (cause) {
      setAdminAccountError(cause instanceof Error ? cause.message : "Passwort-Reset-Link konnte nicht erstellt werden.");
    } finally {
      setAccessBusy(false);
    }
  };

  const copyAdminResetUrl = async () => {
    if (!adminResetUrl) return;
    try {
      await navigator.clipboard.writeText(adminResetUrl);
      setAdminResetCopied(true);
      window.setTimeout(() => setAdminResetCopied(false), 1600);
    } catch {
      setAdminResetCopied(false);
    }
  };

  return (
    <section className={`bottom-sheet settings-sheet ${collapsed ? "is-collapsed" : ""}`} aria-label={t(language, "settings")}>
      <button className="sheet-handle-button" type="button" onClick={onToggleCollapsed} aria-label={collapsed ? "Fenster ausklappen" : "Fenster einklappen"} aria-expanded={!collapsed}><span className="sheet-handle" aria-hidden="true" /></button>
      <div className="sheet-header">
        <div>
          <span className="eyebrow">{t(language, "personal")}</span>
          <strong>{t(language, "settings")}</strong>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label={t(language, "close")}>
          ×
        </button>
      </div>

      <section className="settings-section">
        <h3>{t(language, "personal")}</h3>
        <label className="field-label">
          <span>{t(language, "language")}</span>
          <select value={language} onChange={(event) => changeLanguage(event.target.value as Language)}>
            <option value="de">{t(language, "german")}</option>
            <option value="en">{t(language, "english")}</option>
          </select>
        </label>
        <div className="settings-actions">
          <button className="button secondary" type="button" onClick={onResetPersonalCamera}>
            {t(language, "resetCamera")}
          </button>
          {campaign.defaultMapView ? (
            <button className="button secondary" type="button" onClick={onJumpToFocus}>
              {t(language, "jumpToFocus")}
            </button>
          ) : null}
        </div>
      </section>

      {isAdmin ? (
        <>
          <section className="settings-section">
            <h3>{t(language, "campaignSettings")}</h3>
            <label className="field-label">
              <span>{t(language, "actionName")}</span>
              <input
                value={campaign.name}
                onChange={(event) => onRenameCampaign(event.target.value)}
                onBlur={() => { onNormalizeCampaignName(); onCommitCampaignDraft(); }}
                onKeyDown={(event) => { if (event.key === "Enter") onCommitCampaignDraft(); }}
                maxLength={80}
              />
            </label>
            <div className="settings-subsection">
              <strong>{t(language, "mapFocus")}</strong>
              <p>{t(language, "mapFocusBody")}</p>
              <div className="settings-actions stacked-mobile">
                <button
                  className="button primary"
                  type="button"
                  disabled={!currentCamera}
                  onClick={onSaveCurrentFocus}
                >
                  {t(language, "saveCurrentFocus")}
                </button>
                {campaign.defaultMapView ? (
                  <>
                    <button className="button secondary" type="button" onClick={onJumpToFocus}>
                      {t(language, "jumpToFocus")}
                    </button>
                    <button className="button danger" type="button" onClick={onRemoveFocus}>
                      {t(language, "removeFocus")}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </section>

          {organizationManaged ? (
            <section className="settings-section access-section">
              <h3>Admins & Berechtigungen</h3>
              <p className="settings-help">
                Diese Campaign verwendet zentrale Organization-Konten. Admins melden sich mit demselben Passwort- und MFA-Login wie Organizer an. Rechte, Rollen, Einladungen und Passwort-Resets werden zentral verwaltet; kampagnenlokale Admin-Passwörter gibt es hier nicht mehr.
              </p>
              <a className="button primary full-width" href="/admin/security">
                Admins, Rollen & Einladungen verwalten
              </a>
            </section>
          ) : (
            <section className="settings-section access-section">
              <h3>Legacy Admin-Konten</h3>
              <p className="settings-help">Diese nicht migrierte Campaign verwendet noch den alten kampagnenlokalen Kompatibilitätszugang. Neue Organization-Campaigns verwenden ausschließlich zentrale Admin-Einladungen.</p>
              <button className="button secondary full-width" type="button" disabled={accessBusy} onClick={() => void createAdminSetup()}>
                Legacy-Einrichtungslink erstellen
              </button>
              {adminSetupUrl ? (
                <div className="access-link-result" role="status">
                  <strong>Legacy Admin-Konto: einmaliger Einrichtungslink</strong>
                  <span>Der Link ist 24 Stunden gültig und nach der Einrichtung verbraucht.</span>
                  <input readOnly value={adminSetupUrl} aria-label="Admin-Einrichtungslink" />
                  <div className="settings-actions">
                    <button className="button secondary" type="button" onClick={copyAdminSetupUrl}>
                      {adminSetupCopied ? t(language, "copied") : t(language, "copy")}
                    </button>
                    <button className="button secondary" type="button" onClick={() => setShareTarget("admin")}>
                      QR-Code anzeigen
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="access-list">
                {adminAccounts.filter((account) => account.disabledAt === null).map((account) => (
                  <article className="access-card" key={account.id}>
                    <div>
                      <strong>{account.username}</strong>
                      <span>Legacy Campaign-Admin</span>
                      {editingAdminAccountId === account.id ? (
                        <label className="field-label">
                          <span>Neuer Benutzername</span>
                          <input value={adminUsernameDraft} onChange={(event) => setAdminUsernameDraft(event.target.value)} autoComplete="username" maxLength={40} />
                        </label>
                      ) : null}
                    </div>
                    <div className="settings-actions">
                      {editingAdminAccountId === account.id ? (
                        <>
                          <button className="small-action" type="button" disabled={accessBusy || !adminUsernameDraft.trim()} onClick={() => void saveAdminUsername(account.id)}>Speichern</button>
                          <button className="small-action" type="button" disabled={accessBusy} onClick={() => { setEditingAdminAccountId(null); setAdminUsernameDraft(""); }}>Abbrechen</button>
                        </>
                      ) : (
                        <button className="small-action" type="button" disabled={accessBusy} onClick={() => { setEditingAdminAccountId(account.id); setAdminUsernameDraft(account.username); }}>Name ändern</button>
                      )}
                      <button className="small-action" type="button" disabled={accessBusy} onClick={() => void createAdminPasswordReset(account)}>Passwort zurücksetzen</button>
                      <button className="small-action danger-action" type="button" disabled={accessBusy} onClick={() => void disableAdminAccount(account.id)}>Sperren</button>
                    </div>
                  </article>
                ))}
              </div>
              {adminAccountError ? <p className="settings-error" role="alert">{adminAccountError}</p> : null}
              {adminResetUrl ? (
                <div className="access-link-result" role="status">
                  <strong>Legacy Passwort-Reset für {adminResetUsername}</strong>
                  <span>Der Link ist 24 Stunden gültig, nur einmal nutzbar und beendet beim Einlösen alle bisherigen Sitzungen dieses Kontos.</span>
                  <input readOnly value={adminResetUrl} aria-label="Admin-Passwort-Reset-Link" />
                  <div className="settings-actions">
                    <button className="button secondary" type="button" onClick={copyAdminResetUrl}>{adminResetCopied ? t(language, "copied") : t(language, "copy")}</button>
                    <button className="button secondary" type="button" onClick={() => setShareTarget("reset")}>QR-Code anzeigen</button>
                  </div>
                </div>
              ) : null}
            </section>
          )}

          <section className="settings-section access-section">
            <h3>{t(language, "access")}</h3>
            <div className="access-create-grid">
              <label className="field-label">
                <span>{t(language, "accessRole")}</span>
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value as PersistentAccessRole)}
                >
                  {!organizationManaged ? <option value="admin">Legacy Admin-Zugangslink</option> : null}
                  <option value="team-editor">Team-Link</option>
                  <option value="viewer">Nur-Lesen-Link</option>
                </select>
              </label>
              {role === "team-editor" ? (
                <label className="field-label">
                  <span>{t(language, "teamScope")}</span>
                  <select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                    {teams.map((team) => (
                      <option value={team.id} key={team.id}>
                        {team.name || t(language, "team")}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="field-label">
                <span>{t(language, "accessLabel")}</span>
                <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={120} />
              </label>
            </div>
            <p className="settings-help">
              {organizationManaged && role === "viewer"
                ? "Dieser Link ist für Feld-/Leseszenarien. Neue Admins werden ausschließlich über den zentralen Bereich „Admins, Rollen & Einladungen“ eingeladen."
                : shareDescription(role)}
            </p>
            <button
              className="button primary full-width"
              type="button"
              disabled={accessBusy || (role === "team-editor" && !teamId) || (organizationManaged && role === "admin")}
              onClick={createAccess}
            >
              {t(language, "createAccess")}
            </button>

            {createdUrl ? (
              <div className="access-link-result" role="status">
                <strong>{shareLabel(createdRole)}: {t(language, "accessLinkOnce")}</strong>
                <span>{shareDescription(createdRole)}</span>
                <input readOnly value={createdUrl} aria-label={t(language, "access")} />
                <div className="settings-actions">
                  <button className="button secondary" type="button" onClick={copyCreatedUrl}>
                    {copyDone ? t(language, "copied") : t(language, "copy")}
                  </button>
                  <button className="button secondary" type="button" onClick={() => setShareTarget("access")}>
                    QR-Code anzeigen
                  </button>
                </div>
              </div>
            ) : null}

            {accessError ? <p className="settings-error">{t(language, "permissionDenied")}</p> : null}

            <div className="access-list">
              {activeGrants.map((grant) => (
                <article className="access-card" key={grant.grantId}>
                  <div>
                    <strong>{grant.label || shareLabel(grant.role)}</strong>
                    <span>
                      {roleLabel(language, grant.role)}
                      {grant.teamId
                        ? ` · ${teams.find((team) => team.id === grant.teamId)?.name || t(language, "team")}`
                        : ""}
                    </span>
                  </div>
                  <button
                    className="small-action danger-action"
                    type="button"
                    disabled={accessBusy}
                    onClick={() => void revoke(grant.grantId)}
                  >
                    {t(language, "revoke")}
                  </button>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : null}
      {shareTarget === "access" && createdUrl ? (
        <ShareLinkModal
          title={shareLabel(createdRole)}
          description={shareDescription(createdRole)}
          url={createdUrl}
          onClose={() => setShareTarget(null)}
        />
      ) : null}
      {!organizationManaged && shareTarget === "admin" && adminSetupUrl ? (
        <ShareLinkModal
          title="Legacy Admin-Konto einrichten"
          description="Kompatibilitätslink zum Festlegen eines kampagnenlokalen Admin-Passworts für eine nicht migrierte Campaign."
          url={adminSetupUrl}
          onClose={() => setShareTarget(null)}
        />
      ) : null}
      {!organizationManaged && shareTarget === "reset" && adminResetUrl ? (
        <ShareLinkModal
          title={`Legacy Passwort-Reset für ${adminResetUsername ?? "Admin"}`}
          description="Kompatibilitätslink für ein kampagnenlokales Admin-Passwort. Neue Organization-Campaigns verwenden den zentralen Passwort-Reset."
          url={adminResetUrl}
          onClose={() => setShareTarget(null)}
        />
      ) : null}
    </section>
  );
}