import { useEffect, useMemo, useState } from "react";
import {
  buildCampaignAccessUrl,
  createCampaignAccessGrant,
  fetchAccessGrants,
  revokeCampaignAccessGrant,
  type AccessGrant,
  type AccessInfo,
  type AccessRole,
} from "../data/campaignApi";
import {
  downloadOfflineMapPackage,
  OfflineMapApiError,
} from "../data/offlineMapApi";
import {
  browserOfflineMapRepository,
  type StoredOfflineMapPackage,
} from "../data/offlineMapRepository";
import type { Campaign, MapCameraView, Team } from "../domain/campaign";
import { saveLanguage, t, type Language, type MessageKey } from "../i18n";

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

type OfflineBusyState = "idle" | "downloading" | "deleting";

function roleLabel(language: Language, role: AccessRole) {
  if (role === "admin") return t(language, "admin");
  if (role === "team-editor") return t(language, "editor");
  return t(language, "viewer");
}

function offlineErrorMessage(error: unknown): MessageKey {
  if (error instanceof OfflineMapApiError) {
    if (error.status === 401 || error.status === 403) return "offlineMapAccessError";
    if (error.code === "network_error") return "offlineMapNetworkError";
    if (error.code === "osm_upstream_timeout") return "offlineMapTimeoutError";
    if (error.status === 413) return "offlineMapTooLargeError";
    return "offlineMapDownloadError";
  }
  return "offlineMapStorageError";
}

function formatBytes(language: Language, bytes: number) {
  const locale = language === "de" ? "de-DE" : "en-US";
  if (bytes < 1_000_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(bytes / 1_000)} KB`;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1_000_000)} MB`;
}

