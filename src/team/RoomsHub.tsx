
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
  revealFieldGroupCredentials,
  revokeFieldGroupCredentials,
  rotateFieldGroupCredentials,
  updateFieldGroup,
  type FieldGroupCredentials,
  type FieldGroupSummary,
} from "../data/fieldGroupApi.ts";
import { FieldBottomSheet } from "../platform/FieldBottomSheet.tsx";
import type { PlatformAppContext } from "../platform/platformContract.ts";
import { FieldGroupMembersPanel } from "./FieldGroupMembersPanel.tsx";
import "./team-center.css";

type Props = {
  context: PlatformAppContext | null;
  online: boolean;
  onClose: () => void;
  onSelectTeam: (teamId: string) => void;
  onAccessChanged: () => void;
  onOperationalGroupChange: (groupId: string | null) => void;
};

type RequestState = "idle" | "loading" | "saving";
type IssuedAccess = { group: FieldGroupSummary; credentials: FieldGroupCredentials };

function errorMessage(error: unknown) {
  if (error instanceof CampaignApiError) {
    if (error.code === "join_rate_limited") return "Zu viele Beitrittsversuche. Bitte etwas später erneut versuchen.";
    if (error.code === "join_unavailable") return "Room-Code oder Link ist ungültig, gesperrt oder abgelaufen.";
    if (error.code === "join_security_unconfigured" || error.code === "join_security_unavailable") return "Der sichere Room-Beitritt ist gerade nicht verfügbar.";
    if (error.code === "credential_recovery_unavailable") return "Dieser ältere Room besitzt noch keinen wiederanzeigbaren Join-Zugang. Erneuere den Join-Zugang, wenn du neue Daten brauchst.";
    if (error.code === "credential_recovery_unconfigured" || error.code === "credential_recovery_failed") return "Der aktuelle Join-Zugang kann gerade nicht sicher angezeigt werden.";
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

function Modal({ title, kicker, onClose, children }: { title: string; kicker: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="team-center-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="team-center-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>{kicker}</span><strong>{title}</strong></div><button type="button" onClick={onClose} aria-label="Dialog schließen">×</button></header>
        {children}
      </section>
    </div>
  );
}

export function RoomsHub({ context, online, onClose, onSelectTeam, onAccessChanged, onOperationalGroupChange }: Props) {
  const campaignId = context?.campaignId ?? null;
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

  const selectedGroup = useMemo(() => groups.find((group) => group.id === selectedGroupId) ?? null, [groups, selectedGroupId]);
  const accessibleTeams = useMemo(
    () => (context?.teams ?? []).filter((team) => context?.accessRole === "admin" || team.id === context?.accessTeamId),
    [context?.accessRole, context?.accessTeamId, context?.teams],
  );
  const canCreateRoom = context?.accessRole === "admin" || context?.accessRole === "team-editor";
  const canManageGroup = useCallback(
    (group: FieldGroupSummary) => context?.accessRole === "admin" || (context?.accessRole === "team-editor" && context.accessTeamId === group.teamId),
    [context?.accessRole, context?.accessTeamId],
  );

  useEffect(() => {
    if (context?.activeTeam?.id && accessibleTeams.some((team) => team.id === context.activeTeam?.id)) setNewTeamId(context.activeTeam.id);
    else if (!accessibleTeams.some((team) => team.id === newTeamId)) setNewTeamId(accessibleTeams[0]?.id ?? "");
  }, [accessibleTeams, context?.activeTeam?.id, newTeamId]);

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

  useEffect(() => { void loadGroups(); }, [loadGroups]);

  const perform = async (action: () => Promise<void>) => {
    if (requestState === "saving") return;
    setRequestState("saving");
    setError(null);
    setStatusMessage(null);
    try { await action(); } catch (cause) { setError(errorMessage(cause)); } finally { setRequestState("idle"); }
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
    const created = await createFieldGroup(campaignId, { label: newLabel, teamId: newTeamId, discoverable: newDiscoverable, participantCount: participants }, requestIdFor(createKey, "create"));
    retryRequestIds.current.delete(createKey);
    setGroups((current) => [created.group, ...current.filter((group) => group.id !== created.group.id)]);
    setSelectedGroupId(created.group.id);
    onOperationalGroupChange(created.group.id);
    onSelectTeam(created.group.teamId);
    setNewLabel("");
    setCreateOpen(false);
    if (created.credentials) setIssuedAccess({ group: created.group, credentials: created.credentials });
    else setStatusMessage("Room wurde erstellt. Der aktuelle Join-Zugang kann in den Room-Details angezeigt werden.");
  });

  const refreshSelected = async (groupId: string) => {
    if (!campaignId) return;
    const group = await fetchFieldGroup(campaignId, groupId);
    setGroups((current) => [group, ...current.filter((item) => item.id !== group.id)]);
  };

  const showCredentials = () => perform(async () => {
    if (!campaignId || !selectedGroup) return;
    const credentials = await revealFieldGroupCredentials(campaignId, selectedGroup.id);
    setIssuedAccess({ group: selectedGroup, credentials });
  });

  const toggleDiscoverability = () => perform(async () => {
    if (!campaignId || !selectedGroup) return;
    const updated = await updateFieldGroup(campaignId, selectedGroup.id, { discoverable: !selectedGroup.discoverable });
    setGroups((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
    setStatusMessage(updated.discoverable ? "Room wird jetzt in der Online-Liste angezeigt. Code und Link bleiben unverändert." : "Room ist aus der Online-Liste ausgeblendet. Code und Link funktionieren weiterhin.");
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
    if (!window.confirm("Alte Room-Codes und QR-Links werden für zukünftige Beitritte sofort ungültig. Bereits beigetretene Mitglieder bleiben aktiv. Join-Zugang wirklich erneuern?")) return;
    const key = `rotate:${campaignId}:${selectedGroup.id}`;
    const result = await rotateFieldGroupCredentials(campaignId, selectedGroup.id, requestIdFor(key, "rotate"));
    retryRequestIds.current.delete(key);
    await refreshSelected(selectedGroup.id);
    if (result.credentials) setIssuedAccess({ group: result.group, credentials: result.credentials });
    else setStatusMessage("Rotation wurde bereits angewendet. Der aktuelle Join-Zugang kann angezeigt werden.");
  });

  const revokeCredentials = () => perform(async () => {
    if (!campaignId || !selectedGroup) return;
    if (!window.confirm("Neue Beitritte über Code und QR werden gesperrt. Bereits beigetretene Mitglieder bleiben aktiv. Join wirklich sperren?")) return;
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

  const issuedJoinUrl = issuedAccess && campaignId ? buildFieldGroupQrJoinUrl(campaignId, issuedAccess.credentials.qrToken) : null;
  const copyValue = async (kind: "code" | "link", value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1500);
  };

  return (
    <>
      <FieldBottomSheet open title="Rooms" kicker={context?.activeTeam?.name ?? "Unterwegs"} onClose={onClose} initialSnap="expanded">
        <div className="team-center-view">
          {!online ? <div className="team-center-notice">Offline: Room-Verwaltung benötigt Internet.</div> : null}
          {statusMessage ? <div className="team-center-notice is-success" role="status">{statusMessage}</div> : null}
          {error ? <div className="team-center-error" role="alert">{error}</div> : null}
          <section className="team-center-actions-card">
            <button className="team-center-primary" type="button" disabled={!online} onClick={() => setJoinOpen(true)}><span>⌨️</span><strong>Room beitreten</strong><small>Room-Code eingeben</small></button>
            {canCreateRoom ? <button className="team-center-secondary-card" type="button" disabled={!online} onClick={() => setCreateOpen(true)}><span>＋</span><strong>Room erstellen</strong><small>Code & QR werden sicher erzeugt</small></button> : null}
          </section>

          <section className="team-center-card">
            <div className="team-center-section-heading"><div><span>Aktive unterwegs</span><strong>{groups.length} Rooms</strong></div><button className="team-center-icon-button" type="button" disabled={!online || requestState === "loading"} onClick={() => void loadGroups()} aria-label="Rooms aktualisieren">↻</button></div>
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
                  {selectedGroup.joinAvailable ? <button className="team-center-primary" type="button" disabled={!online || requestState === "saving"} onClick={() => void showCredentials()}>Join-Zugang anzeigen</button> : null}
                  <div className="team-center-action-grid"><button type="button" onClick={() => void rotateCredentials()} disabled={!online || requestState === "saving"}>Join-Zugang erneuern</button><button type="button" onClick={() => void revokeCredentials()} disabled={!online || requestState === "saving" || !selectedGroup.joinAvailable}>Join sperren</button></div>
                  {campaignId ? <FieldGroupMembersPanel campaignId={campaignId} groupId={selectedGroup.id} online={online} onChanged={() => refreshSelected(selectedGroup.id)} /> : null}
                  <button className="team-center-danger" type="button" disabled={!online || requestState === "saving"} onClick={() => void closeRoom()}>Room beenden</button>
                </div>
              ) : null}
              {(context?.activeGroupId === selectedGroup.id || context?.accessRole === "field-group-member") ? <button className="team-center-secondary" type="button" disabled={!online || requestState === "saving"} onClick={() => void leaveRoom()}>Room verlassen</button> : null}
            </section>
          ) : null}
        </div>
      </FieldBottomSheet>

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
        <Modal kicker="Aktueller Join-Zugang" title={issuedAccess.group.label} onClose={() => { setIssuedAccess(null); setCopied(null); }}>
          <p className="team-center-help">Dieser Code und QR-Link sind der aktuell gültige Join-Zugang. Anzeigen rotiert nichts und bestehende Mitglieder bleiben unverändert.</p>
          <div className="team-center-room-code">{issuedAccess.credentials.roomCode}</div>
          <button className="team-center-secondary" type="button" onClick={() => void copyValue("code", issuedAccess.credentials.roomCode)}>{copied === "code" ? "Code kopiert ✓" : "Code kopieren"}</button>
          <div className="team-center-qr"><QRCodeSVG value={issuedJoinUrl} size={196} level="M" includeMargin title={`QR-Code: ${issuedAccess.group.label}`} /></div>
          <input className="team-center-link-input" readOnly value={issuedJoinUrl} aria-label="Room-Link" />
          <button className="team-center-primary" type="button" onClick={() => void copyValue("link", issuedJoinUrl)}>{copied === "link" ? "Link kopiert ✓" : "Link kopieren"}</button>
        </Modal>
      ) : null}
    </>
  );
}
