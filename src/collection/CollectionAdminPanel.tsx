import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  buildCollectionAccessUrl,
  createCollectionAccessLink,
  fetchCollectionCollectors,
  revokeCollectionCollector,
} from "../data/campaignApi";
import {
  collectionPickupCapabilitiesFromUnknown,
  updateCollectionPickupCapabilities,
  type CollectionPickupCapabilities,
} from "../data/pickupCapabilitiesApi";
import type { CampaignSnapshot } from "../domain/campaign";
import {
  collectionSnapshotOrEmpty,
  type CollectionArea,
  type CollectionRun,
  type CollectionSnapshot,
} from "../domain/collection";
import type { Language } from "../i18n";
import {
  PickupAssignmentEditor,
  type PickupAssignmentOption,
} from "./PickupAssignmentEditor.tsx";
import { CollectionAdminPickupWorkspace } from "./CollectionAdminPickupWorkspace.tsx";
import "./collection-admin-panel.css";

type Collector = {
  id: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
  collectionCapabilities: CollectionPickupCapabilities;
};

type Props = {
  campaignId: string;
  language: Language;
  snapshot: CampaignSnapshot;
  onSnapshotChange: (update: (current: CampaignSnapshot) => CampaignSnapshot) => void;
  onClose: () => void;
  onStartMainArea: () => void;
  onStartArea: () => void;
  onEditArea: (areaId: string) => void;
  onForceReleaseArea: (areaId: string, runId: string) => void;
};

function copy(language: Language, german: string, english: string) {
  return language === "en" ? english : german;
}

function statusLabel(language: Language, status: CollectionArea["status"]) {
  const labels: Record<CollectionArea["status"], [string, string]> = {
    open: ["offen", "open"],
    claimed: ["reserviert", "claimed"],
    "in-progress": ["läuft", "in progress"],
    completed: ["fertig", "completed"],
    archived: ["archiviert", "archived"],
  };
  return copy(language, labels[status][0], labels[status][1]);
}

function activeRunForArea(collection: CollectionSnapshot, areaId: string): CollectionRun | null {
  return collection.runs.find(
    (run) => run.status === "active" && run.areaIds.includes(areaId),
  ) ?? null;
}

function activeAssignmentCollectors(
  collectors: readonly Collector[],
  runs: readonly CollectionRun[],
): PickupAssignmentOption[] {
  const options = new Map<string, string>();
  for (const collector of collectors) {
    if (!collector.revokedAt) options.set(collector.id, collector.label);
  }
  for (const run of runs) {
    if (run.status !== "active") continue;
    for (const member of run.members) {
      if (member.leftAt === null && !options.has(member.collectorId)) {
        options.set(member.collectorId, member.label);
      }
    }
  }
  return [...options].map(([id, label]) => ({ id, label }));
}

