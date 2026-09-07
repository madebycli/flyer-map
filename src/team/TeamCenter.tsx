import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CampaignApiError } from "../data/campaignApi.ts";
import {
  buildFieldGroupQrJoinUrl,
  closeFieldGroup,
  createFieldGroup,
  createFieldGroupRequestId,
  fetchFieldGroup,
  fetchFieldGroups,
  joinFieldGroup,
  leaveFieldGroup,
  revokeFieldGroupCredentials,
  rotateFieldGroupCredentials,
  updateFieldGroup,
  type FieldGroupCredentials,
  type FieldGroupSummary,
} from "../data/fieldGroupApi.ts";
import type { PlatformAppContext } from "../platform/platformContract.ts";
import { FieldGroupMembersPanel } from "./FieldGroupMembersPanel.tsx";
import { TeamCommentsSummary } from "./TeamCommentsSummary.tsx";
import { TeamProgressPanel } from "./TeamProgressPanel.tsx";
import "./team-center.css";

type Props = {
  context: PlatformAppContext | null;
  online: boolean;
  onClose: () => void;
  onSelectTeam: (teamId: string) => void;
  onManageTeams: () => void;
  onAccessChanged: () => void;
  onOperationalGroupChange: (groupId: string | null) => void;
};

type View = "overview" | "rooms" | "progress" | "comments";
type RequestState = "idle" | "loading" | "saving";

type IssuedAccess = {
  group: FieldGroupSummary;
  credentials: FieldGroupCredentials;
};