function formatStoredDate(language: Language, value: string) {
  return new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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
  const [role, setRole] = useState<AccessRole>("viewer");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [createdUrl, setCreatedUrl] = useState<string | null>(initialAccessUrl);
  const [copyDone, setCopyDone] = useState(false);
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessError, setAccessError] = useState(false);
  const [offlineRecord, setOfflineRecord] = useState<StoredOfflineMapPackage | null>(null);
  const [offlineBusy, setOfflineBusy] = useState<OfflineBusyState>("idle");
  const [offlineMessage, setOfflineMessage] = useState<MessageKey | null>(null);
  const [offlineMessageError, setOfflineMessageError] = useState(false);

  const activeGrants = useMemo(
    () => grants.filter((grant) => grant.revokedAt === null),
    [grants],
  );

  const offlineSummary = useMemo(
    () => (offlineRecord ? browserOfflineMapRepository.summary(offlineRecord) : null),
    [offlineRecord],
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

  useEffect(() => {
    void reloadGrants();
  }, [campaign.id, isAdmin]);

  useEffect(() => {
    let active = true;
    setOfflineMessage(null);
    void browserOfflineMapRepository
      .load(campaign.id)
      .then((record) => {
        if (!active) return;
        setOfflineRecord(record);
      })
      .catch(() => {
        if (!active) return;
        setOfflineRecord(null);
        setOfflineMessage("offlineMapStorageError");
        setOfflineMessageError(true);
      });
    return () => {
      active = false;
    };
  }, [campaign.id]);

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

  const prepareOfflineMap = async () => {
    if (!currentCamera) {
      setOfflineMessage("offlineMapNoCamera");
      setOfflineMessageError(true);
      return;
    }
    if (!access) {
      setOfflineMessage("offlineMapAccessError");
      setOfflineMessageError(true);
      return;
    }

    const [lng, lat] = currentCamera.center;
    setOfflineBusy("downloading");
    setOfflineMessage("offlineMapDownloading");
    setOfflineMessageError(false);
    try {
      const pkg = await downloadOfflineMapPackage(campaign.id, { lat, lng });
      const stored = await browserOfflineMapRepository.replace(campaign.id, pkg);
      setOfflineRecord(stored);
      setOfflineMessage("offlineMapStored");
      setOfflineMessageError(false);
    } catch (error) {
      setOfflineMessage(offlineErrorMessage(error));
      setOfflineMessageError(true);
    } finally {
      setOfflineBusy("idle");
    }
  };

  const deleteOfflineMap = async () => {
    if (!offlineRecord || offlineBusy !== "idle") return;
    setOfflineBusy("deleting");
    setOfflineMessage("offlineMapDeleting");
    setOfflineMessageError(false);
    try {
      await browserOfflineMapRepository.remove(campaign.id);
      setOfflineRecord(null);
      setOfflineMessage(null);
    } catch {
      setOfflineMessage("offlineMapStorageError");
      setOfflineMessageError(true);
    } finally {
      setOfflineBusy("idle");
    }
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

      <section className="settings-section offline-map-section">
        <h3>{t(language, "offlineMapArea")}</h3>
        <p className="settings-help">{t(language, "offlineMapBody")}</p>

        {offlineSummary ? (
          <div className="offline-map-card">
            <strong>{t(language, "offlineMapStored")}</strong>
            <dl className="offline-map-meta">
              <div>
                <dt>{t(language, "offlineMapSavedAt")}</dt>
                <dd>{formatStoredDate(language, offlineSummary.savedAt)}</dd>
              </div>
              <div>
                <dt>{t(language, "offlineMapSize")}</dt>
                <dd>{formatBytes(language, offlineSummary.byteSize)}</dd>
              </div>
              <div>
                <dt>{t(language, "offlineMapRoads")}</dt>
                <dd>{offlineSummary.roadCount}</dd>
              </div>
              <div>
                <dt>{t(language, "offlineMapBuildings")}</dt>
                <dd>{offlineSummary.buildingCount}</dd>
              </div>
              <div className="offline-map-meta-wide">
                <dt>{t(language, "offlineMapCenter")}</dt>
                <dd>
                  {offlineSummary.center.lat.toFixed(5)}, {offlineSummary.center.lng.toFixed(5)} · {Math.round(offlineSummary.radiusMeters / 1_000)} km
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <p className="settings-muted">{t(language, "offlineMapNoPackage")}</p>
        )}

        <div className="settings-actions stacked-mobile">
          <button
            className="button primary"
            type="button"
            disabled={!access || !currentCamera || offlineBusy !== "idle"}
            onClick={() => void prepareOfflineMap()}
          >
            {offlineRecord ? t(language, "offlineMapUpdate") : t(language, "offlineMapDownload")}
          </button>
          {offlineRecord ? (
            <button
              className="button danger"
              type="button"
              disabled={offlineBusy !== "idle"}
              onClick={() => void deleteOfflineMap()}
            >
              {t(language, "offlineMapDelete")}
            </button>
          ) : null}
        </div>

        {offlineMessage ? (
          <p
            className={offlineMessageError ? "settings-error" : "offline-map-status"}
            role="status"
            aria-live="polite"
          >
            {t(language, offlineMessage)}
          </p>
        ) : null}
        <p className="offline-map-attribution">{t(language, "offlineMapAttribution")}</p>
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
            <h3>{t(language, "access")}</h3>
            <div className="access-create-grid">
              <label className="field-label">
                <span>{t(language, "accessRole")}</span>
                <select value={role} onChange={(event) => setRole(event.target.value as AccessRole)}>
                  <option value="admin">{t(language, "admin")}</option>
                  <option value="team-editor">{t(language, "editor")}</option>
                  <option value="viewer">{t(language, "viewer")}</option>
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
                <strong>{t(language, "accessLinkOnce")}</strong>
                <input readOnly value={createdUrl} aria-label={t(language, "access")} />
                <button className="button secondary" type="button" onClick={copyCreatedUrl}>
                  {copyDone ? t(language, "copied") : t(language, "copy")}
                </button>
              </div>
            ) : null}

            {accessError ? <p className="settings-error">{t(language, "permissionDenied")}</p> : null}

            <div className="access-list">
              {activeGrants.map((grant) => (
                <article className="access-card" key={grant.grantId}>
                  <div>
                    <strong>{grant.label || roleLabel(language, grant.role)}</strong>
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
    </section>
  );
}
