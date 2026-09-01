import { useEffect, useMemo, useState } from "react";
import {
  buildCampaignAccessUrl,
  buildCampaignAdminSetupUrl,
  createCampaignAccessGrant,
  createCampaignAdminSetupInvite,
  disableCampaignAdminAccount,
  fetchCampaignAdminAccounts,
  fetchAccessGrants,
  revokeCampaignAccessGrant,
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
  onSaveCurrentFocus: () => void;
  onJumpToFocus: () => void;
  onRemoveFocus: () => void;
  onResetPersonalCamera: () => void;
  onClose: () => void;
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
  onSaveCurrentFocus,
  onJumpToFocus,
  onRemoveFocus,
  onResetPersonalCamera,
  onClose,
}: Props) {
  const isAdmin = access?.role === "admin";
  const [grants, setGrants] = useState<AccessGrant[]>([]);
  const [adminAccounts, setAdminAccounts] = useState<CampaignAdminAccount[]>([]);
  const [role, setRole] = useState<PersistentAccessRole>("viewer");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [createdUrl, setCreatedUrl] = useState<string | null>(initialAccessUrl);
  const [createdRole, setCreatedRole] = useState<PersistentAccessRole>("admin");
  const [copyDone, setCopyDone] = useState(false);
  const [shareTarget, setShareTarget] = useState<"access" | "admin" | null>(null);
  const [adminSetupUrl, setAdminSetupUrl] = useState<string | null>(null);
  const [adminSetupCopied, setAdminSetupCopied] = useState(false);
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessError, setAccessError] = useState(false);

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
    if (!isAdmin) return;
    try {
      setAdminAccounts(await fetchCampaignAdminAccounts(campaign.id));
    } catch {
      // The password-account migration may not be applied on an older preview yet.
    }
  };

  useEffect(() => {
    void reloadGrants();
    void reloadAdminAccounts();
  }, [campaign.id, isAdmin]);

  useEffect(() => {
    if (!teamId && teams[0]) setTeamId(teams[0].id);
  }, [teams, teamId]);

  useEffect(() => {
    if (initialAccessUrl) setCreatedUrl(initialAccessUrl);
  }, [initialAccessUrl]);

  const changeLanguage = (nextLanguage: Language) => {
    saveLanguage(nextLanguage);
    onLanguageChange(nextLanguage);
  };

  const createAccess = async () => {
    if (!isAdmin || (role === "team-editor" && !teamId)) return;
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
    if (!isAdmin) return;
    setAccessBusy(true);
    setAccessError(false);
    try {
      const invite = await createCampaignAdminSetupInvite(campaign.id);
      setAdminSetupUrl(buildCampaignAdminSetupUrl(campaign.id, invite.token));
    } catch {
      setAccessError(true);
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
    if (!isAdmin) return;
    setAccessBusy(true);
    setAccessError(false);
    try {
      await disableCampaignAdminAccount(campaign.id, accountId);
      await reloadAdminAccounts();
    } catch {
      setAccessError(true);
    } finally {
      setAccessBusy(false);
    }
  };

  return (
    <section className="bottom-sheet settings-sheet" aria-label={t(language, "settings")}>
      <div className="sheet-handle" aria-hidden="true" />
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
                onBlur={onNormalizeCampaignName}
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

          <section className="settings-section access-section">
            <h3>Admin-Konten</h3>
            <p className="settings-help">Jede Person erhält einen eigenen Benutzernamen und ein eigenes Passwort nur für diese Campaign. Keine TOTP-Abfrage für die Mission.</p>
            <button className="button secondary full-width" type="button" disabled={accessBusy} onClick={() => void createAdminSetup()}>
              Einmaligen Einrichtungslink erstellen
            </button>
            {adminSetupUrl ? (
              <div className="access-link-result" role="status">
                <strong>Admin-Konto: einmaliger Einrichtungslink</strong>
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
                    <span>Campaign-Admin</span>
                  </div>
                  <button className="small-action danger-action" type="button" disabled={accessBusy} onClick={() => void disableAdminAccount(account.id)}>
                    Sperren
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section className="settings-section access-section">
            <h3>{t(language, "access")}</h3>
            <div className="access-create-grid">
              <label className="field-label">
                <span>{t(language, "accessRole")}</span>
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value as PersistentAccessRole)}
                >
                  <option value="admin">Admin-Zugangslink</option>
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
            <p className="settings-help">{shareDescription(role)}</p>
            <button
              className="button primary full-width"
              type="button"
              disabled={accessBusy || (role === "team-editor" && !teamId)}
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
      {shareTarget === "admin" && adminSetupUrl ? (
        <ShareLinkModal
          title="Admin-Konto einrichten"
          description="Einmaliger Link zum Festlegen eines kampagnenlokalen Admin-Passworts."
          url={adminSetupUrl}
          onClose={() => setShareTarget(null)}
        />
      ) : null}
    </section>
  );
}
