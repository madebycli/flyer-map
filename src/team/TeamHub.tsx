import { useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CampaignApiError } from "../data/campaignApi.ts";
import {
  buildFieldGroupQrJoinUrl,
  closeFieldGroup,
  createFieldGroup,
  fetchFieldGroup,
  fetchFieldGroups,
  fieldGroupQrTokenFromUrl,
  joinFieldGroup,
  leaveFieldGroup,
  removeFieldGroupQrTokenFromUrl,
  revokeFieldGroupCredentials,
  rotateFieldGroupCredentials,
  updateFieldGroup,
  type FieldGroupCredentials,
  type FieldGroupSummary,
  type FieldGroupTourSummary,
} from "../data/fieldGroupApi.ts";
import type { PlatformAppContext } from "../platform/platformContract.ts";
import "./team-hub.css";

type TeamHubProps = {
  context: PlatformAppContext | null;
  online: boolean;
  onClose: () => void;
  onSelectTeam: (teamId: string) => void;
  onManageTeams: () => void;
  onAccessChanged: () => void;
};

type RequestState = "idle" | "loading" | "saving";

type IssuedCredentials = {
  groupId: string;
  credentials: FieldGroupCredentials;
};

function errorMessage(error: unknown) {
  if (error instanceof CampaignApiError) {
    if (error.code === "field_group_schema_unavailable") {
      return "Live-Gruppen sind serverseitig vorbereitet, aber die Datenbankmigration ist noch nicht ausgerollt.";
    }
    if (error.code === "join_security_unconfigured" || error.code === "join_security_unavailable") {
      return "Der sichere Gruppenbeitritt ist serverseitig gerade nicht verfügbar.";
    }
    if (error.code === "join_rate_limited") {
      return "Zu viele Beitrittsversuche. Bitte versuche es etwas später erneut.";
    }
    if (error.code === "join_unavailable") {
      return "Code oder QR-Zugang ist ungültig, widerrufen oder nicht mehr aktiv.";
    }
    if (error.status === 401) return "Für diese Aktion fehlt ein gültiger Zugriff.";
    if (error.status === 403) return "Diese Aktion ist mit deinem aktuellen Zugriff nicht erlaubt.";
    return error.message;
  }
  return "Die Live-Gruppen konnten nicht verarbeitet werden.";
}