export function CollectionAdminPanel({
  campaignId,
  language,
  snapshot,
  onSnapshotChange,
  onClose,
  onStartMainArea,
  onStartArea,
  onEditArea,
  onForceReleaseArea,
}: Props) {
  const collection = collectionSnapshotOrEmpty(snapshot.collection);
  const [accessUrl, setAccessUrl] = useState<string | null>(null);
  const [collectors, setCollectors] = useState<Collector[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [assignmentPickupId, setAssignmentPickupId] = useState<string | null>(null);
  const activeRuns = collection.runs.filter((run) => run.status === "active");
  const activePickups = collection.pickups.filter((pickup) => pickup.archivedAt === null);
  const assignmentPickup = assignmentPickupId
    ? activePickups.find((pickup) => pickup.id === assignmentPickupId) ?? null
    : null;
  const assignmentRunOptions: PickupAssignmentOption[] = activeRuns.map((run) => ({
    id: run.id,
    label: `${copy(language, "Run", "Run")} ${run.id.slice(-8)} · ${run.members.filter((member) => member.leftAt === null).length} ${copy(language, "Geräte", "devices")}`,
  }));
  const assignmentCollectorOptions = activeAssignmentCollectors(collectors, activeRuns);

  const refreshCollectors = async () => {
    try {
      const result = await fetchCollectionCollectors(campaignId);
      setCollectors(result.collectors.map((collector) => {
        const candidate = collector as typeof collector & { collectionCapabilities?: unknown };
        return {
          id: candidate.id,
          label: candidate.label,
          createdAt: candidate.createdAt,
          revokedAt: candidate.revokedAt,
          collectionCapabilities: collectionPickupCapabilitiesFromUnknown(
            candidate.collectionCapabilities,
          ),
        };
      }));
      setMessage(null);
    } catch {
      setMessage(copy(language, "Sammler konnten nicht geladen werden.", "Collectors could not be loaded."));
    }
  };

  useEffect(() => {
    void refreshCollectors();
  }, [campaignId]);

  useEffect(() => {
    if (assignmentPickupId && !activePickups.some((pickup) => pickup.id === assignmentPickupId)) {
      setAssignmentPickupId(null);
    }
  }, [activePickups, assignmentPickupId]);

  const createQr = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await createCollectionAccessLink(campaignId);
      setAccessUrl(buildCollectionAccessUrl(campaignId, result.token));
      setMessage(copy(language, "QR-Zugang erstellt.", "QR access created."));
      await refreshCollectors();
    } catch {
      setMessage(copy(language, "QR-Zugang konnte nicht erstellt werden.", "QR access could not be created."));
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = async () => {
    if (!accessUrl || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(accessUrl);
      setMessage(copy(language, "Link kopiert.", "Link copied."));
    } catch {
      setMessage(copy(language, "Link konnte nicht kopiert werden.", "Link could not be copied."));
    }
  };

  const revokeCollector = async (collectorId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await revokeCollectionCollector(campaignId, collectorId);
      setCollectors((current) => current.map((collector) =>
        collector.id === collectorId ? { ...collector, revokedAt: new Date().toISOString() } : collector,
      ));
      setMessage(copy(language, "Sammlerzugang widerrufen.", "Collector access revoked."));
    } catch {
      setMessage(copy(language, "Widerruf fehlgeschlagen.", "Revocation failed."));
    } finally {
      setBusy(false);
    }
  };

  const changePickupCapability = async (
    collector: Collector,
    key: keyof CollectionPickupCapabilities,
    checked: boolean,
  ) => {
    if (busy || collector.revokedAt) return;
    let next: CollectionPickupCapabilities = {
      ...collector.collectionCapabilities,
      [key]: checked,
    };
    if (key === "canViewPickups" && !checked) {
      next = {
        canViewPickups: false,
        canCreatePickups: false,
        canEditPickups: false,
        canAssignPickups: false,
      };
    }
    setBusy(true);
    try {
      const updated = await updateCollectionPickupCapabilities(campaignId, collector.id, next);
      setCollectors((current) => current.map((candidate) =>
        candidate.id === collector.id
          ? { ...candidate, collectionCapabilities: updated }
          : candidate,
      ));
      setMessage(copy(language, "Pickup-Rechte gespeichert.", "Pickup permissions saved."));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : copy(language, "Pickup-Rechte konnten nicht gespeichert werden.", "Pickup permissions could not be saved."),
      );
    } finally {
      setBusy(false);
    }
  };

  const updateCollection = (update: (current: CollectionSnapshot) => CollectionSnapshot) => {
    onSnapshotChange((current) => ({
      ...current,
      collection: update(collectionSnapshotOrEmpty(current.collection)),
    }));
  };

  const changePickupAssignment = async (
    pickupId: string,
    assignedRunIds: string[],
    assignedCollectorIds: string[],
  ) => {
    const currentPickup = activePickups.find((pickup) => pickup.id === pickupId);
    if (!currentPickup) return;
    if (
      JSON.stringify(currentPickup.assignedRunIds) === JSON.stringify(assignedRunIds) &&
      JSON.stringify(currentPickup.assignedCollectorIds) === JSON.stringify(assignedCollectorIds)
    ) {
      return;
    }
    const now = new Date().toISOString();
    updateCollection((current) => ({
      ...current,
      pickups: (current.pickups ?? []).map((pickup) =>
        pickup.id === pickupId && pickup.archivedAt === null
          ? {
              ...pickup,
              assignedRunIds: [...assignedRunIds],
              assignedCollectorIds: [...assignedCollectorIds],
              updatedAt: now,
            }
          : pickup,
      ),
    }));
  };

  return (
    <section className="bottom-sheet collection-admin-sheet" aria-label={copy(language, "Collection verwalten", "Manage collection")}>
      <div className="sheet-handle" aria-hidden="true" />
      <div className="sheet-header">
        <div>
          <span className="eyebrow">Collection</span>
          <strong>{copy(language, "Collection verwalten", "Manage collection")}</strong>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label={copy(language, "Schließen", "Close")}>×</button>
      </div>

      <div className="collection-admin-actions">
        <button type="button" className="primary-action" onClick={onStartMainArea} disabled={Boolean(collection.mainArea)}>
          {collection.mainArea ? copy(language, "Main Area vorhanden", "Main area configured") : copy(language, "Main Area zeichnen", "Draw main area")}
        </button>
        <button type="button" className="secondary-action" onClick={onStartArea} disabled={!collection.mainArea}>
          {copy(language, "Collection Area zeichnen", "Draw collection area")}
        </button>
      </div>

      <div className="collection-admin-section">
        <div className="collection-section-heading">
          <div>
            <span className="eyebrow">{copy(language, "Gebiet", "Area")}</span>
            <h2>{collection.mainArea?.name ?? copy(language, "Noch nicht eingerichtet", "Not configured yet")}</h2>
          </div>
          <span className="collection-count">{collection.areas.filter((area) => area.status !== "archived").length}</span>
        </div>
        <div className="collection-admin-area-list">
          {collection.areas.filter((area) => area.status !== "archived").map((area) => {
            const run = activeRunForArea(collection, area.id);
            return (
              <article className="collection-admin-area-row" key={area.id}>
                <span className="collection-color-dot" style={{ backgroundColor: area.color }} aria-hidden="true" />
                <div className="collection-area-copy">
                  <strong>{area.name}</strong>
                  <small>{statusLabel(language, area.status)}{area.claimedByLabel ? " · " + area.claimedByLabel : ""}</small>
                </div>
                <div className="collection-button-row">
                  {area.status === "open" ? (
                    <button type="button" className="text-action" onClick={() => onEditArea(area.id)}>
                      {copy(language, "Bearbeiten", "Edit")}
                    </button>
                  ) : null}
                  {run && area.status !== "completed" ? (
                    <button type="button" className="text-action danger-action" onClick={() => onForceReleaseArea(area.id, run.id)}>
                      {copy(language, "Freigeben", "Force release")}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
          {collection.areas.filter((area) => area.status !== "archived").length === 0 ? (
            <p className="empty-state">{copy(language, "Noch keine Collection Areas.", "No collection areas yet.")}</p>
          ) : null}
        </div>
      </div>

      <div className="collection-admin-section">
        <div className="collection-section-heading">
          <div>
            <span className="eyebrow">{copy(language, "Sonderadressen", "Pickup addresses")}</span>
            <h2>{copy(language, "Erstellen und bearbeiten", "Create and edit")}</h2>
          </div>
          <span className="collection-count">{activePickups.length}</span>
        </div>
        <CollectionAdminPickupWorkspace
          campaignId={campaignId}
          language={language}
          snapshot={snapshot}
          onSnapshotChange={onSnapshotChange}
        />
      </div>

      <div className="collection-admin-section">
        <div className="collection-section-heading">
          <div>
            <span className="eyebrow">{copy(language, "Sonderadressen", "Pickup addresses")}</span>
            <h2>{copy(language, "Zuweisungen", "Assignments")}</h2>
          </div>
          <span className="collection-count">{activePickups.length}</span>
        </div>
        <div className="collection-admin-area-list">
          {activePickups.length === 0 ? (
            <p className="empty-state">{copy(language, "Noch keine Sonderadressen.", "No pickup addresses yet.")}</p>
          ) : activePickups.map((pickup) => {
            const assignmentCount = pickup.assignedRunIds.length + pickup.assignedCollectorIds.length;
            return (
              <article className="collection-admin-area-row" key={pickup.id}>
                <div className="collection-area-copy">
                  <strong>{pickup.title}</strong>
                  <small>
                    {pickup.address} · {assignmentCount} {copy(language, "Zuweisungen", "assignments")}
                  </small>
                </div>
                <button
                  type="button"
                  className="text-action"
                  aria-expanded={assignmentPickupId === pickup.id}
                  onClick={() => setAssignmentPickupId((current) => current === pickup.id ? null : pickup.id)}
                >
                  {assignmentPickupId === pickup.id
                    ? copy(language, "Schließen", "Close")
                    : copy(language, "Zuweisen", "Assign")}
                </button>
              </article>
            );
          })}
        </div>
        {assignmentPickup ? (
          <PickupAssignmentEditor
            assignedRunIds={assignmentPickup.assignedRunIds}
            assignedCollectorIds={assignmentPickup.assignedCollectorIds}
            runOptions={assignmentRunOptions}
            collectorOptions={assignmentCollectorOptions}
            canAssign
            language={language}
            onSave={(runIds, collectorIds) =>
              changePickupAssignment(assignmentPickup.id, runIds, collectorIds)}
          />
        ) : null}
      </div>

      <div className="collection-admin-section">
        <div className="collection-section-heading">
          <div>
            <span className="eyebrow">QR</span>
            <h2>{copy(language, "Temporärer Sammlerzugang", "Temporary collector access")}</h2>
          </div>
        </div>
        {accessUrl ? (
          <div className="collection-qr">
            <QRCodeSVG value={accessUrl} size={176} includeMargin />
            <code>{accessUrl}</code>
            <div className="collection-button-row">
              <button type="button" className="secondary-action" onClick={copyUrl}>{copy(language, "Link kopieren", "Copy link")}</button>
              <button type="button" className="text-action" onClick={createQr} disabled={busy}>{copy(language, "Neu erstellen", "Create new")}</button>
            </div>
          </div>
        ) : (
          <button type="button" className="primary-action" onClick={createQr} disabled={busy}>
            {copy(language, "QR-Zugang erstellen", "Create QR access")}
          </button>
        )}
      </div>

      <div className="collection-admin-section">
        <div className="collection-section-heading">
          <div>
            <span className="eyebrow">{copy(language, "Zugänge", "Access")}</span>
            <h2>{copy(language, "Aktive Geräte", "Active devices")}</h2>
          </div>
          <button type="button" className="text-action" onClick={() => void refreshCollectors()}>{copy(language, "Aktualisieren", "Refresh")}</button>
        </div>
        <div className="collection-collector-list">
          {collectors.length === 0 ? (
            <p className="empty-state">{copy(language, "Noch kein Gerät verbunden.", "No device connected yet.")}</p>
          ) : collectors.map((collector) => {
            const capabilities = collector.collectionCapabilities;
            const writesDisabled = !capabilities.canViewPickups || busy || Boolean(collector.revokedAt);
            return (
              <article className="collection-collector-row" key={collector.id}>
                <div className="collection-collector-summary">
                  <strong>{collector.label}</strong>
                  <small>{collector.revokedAt ? copy(language, "widerrufen", "revoked") : copy(language, "aktiv", "active")}</small>
                </div>
                <div className="collection-capability-grid" aria-label={copy(language, "Pickup-Rechte", "Pickup permissions")}>
                  <label>
                    <input
                      type="checkbox"
                      checked={capabilities.canViewPickups}
                      disabled={busy || Boolean(collector.revokedAt)}
                      onChange={(event) => void changePickupCapability(collector, "canViewPickups", event.currentTarget.checked)}
                    />
                    {copy(language, "Sehen", "View")}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={capabilities.canCreatePickups}
                      disabled={writesDisabled}
                      onChange={(event) => void changePickupCapability(collector, "canCreatePickups", event.currentTarget.checked)}
                    />
                    {copy(language, "Erstellen", "Create")}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={capabilities.canEditPickups}
                      disabled={writesDisabled}
                      onChange={(event) => void changePickupCapability(collector, "canEditPickups", event.currentTarget.checked)}
                    />
                    {copy(language, "Bearbeiten", "Edit")}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={capabilities.canAssignPickups}
                      disabled={writesDisabled}
                      onChange={(event) => void changePickupCapability(collector, "canAssignPickups", event.currentTarget.checked)}
                    />
                    {copy(language, "Zuweisen", "Assign")}
                  </label>
                </div>
                {!collector.revokedAt ? (
                  <button type="button" className="text-action danger-action" onClick={() => void revokeCollector(collector.id)} disabled={busy}>
                    {copy(language, "Widerrufen", "Revoke")}
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>

      {message ? <p className="collection-message" role="status">{message}</p> : null}
    </section>
  );
}