function errorMessage(error: unknown) {
  if (error instanceof CampaignApiError) {
    if (error.code === "join_rate_limited") return "Zu viele Beitrittsversuche. Bitte etwas später erneut versuchen.";
    if (error.code === "join_unavailable") return "Room-Code oder Link ist ungültig, gesperrt oder abgelaufen.";
    if (error.code === "join_security_unconfigured" || error.code === "join_security_unavailable") return "Der sichere Room-Beitritt ist gerade nicht verfügbar.";
    if (error.status === 401) return "Für diese Aktion fehlt ein gültiger Zugriff.";
    if (error.status === 403) return "Dieser Room liegt außerhalb deines Zugriffs.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Der Room konnte nicht verarbeitet werden.";
}

function normalizedLabel(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

function durationLabel(startedAt: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours} Std. ${minutes} Min.` : `${minutes} Min.`;
}

function Modal({
  title,
  kicker,
  onClose,
  children,
}: {
  title: string;
  kicker: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="team-center-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="team-center-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>{kicker}</span><strong>{title}</strong></div>
          <button type="button" onClick={onClose} aria-label="Dialog schließen">×</button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function TeamCenter({
  context,
  online,
  onClose,
  onSelectTeam,
  onManageTeams,
  onAccessChanged,
  onOperationalGroupChange,
}: Props) {
  const campaignId = context?.campaignId ?? null;
  const [view, setView] = useState<View>("overview");
  const [groups, setGroups] = useState<FieldGroupSummary[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(context?.activeGroupId ?? null);
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newTeamId, setNewTeamId] = useState(context?.activeTeam?.id ?? context?.teams[0]?.id ?? "");
  const [newDiscoverable, setNewDiscoverable] = useState(true);
  const [participantCount, setParticipantCount] = useState("1");
  const [issuedAccess, setIssuedAccess] = useState<IssuedAccess | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const retryRequestIds = useRef(new Map<string, string>());

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );
  const activeTeam = context?.activeTeam ?? null;
  const accessibleTeams = useMemo(
    () => (context?.teams ?? []).filter((team) => context?.accessRole === "admin" || team.id === context?.accessTeamId),
    [context?.accessRole, context?.accessTeamId, context?.teams],
  );
  const canCreateRoom = context?.accessRole === "admin" || context?.accessRole === "team-editor";
  const canManageGroup = useCallback(
    (group: FieldGroupSummary) =>
      context?.accessRole === "admin" ||
      (context?.accessRole === "team-editor" && context.accessTeamId === group.teamId),
    [context?.accessRole, context?.accessTeamId],
  );

  useEffect(() => {
    if (activeTeam?.id && accessibleTeams.some((team) => team.id === activeTeam.id)) setNewTeamId(activeTeam.id);
    else if (!accessibleTeams.some((team) => team.id === newTeamId)) setNewTeamId(accessibleTeams[0]?.id ?? "");
  }, [accessibleTeams, activeTeam?.id, newTeamId]);

  const loadGroups = useCallback(async () => {
    if (!campaignId || !context?.accessRole || !online) return;
    setRequestState("loading");
    setError(null);
    try {
      const next = await fetchFieldGroups(campaignId);
      setGroups(next);
      const preferred = context.activeGroupId ?? selectedGroupId;
      if (preferred && next.some((group) => group.id === preferred)) setSelectedGroupId(preferred);
      else if (selectedGroupId && !next.some((group) => group.id === selectedGroupId)) setSelectedGroupId(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setRequestState("idle");
    }
  }, [campaignId, context?.accessRole, context?.activeGroupId, online, selectedGroupId]);

  useEffect(() => {
    if (view === "rooms") void loadGroups();
  }, [loadGroups, view]);

  const perform = async (action: () => Promise<void>) => {
    if (requestState === "saving") return;
    setRequestState("saving");
    setError(null);
    setStatusMessage(null);
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setRequestState("idle");
    }
  };

  const requestIdFor = (key: string, scope: string) => {
    const existing = retryRequestIds.current.get(key);
    if (existing) return existing;
    const next = createFieldGroupRequestId(scope);
    retryRequestIds.current.set(key, next);
    return next;
  };

  const submitJoin = () => perform(async () => {
    if (!campaignId || !joinCode.trim()) return;
    if (!online) throw new CampaignApiError(0, "network_error", "Room-Beitritt benötigt Internet.");
    const result = await joinFieldGroup(campaignId, "room-code", joinCode);
    setGroups((current) => [result.group, ...current.filter((group) => group.id !== result.group.id)]);
    setSelectedGroupId(result.group.id);
    onOperationalGroupChange(result.group.id);
    onSelectTeam(result.group.teamId);
    setJoinCode("");
    setJoinOpen(false);
    setStatusMessage(`Du bist „${result.group.label}“ beigetreten.`);
    onAccessChanged();
  });

  const submitCreate = () => perform(async () => {
    if (!campaignId || !newTeamId || !newLabel.trim()) return;
    const parsed = Number(participantCount);
    const participants = Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 500 ? parsed : null;
    const createKey = JSON.stringify([campaignId, newTeamId, normalizedLabel(newLabel), newDiscoverable, participants]);
    const requestId = requestIdFor(createKey, "create");
    const created = await createFieldGroup(campaignId, {
      label: newLabel,
      teamId: newTeamId,
      discoverable: newDiscoverable,
      participantCount: participants,
    }, requestId);
    retryRequestIds.current.delete(createKey);
    setGroups((current) => [created.group, ...current.filter((group) => group.id !== created.group.id)]);
    setSelectedGroupId(created.group.id);
    onOperationalGroupChange(created.group.id);
    onSelectTeam(created.group.teamId);
    setNewLabel("");
    setCreateOpen(false);
    if (created.credentials) {
      setIssuedAccess({ group: created.group, credentials: created.credentials });
    } else {
      setStatusMessage("Room wurde erstellt. Ein neuer Join-Zugang kann in den Room-Details erzeugt werden.");
    }
  });

  const refreshSelected = async (groupId: string) => {
    if (!campaignId) return;
    const group = await fetchFieldGroup(campaignId, groupId);
    setGroups((current) => [group, ...current.filter((item) => item.id !== group.id)]);
  };

  const toggleDiscoverability = () => perform(async () => {
    if (!campaignId || !selectedGroup) return;
    const updated = await updateFieldGroup(campaignId, selectedGroup.id, { discoverable: !selectedGroup.discoverable });
    setGroups((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
    setStatusMessage(updated.discoverable
      ? "Room wird jetzt in der Online-Liste angezeigt. Code und Link bleiben unverändert."
      : "Room ist aus der Online-Liste ausgeblendet. Code und Link funktionieren weiterhin.");
  });

  const updateParticipants = () => perform(async () => {
    if (!campaignId || !selectedGroup) return;
    const count = Number(participantCount);
    if (!Number.isSafeInteger(count) || count < 1 || count > 500) throw new Error("Teilnehmerzahl muss zwischen 1 und 500 liegen.");
    const updated = await updateFieldGroup(campaignId, selectedGroup.id, { participantCount: count });
    setGroups((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
  });

  const rotateCredentials = () => perform(async () => {
    if (!campaignId || !selectedGroup) return;
    if (!window.confirm("Alte Room-Codes und QR-Links werden sofort ungültig. Neue Zugangsdaten erzeugen?")) return;
    const key = `rotate:${campaignId}:${selectedGroup.id}`;
    const result = await rotateFieldGroupCredentials(campaignId, selectedGroup.id, requestIdFor(key, "rotate"));
    retryRequestIds.current.delete(key);
    await refreshSelected(selectedGroup.id);
    if (result.credentials) setIssuedAccess({ group: result.group, credentials: result.credentials });
    else setStatusMessage("Rotation wurde bereits angewendet. Starte sie erneut, wenn du neue Zugangsdaten brauchst.");
  });

  const revokeCredentials = () => perform(async () => {
    if (!campaignId || !selectedGroup) return;
    if (!window.confirm("Neue Beitritte über Code und QR werden gesperrt. Bestehende Mitglieder bleiben verbunden.")) return;
    const updated = await revokeFieldGroupCredentials(campaignId, selectedGroup.id);
    setGroups((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
    setIssuedAccess(null);
  });

  const closeRoom = () => perform(async () => {
    if (!campaignId || !selectedGroup) return;
    const count = Number(participantCount || selectedGroup.participantCount);
    if (!Number.isSafeInteger(count) || count < 1 || count > 500) throw new Error("Zum Beenden ist eine Teilnehmerzahl zwischen 1 und 500 nötig.");
    if (!window.confirm("Room wirklich beenden? Neue Beitritte werden sofort gesperrt.")) return;
    const result = await closeFieldGroup(campaignId, selectedGroup.id, count);
    setGroups((current) => current.filter((item) => item.id !== selectedGroup.id));
    setSelectedGroupId(null);
    onOperationalGroupChange(null);
    setStatusMessage(`„${result.group.label}“ wurde beendet.`);
    onAccessChanged();
  });

  const leaveRoom = () => perform(async () => {
    if (!campaignId || !selectedGroup) return;
    await leaveFieldGroup(campaignId, selectedGroup.id);
    setSelectedGroupId(null);
    onOperationalGroupChange(null);
    onAccessChanged();
    await loadGroups();
  });

  const issuedJoinUrl = issuedAccess && campaignId
    ? buildFieldGroupQrJoinUrl(campaignId, issuedAccess.credentials.qrToken)
    : null;

  const copyValue = async (kind: "code" | "link", value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="team-center-overlay" role="presentation" onMouseDown={onClose}>
      <section className="team-center" role="dialog" aria-modal="true" aria-labelledby="team-center-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="team-center-header">
          <div><span>Team-Zentrale</span><strong id="team-center-title">{activeTeam?.name ?? "Team"}</strong></div>
          <button type="button" onClick={onClose} aria-label="Team-Zentrale schließen">×</button>
        </header>

        <nav className="team-center-tabs" aria-label="Team-Bereiche">
          {([
            ["overview", "Übersicht"],
            ["rooms", "Rooms"],
            ["progress", "Fortschritt"],
            ["comments", "Kommentare"],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" className={view === id ? "is-active" : ""} onClick={() => setView(id)}>{label}</button>
          ))}
        </nav>

        {!online ? <div className="team-center-notice">Offline: Kartenarbeit bleibt möglich. Room-Verwaltung und Kommentar-Zusammenfassung benötigen Internet.</div> : null}
        {statusMessage ? <div className="team-center-notice is-success" role="status">{statusMessage}</div> : null}
        {error ? <div className="team-center-error" role="alert">{error}</div> : null}

        <div className="team-center-scroll">
          {view === "overview" ? (
            <div className="team-center-view">
              <section className="team-center-card">
                <div className="team-center-section-heading">
                  <div><span>Aktuelles Team</span><strong>{activeTeam?.name ?? "Noch kein Team aktiv"}</strong></div>
                  <span className="team-center-team-dot" style={{ backgroundColor: activeTeam?.color ?? "#64748b" }} aria-hidden="true" />
                </div>
                {context && accessibleTeams.length > 1 ? (
                  <label className="team-center-field"><span>Team wechseln</span><select value={activeTeam?.id ?? ""} onChange={(event) => onSelectTeam(event.target.value)}>{accessibleTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
                ) : null}
                <div className="team-center-quick-grid">
                  <button type="button" onClick={() => setView("rooms")}><span>🚐</span><strong>Rooms</strong><small>Beitreten, erstellen, unterwegs</small></button>
                  <button type="button" onClick={() => setView("progress")}><span>📊</span><strong>Fortschritt</strong><small>Nur für dieses Team</small></button>
                  <button type="button" onClick={() => setView("comments")}><span>💬</span><strong>Kommentare</strong><small>Nach Gebieten sortiert</small></button>
                </div>
                {context?.canManageTeams ? <button className="team-center-secondary" type="button" onClick={onManageTeams}>Teams verwalten</button> : null}
              </section>
            </div>
          ) : null}

          {view === "rooms" ? (
            <div className="team-center-view">
              <section className="team-center-actions-card">
                <button className="team-center-primary" type="button" disabled={!online} onClick={() => setJoinOpen(true)}><span>⌨️</span><strong>Room beitreten</strong><small>Room-Code eingeben</small></button>
                {canCreateRoom ? <button className="team-center-secondary-card" type="button" disabled={!online} onClick={() => setCreateOpen(true)}><span>＋</span><strong>Room erstellen</strong><small>Code & QR werden sofort erzeugt</small></button> : null}
              </section>

              <section className="team-center-card">
                <div className="team-center-section-heading">
                  <div><span>Aktive unterwegs</span><strong>{groups.length} Rooms</strong></div>
                  <button className="team-center-icon-button" type="button" disabled={!online || requestState === "loading"} onClick={() => void loadGroups()} aria-label="Rooms aktualisieren">↻</button>
                </div>
                {requestState === "loading" ? <div className="team-center-empty">Rooms werden geladen …</div> : null}
                {requestState !== "loading" && groups.length === 0 ? <div className="team-center-empty">Noch kein aktiver Room.</div> : null}
                <div className="team-center-room-list">
                  {groups.map((group) => (
                    <button key={group.id} type="button" className={selectedGroupId === group.id ? "is-selected" : ""} onClick={() => {
                      setSelectedGroupId(group.id);
                      setParticipantCount(String(group.participantCount ?? 1));
                      onOperationalGroupChange(group.id);
                      onSelectTeam(group.teamId);
                    }}>
                      <span className="team-center-team-dot" style={{ backgroundColor: group.teamColor }} aria-hidden="true" />
                      <span><strong>{group.label}</strong><small>{group.teamName} · {group.membershipCount} verbunden</small></span>
                      <em className={group.discoverable ? "is-visible" : "is-hidden"}>{group.discoverable ? "Online sichtbar" : "Nicht gelistet"}</em>
                    </button>
                  ))}
                </div>
              </section>

              {selectedGroup ? (
                <section className="team-center-card team-center-room-detail">
                  <div className="team-center-section-heading"><div><span>Room-Details</span><strong>{selectedGroup.label}</strong></div><span className="team-center-pill">{durationLabel(selectedGroup.createdAt)}</span></div>
                  <div className="team-center-info-grid">
                    <div><span>Team</span><strong>{selectedGroup.teamName}</strong></div>
                    <div><span>Join</span><strong>{selectedGroup.joinAvailable ? "Offen" : "Gesperrt"}</strong></div>
                    <div><span>Liste</span><strong>{selectedGroup.discoverable ? "Online sichtbar" : "Versteckt"}</strong></div>
                    <div><span>Personen</span><strong>{selectedGroup.participantCount ?? "Offen"}</strong></div>
                  </div>
                  {canManageGroup(selectedGroup) ? (
                    <div className="team-center-management">
                      <label className="team-center-field"><span>Teilnehmerzahl</span><div className="team-center-inline"><input type="number" min={1} max={500} value={participantCount} onChange={(event) => setParticipantCount(event.target.value)} /><button type="button" disabled={!online || requestState === "saving"} onClick={() => void updateParticipants()}>Speichern</button></div></label>
                      <button className="team-center-secondary" type="button" disabled={!online || requestState === "saving"} onClick={() => void toggleDiscoverability()}>{selectedGroup.discoverable ? "Aus Online-Liste ausblenden" : "In Online-Liste anzeigen"}</button>
                      <p className="team-center-help">Diese Einstellung ändert nur die Auffindbarkeit. Room-Code und QR-Link funktionieren in beiden Zuständen.</p>
                      <div className="team-center-action-grid"><button type="button" onClick={() => void rotateCredentials()} disabled={!online || requestState === "saving"}>Neuen Join-Zugang</button><button type="button" onClick={() => void revokeCredentials()} disabled={!online || requestState === "saving"}>Join sperren</button></div>
                      {campaignId ? <FieldGroupMembersPanel campaignId={campaignId} groupId={selectedGroup.id} online={online} onChanged={() => refreshSelected(selectedGroup.id)} /> : null}
                      <button className="team-center-danger" type="button" disabled={!online || requestState === "saving"} onClick={() => void closeRoom()}>Room beenden</button>
                    </div>
                  ) : null}
                  {(context?.activeGroupId === selectedGroup.id || context?.accessRole === "field-group-member") ? <button className="team-center-secondary" type="button" disabled={!online || requestState === "saving"} onClick={() => void leaveRoom()}>Room verlassen</button> : null}
                </section>
              ) : null}
            </div>
          ) : null}

          {view === "progress" ? (
            <div className="team-center-view">
              <section className="team-center-card">
                <div className="team-center-section-heading"><div><span>Team-Stats</span><strong>{activeTeam?.name ?? "Team"}</strong></div><span className="team-center-team-dot" style={{ backgroundColor: activeTeam?.color ?? "#64748b" }} /></div>
                {accessibleTeams.length > 1 ? <label className="team-center-field"><span>Team</span><select value={activeTeam?.id ?? ""} onChange={(event) => onSelectTeam(event.target.value)}>{accessibleTeams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}</select></label> : null}
                <TeamProgressPanel campaignId={campaignId} teamId={activeTeam?.id ?? null} online={online} />
              </section>
            </div>
          ) : null}

          {view === "comments" && context ? (
            <div className="team-center-view"><section className="team-center-card"><TeamCommentsSummary context={context} online={online} onChanged={onAccessChanged} /></section></div>
          ) : null}
        </div>
      </section>

      {joinOpen ? (
        <Modal kicker="Room beitreten" title="Code eingeben" onClose={() => setJoinOpen(false)}>
          <p className="team-center-help">Der Room kann in der Online-Liste sichtbar oder versteckt sein. Ein gültiger Code funktioniert in beiden Fällen.</p>
          <form className="team-center-modal-form" onSubmit={(event) => { event.preventDefault(); void submitJoin(); }}>
            <label><span>Room-Code</span><input value={joinCode} autoFocus autoCapitalize="characters" autoComplete="off" maxLength={16} placeholder="z. B. 7K9M-4R2X-PQ" onChange={(event) => setJoinCode(event.target.value.toUpperCase())} /></label>
            <button className="team-center-primary" disabled={!online || !joinCode.trim() || requestState === "saving"}>Mit Code beitreten</button>
          </form>
        </Modal>
      ) : null}

      {createOpen ? (
        <Modal kicker="Neuer Einsatz" title="Room erstellen" onClose={() => setCreateOpen(false)}>
          <form className="team-center-modal-form" onSubmit={(event) => { event.preventDefault(); void submitCreate(); }}>
            <label><span>Room-Name</span><input value={newLabel} autoFocus maxLength={80} placeholder="z. B. Nordrunde" onChange={(event) => setNewLabel(event.target.value)} /></label>
            <label><span>Team</span><select value={newTeamId} onChange={(event) => setNewTeamId(event.target.value)}>{accessibleTeams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}</select></label>
            <label><span>Personen</span><input type="number" min={1} max={500} value={participantCount} onChange={(event) => setParticipantCount(event.target.value)} /></label>
            <label className="team-center-check"><input type="checkbox" checked={newDiscoverable} onChange={(event) => setNewDiscoverable(event.target.checked)} /><span><strong>In Online-Liste anzeigen</strong><small>Ausgeschaltet bleibt der Room trotzdem erstellt und per Code/QR erreichbar.</small></span></label>
            <button className="team-center-primary" disabled={!online || !newLabel.trim() || !newTeamId || requestState === "saving"}>Room erstellen</button>
          </form>
        </Modal>
      ) : null}

      {issuedAccess && issuedJoinUrl ? (
        <Modal kicker="Join-Zugang" title={issuedAccess.group.label} onClose={() => { setIssuedAccess(null); setCopied(null); }}>
          <p className="team-center-help">Code und QR-Link funktionieren unabhängig davon, ob der Room in der Online-Liste angezeigt wird. Die Zugangsdaten werden aus Sicherheitsgründen nur jetzt angezeigt.</p>
          <div className="team-center-room-code">{issuedAccess.credentials.roomCode}</div>
          <button className="team-center-secondary" type="button" onClick={() => void copyValue("code", issuedAccess.credentials.roomCode)}>{copied === "code" ? "Code kopiert ✓" : "Code kopieren"}</button>
          <div className="team-center-qr"><QRCodeSVG value={issuedJoinUrl} size={196} level="M" includeMargin title={`QR-Code: ${issuedAccess.group.label}`} /></div>
          <input className="team-center-link-input" readOnly value={issuedJoinUrl} aria-label="Room-Link" />
          <button className="team-center-primary" type="button" onClick={() => void copyValue("link", issuedJoinUrl)}>{copied === "link" ? "Link kopiert ✓" : "Link kopieren"}</button>
        </Modal>
      ) : null}
    </div>
  );
}