function durationLabel(startedAt: string, endedAt = new Date().toISOString()) {
  const seconds = Math.max(0, Math.floor((Date.parse(endedAt) - Date.parse(startedAt)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours} Std. ${minutes} Min.` : `${minutes} Min.`;
}

function personTimeLabel(personSeconds: number) {
  const minutes = Math.round(personSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours} Std. ${rest} Min.` : `${rest} Min.`;
}

export function TeamHub({
  context,
  online,
  onClose,
  onSelectTeam,
  onManageTeams,
  onAccessChanged,
}: TeamHubProps) {
  const campaignId = context?.campaignId ?? null;
  const [groups, setGroups] = useState<FieldGroupSummary[]>([]);
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    context?.activeGroupId ?? null,
  );
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newTeamId, setNewTeamId] = useState(context?.activeTeam?.id ?? "");
  const [newDiscoverable, setNewDiscoverable] = useState(true);
  const [participantCount, setParticipantCount] = useState("1");
  const [issuedCredentials, setIssuedCredentials] = useState<IssuedCredentials | null>(null);
  const [tourSummary, setTourSummary] = useState<FieldGroupTourSummary | null>(null);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );
  const activeTeam = context?.activeTeam ?? null;
  const currentTeamIds = context?.teams.map((team) => team.id) ?? [];
  const canManageGroup = useCallback(
    (group: FieldGroupSummary) =>
      context?.accessRole === "admin" ||
      (context?.accessRole === "team-editor" && context.accessTeamId === group.teamId),
    [context?.accessRole, context?.accessTeamId],
  );
  const canCreateGroup =
    context?.accessRole === "admin" || context?.accessRole === "team-editor";

  const loadGroups = useCallback(async () => {
    if (!campaignId || !context?.accessRole || !online) return;
    setRequestState("loading");
    setError(null);
    try {
      const next = await fetchFieldGroups(
        campaignId,
        teamFilter === "all" ? null : teamFilter,
      );
      setGroups(next);
      const preferred = context.activeGroupId ?? selectedGroupId;
      if (preferred && next.some((group) => group.id === preferred)) {
        setSelectedGroupId(preferred);
      } else if (selectedGroupId && !next.some((group) => group.id === selectedGroupId)) {
        setSelectedGroupId(null);
      }
    } catch (loadError) {
      if (loadError instanceof CampaignApiError && loadError.status === 401) {
        setGroups([]);
      } else {
        setError(errorMessage(loadError));
      }
    } finally {
      setRequestState("idle");
    }
  }, [campaignId, context?.accessRole, context?.activeGroupId, online, selectedGroupId, teamFilter]);

  useEffect(() => {
    if (context?.activeTeam?.id && currentTeamIds.includes(context.activeTeam.id)) {
      setNewTeamId(context.activeTeam.id);
    } else if (!newTeamId && currentTeamIds[0]) {
      setNewTeamId(currentTeamIds[0]);
    }
  }, [context?.activeTeam?.id, currentTeamIds.join("|"), newTeamId]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (!campaignId || !online) return;
    const qrToken = fieldGroupQrTokenFromUrl();
    if (!qrToken) return;
    let cancelled = false;
    setRequestState("saving");
    setError(null);
    void joinFieldGroup(campaignId, "qr", qrToken)
      .then((result) => {
        if (cancelled) return;
        removeFieldGroupQrTokenFromUrl();
        setGroups((current) => {
          const rest = current.filter((group) => group.id !== result.group.id);
          return [result.group, ...rest];
        });
        setSelectedGroupId(result.group.id);
        onSelectTeam(result.group.teamId);
        onAccessChanged();
      })
      .catch((joinError) => {
        if (!cancelled) setError(errorMessage(joinError));
      })
      .finally(() => {
        if (!cancelled) setRequestState("idle");
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, online, onAccessChanged, onSelectTeam]);

  const perform = async (action: () => Promise<void>) => {
    if (requestState === "saving") return;
    setRequestState("saving");
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setRequestState("idle");
    }
  };

  const submitJoin = () =>
    perform(async () => {
      if (!campaignId || !joinCode.trim()) return;
      if (!online) throw new CampaignApiError(0, "network_error", "Ein neuer Beitritt benötigt Internet.");
      const result = await joinFieldGroup(campaignId, "room-code", joinCode);
      setJoinCode("");
      setGroups((current) => [result.group, ...current.filter((group) => group.id !== result.group.id)]);
      setSelectedGroupId(result.group.id);
      onSelectTeam(result.group.teamId);
      onAccessChanged();
    });

  const submitCreate = () =>
    perform(async () => {
      if (!campaignId || !newTeamId || !newLabel.trim()) return;
      const parsedParticipants = Number(participantCount);
      const created = await createFieldGroup(campaignId, {
        label: newLabel,
        teamId: newTeamId,
        discoverable: newDiscoverable,
        participantCount:
          Number.isSafeInteger(parsedParticipants) && parsedParticipants >= 1
            ? parsedParticipants
            : null,
      });
      setIssuedCredentials({ groupId: created.group.id, credentials: created.credentials });
      setGroups((current) => [created.group, ...current.filter((group) => group.id !== created.group.id)]);
      setSelectedGroupId(created.group.id);
      setNewLabel("");
      onSelectTeam(created.group.teamId);
    });

  const refreshSelected = async (groupId: string) => {
    if (!campaignId) return;
    const group = await fetchFieldGroup(campaignId, groupId);
    setGroups((current) => [group, ...current.filter((item) => item.id !== group.id)]);
  };

  const updateParticipants = () =>
    perform(async () => {
      if (!campaignId || !selectedGroup) return;
      const count = Number(participantCount);
      if (!Number.isSafeInteger(count) || count < 1 || count > 500) {
        throw new CampaignApiError(400, "invalid_participant_count", "Teilnehmerzahl muss zwischen 1 und 500 liegen.");
      }
      const updated = await updateFieldGroup(campaignId, selectedGroup.id, { participantCount: count });
      setGroups((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
    });

  const toggleDiscoverability = () =>
    perform(async () => {
      if (!campaignId || !selectedGroup) return;
      const updated = await updateFieldGroup(campaignId, selectedGroup.id, {
        discoverable: !selectedGroup.discoverable,
      });
      setGroups((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
    });

  const rotateCredentials = () =>
    perform(async () => {
      if (!campaignId || !selectedGroup) return;
      if (!window.confirm("Alte Room-Codes und QR-Zugänge funktionieren danach nicht mehr. Fortfahren?")) return;
      const rotated = await rotateFieldGroupCredentials(campaignId, selectedGroup.id);
      setIssuedCredentials({ groupId: selectedGroup.id, credentials: rotated.credentials });
      await refreshSelected(selectedGroup.id);
    });

  const revokeCredentials = () =>
    perform(async () => {
      if (!campaignId || !selectedGroup) return;
      if (!window.confirm("Neue Beitritte werden gesperrt, bestehende Mitglieder bleiben verbunden. Fortfahren?")) return;
      const updated = await revokeFieldGroupCredentials(campaignId, selectedGroup.id);
      setGroups((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
      setIssuedCredentials(null);
    });

  const closeCurrentGroup = () =>
    perform(async () => {
      if (!campaignId || !selectedGroup) return;
      const count = Number(participantCount || selectedGroup.participantCount);
      if (!Number.isSafeInteger(count) || count < 1 || count > 500) {
        throw new CampaignApiError(422, "final_participant_count_required", "Zum Schließen ist die finale Teilnehmerzahl erforderlich.");
      }
      if (!window.confirm("Einsatz wirklich beenden? Neue Beitritte werden sofort gesperrt.")) return;
      const result = await closeFieldGroup(campaignId, selectedGroup.id, count);
      setTourSummary(result.tourSummary);
      if (result.group) {
        setGroups((current) => [result.group, ...current.filter((item) => item.id !== result.group.id)]);
      }
      setIssuedCredentials(null);
      onAccessChanged();
    });

  const leaveCurrentGroup = () =>
    perform(async () => {
      if (!campaignId || !selectedGroup) return;
      await leaveFieldGroup(campaignId, selectedGroup.id);
      setSelectedGroupId(null);
      setIssuedCredentials(null);
      onAccessChanged();
      await loadGroups();
    });

  const progress = useMemo(() => {
    if (!activeTeam) return null;
    return null;
  }, [activeTeam]);

  return (
    <div className="team-hub-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="team-hub"
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-hub-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="team-hub-handle" aria-hidden="true" />
        <header className="team-hub-header">
          <div>
            <span>Aktionsteam</span>
            <strong id="team-hub-title">Team Hub</strong>
          </div>
          <button type="button" className="team-hub-close" onClick={onClose} aria-label="Team Hub schließen">×</button>
        </header>

        {!online ? (
          <div className="team-hub-notice is-offline" role="status">
            Offline: bestehende Kartenarbeit bleibt verfügbar, neuer Gruppenbeitritt und Live-Verwaltung benötigen Internet.
          </div>
        ) : null}
        {error ? (
          <div className="team-hub-notice is-error" role="alert">
            <span>{error}</span>
            {context?.accessRole ? <button type="button" onClick={() => void loadGroups()}>Erneut laden</button> : null}
          </div>
        ) : null}

        <div className="team-hub-scroll">
          <section className="team-hub-card team-hub-current-team">
            <div className="team-hub-card-title">
              <div>
                <span>Aktuelles Team</span>
                <strong>{activeTeam?.name ?? "Noch kein Team aktiv"}</strong>
              </div>
              <span
                className="team-hub-team-dot"
                style={{ backgroundColor: activeTeam?.color ?? "#64748b" }}
                aria-hidden="true"
              />
            </div>

            {context && context.teams.length > 1 && context.accessRole === "admin" ? (
              <label className="team-hub-field">
                <span>Team wechseln</span>
                <select
                  value={activeTeam?.id ?? ""}
                  onChange={(event) => onSelectTeam(event.target.value)}
                >
                  {context.teams.map((team) => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="team-hub-meta-row">
              <span>Zugriff</span>
              <strong>
                {context?.accessRole === "admin"
                  ? "Admin"
                  : context?.accessRole === "team-editor"
                    ? "Team Editor"
                    : context?.accessRole === "field-group-member"
                      ? "Temporäres Gruppenmitglied"
                      : context?.accessRole === "viewer"
                        ? "Nur ansehen"
                        : "Noch nicht verbunden"}
              </strong>
            </div>
            {progress ? <div>{progress}</div> : null}
            {context?.canManageTeams ? (
              <button className="team-hub-secondary" type="button" onClick={onManageTeams}>
                Teams verwalten
              </button>
            ) : null}
          </section>

          <section className="team-hub-card">
            <div className="team-hub-section-heading">
              <div>
                <span>Beitreten</span>
                <strong>Room Code</strong>
              </div>
              <span className={`team-hub-online-dot ${online ? "is-online" : ""}`} aria-hidden="true" />
            </div>
            <form
              className="team-hub-inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitJoin();
              }}
            >
              <input
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="z. B. 7K9M-4R2X-PQ"
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={16}
                aria-label="Room Code"
              />
              <button type="submit" disabled={!online || !campaignId || !joinCode.trim() || requestState === "saving"}>
                Beitreten
              </button>
            </form>
            <p>QR-Links öffnen diesen Flow automatisch. Die manuelle Eingabe bleibt immer verfügbar.</p>
          </section>

          {canCreateGroup ? (
            <section className="team-hub-card">
              <div className="team-hub-section-heading">
                <div>
                  <span>Neuer Einsatz</span>
                  <strong>Gruppe erstellen</strong>
                </div>
              </div>
              <div className="team-hub-form-grid">
                <label className="team-hub-field">
                  <span>Gruppenname</span>
                  <input
                    value={newLabel}
                    onChange={(event) => setNewLabel(event.target.value)}
                    maxLength={80}
                    placeholder="z. B. Nordrunde"
                  />
                </label>
                <label className="team-hub-field">
                  <span>Team</span>
                  <select value={newTeamId} onChange={(event) => setNewTeamId(event.target.value)}>
                    {(context?.teams ?? [])
                      .filter(
                        (team) =>
                          context?.accessRole === "admin" || team.id === context?.accessTeamId,
                      )
                      .map((team) => (
                        <option key={team.id} value={team.id}>{team.name}</option>
                      ))}
                  </select>
                </label>
                <label className="team-hub-field">
                  <span>Personen</span>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={participantCount}
                    onChange={(event) => setParticipantCount(event.target.value)}
                  />
                </label>
                <label className="team-hub-check">
                  <input
                    type="checkbox"
                    checked={newDiscoverable}
                    onChange={(event) => setNewDiscoverable(event.target.checked)}
                  />
                  <span>Online anzeigen</span>
                </label>
              </div>
              <button
                className="team-hub-primary"
                type="button"
                disabled={!online || !newLabel.trim() || !newTeamId || requestState === "saving"}
                onClick={() => void submitCreate()}
              >
                Gruppe erstellen
              </button>
            </section>
          ) : null}

          {issuedCredentials ? (
            <section className="team-hub-card team-hub-credentials" aria-live="polite">
              <div className="team-hub-section-heading">
                <div>
                  <span>Join-Zugang</span>
                  <strong>Jetzt teilen</strong>
                </div>
              </div>
              <div className="team-hub-room-code">{issuedCredentials.credentials.roomCode}</div>
              {campaignId ? (
                <div className="team-hub-qr">
                  <QRCodeSVG
                    value={buildFieldGroupQrJoinUrl(campaignId, issuedCredentials.credentials.qrToken)}
                    size={176}
                    level="M"
                    title="QR-Code zum Beitreten"
                  />
                </div>
              ) : null}
              <p>Der Code und QR-Zugang werden nur jetzt angezeigt. Nach Rotation funktionieren die alten Daten sofort nicht mehr.</p>
            </section>
          ) : null}

          <section className="team-hub-card">
            <div className="team-hub-section-heading">
              <div>
                <span>Online-Gruppen</span>
                <strong>Aktiv in der Aktion</strong>
              </div>
              <button className="team-hub-icon-action" type="button" onClick={() => void loadGroups()} disabled={!online || requestState === "loading"} aria-label="Gruppen aktualisieren">↻</button>
            </div>

            {context?.accessRole && context.accessRole !== "field-group-member" ? (
              <label className="team-hub-field team-hub-filter">
                <span>Filter</span>
                <select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
                  <option value="all">Alle in der Aktion</option>
                  {(context?.teams ?? []).map((team) => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
              </label>
            ) : null}

            {requestState === "loading" ? <div className="team-hub-empty">Gruppen werden geladen ...</div> : null}
            {requestState !== "loading" && groups.length === 0 ? (
              <div className="team-hub-empty">
                {context?.accessRole ? "Aktuell ist keine sichtbare Gruppe online." : "Mit Room Code oder QR kannst du einer Gruppe beitreten."}
              </div>
            ) : null}
            <div className="team-hub-group-list">
              {groups.map((group) => (
                <button
                  className={`team-hub-group-item ${selectedGroupId === group.id ? "is-selected" : ""}`}
                  type="button"
                  key={group.id}
                  onClick={() => {
                    setSelectedGroupId(group.id);
                    setParticipantCount(String(group.participantCount ?? 1));
                    onSelectTeam(group.teamId);
                  }}
                >
                  <span className="team-hub-team-dot" style={{ backgroundColor: group.teamColor }} aria-hidden="true" />
                  <span>
                    <strong>{group.label}</strong>
                    <small>{group.teamName} · {group.membershipCount} verbunden</small>
                  </span>
                  <em>{group.joinAvailable ? "Join offen" : "Join gesperrt"}</em>
                </button>
              ))}
            </div>
          </section>

          {selectedGroup ? (
            <section className="team-hub-card team-hub-active-group">
              <div className="team-hub-card-title">
                <div>
                  <span>{selectedGroup.state === "active" ? "Aktiver Einsatz" : "Einsatz"}</span>
                  <strong>{selectedGroup.label}</strong>
                </div>
                <span className={`team-hub-state is-${selectedGroup.state}`}>{selectedGroup.state}</span>
              </div>
              <div className="team-hub-info-grid">
                <div><span>Team</span><strong>{selectedGroup.teamName}</strong></div>
                <div><span>Läuft seit</span><strong>{durationLabel(selectedGroup.createdAt, selectedGroup.closedAt ?? undefined)}</strong></div>
                <div><span>Personen</span><strong>{selectedGroup.participantCount ?? "Offen"}</strong></div>
                <div><span>Sync</span><strong>{online ? "Online" : "Offline"}</strong></div>
              </div>

              {canManageGroup(selectedGroup) && selectedGroup.state === "active" ? (
                <div className="team-hub-management">
                  <label className="team-hub-field">
                    <span>Teilnehmerzahl</span>
                    <div className="team-hub-inline-form">
                      <input
                        type="number"
                        min={1}
                        max={500}
                        value={participantCount}
                        onChange={(event) => setParticipantCount(event.target.value)}
                      />
                      <button type="button" onClick={() => void updateParticipants()} disabled={!online || requestState === "saving"}>Speichern</button>
                    </div>
                  </label>
                  <button className="team-hub-secondary" type="button" onClick={() => void toggleDiscoverability()} disabled={!online || requestState === "saving"}>
                    {selectedGroup.discoverable ? "Aus Online-Liste ausblenden" : "Online anzeigen"}
                  </button>
                  <div className="team-hub-action-grid">
                    <button type="button" onClick={() => void rotateCredentials()} disabled={!online || requestState === "saving"}>Join-Zugang rotieren</button>
                    <button type="button" onClick={() => void revokeCredentials()} disabled={!online || requestState === "saving"}>Join sperren</button>
                  </div>
                  <button className="team-hub-danger" type="button" onClick={() => void closeCurrentGroup()} disabled={!online || requestState === "saving"}>
                    Einsatz beenden
                  </button>
                </div>
              ) : null}

              {(context?.activeGroupId === selectedGroup.id || context?.accessRole === "field-group-member") && selectedGroup.state === "active" ? (
                <button className="team-hub-secondary" type="button" onClick={() => void leaveCurrentGroup()} disabled={!online || requestState === "saving"}>
                  Gruppe verlassen
                </button>
              ) : null}
            </section>
          ) : null}

          {tourSummary ? (
            <section className="team-hub-card team-hub-summary" aria-live="polite">
              <span>Einsatz abgeschlossen</span>
              <strong>{durationLabel(tourSummary.startedAt, tourSummary.endedAt)}</strong>
              <p>{tourSummary.participantCount} Personen, {personTimeLabel(tourSummary.personSeconds)} Personenzeit.</p>
              <p className="team-hub-muted">Die dauerhafte Field-Session-Historie wird erst nach dem separaten Retention-/Event-Gate gespeichert.</p>
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
}
