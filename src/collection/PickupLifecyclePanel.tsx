import { useMemo, useState } from "react";
import { CommentsContextPanel } from "../collaboration/CommentsContextPanel.tsx";
import type { LngLat } from "../domain/campaign.ts";
import { summarizePickupStatuses, validatePickupDraft, type PickupStatus } from "../domain/pickup.ts";
import { PickupAssignmentEditor, type PickupAssignmentOption } from "./PickupAssignmentEditor.tsx";
import "./pickup-lifecycle-panel.css";

export type PickupLifecycleItem = {
  id: string;
  title: string;
  address: string;
  description: string;
  position: LngLat;
  areaId: string | null;
  status: PickupStatus;
  archivedAt: string | null;
  assignedRunIds: readonly string[];
  assignedCollectorIds: readonly string[];
};

export type PickupLifecycleEdit = {
  title: string;
  address: string;
  description: string;
  position: LngLat;
  areaId: string | null;
};

type Props = {
  campaignId: string;
  items: readonly PickupLifecycleItem[];
  canEdit: boolean;
  canAssign: boolean;
  online: boolean;
  language: "de" | "en";
  editPosition: LngLat | null;
  manualPositioning: boolean;
  assignmentRunOptions: readonly PickupAssignmentOption[];
  assignmentCollectorOptions: readonly PickupAssignmentOption[];
  onEdit: (id: string, input: PickupLifecycleEdit) => void | Promise<void>;
  onArchive: (id: string) => void | Promise<void>;
  onStatusChange: (id: string, status: PickupStatus) => void | Promise<void>;
  onAssignmentChange: (
    id: string,
    assignedRunIds: string[],
    assignedCollectorIds: string[],
  ) => void | Promise<void>;
  onPositionChange: (position: LngLat | null) => void;
  onFocusPosition: (position: LngLat) => void;
  onManualPositioningChange: (active: boolean) => void;
};

const STATUS_ORDER: readonly PickupStatus[] = [
  "open",
  "collected",
  "unavailable",
  "needs-follow-up",
];

function copy(language: "de" | "en", german: string, english: string) {
  return language === "en" ? english : german;
}

function statusLabel(language: "de" | "en", status: PickupStatus) {
  if (status === "collected") return copy(language, "Eingesammelt", "Collected");
  if (status === "unavailable") return copy(language, "Nicht verfügbar", "Unavailable");
  if (status === "needs-follow-up") return copy(language, "Später prüfen", "Needs follow-up");
  return copy(language, "Offen", "Open");
}

export function PickupLifecyclePanel({
  campaignId,
  items,
  canEdit,
  canAssign,
  online,
  language,
  editPosition,
  manualPositioning,
  assignmentRunOptions,
  assignmentCollectorOptions,
  onEdit,
  onArchive,
  onStatusChange,
  onAssignmentChange,
  onPositionChange,
  onFocusPosition,
  onManualPositioningChange,
}: Props) {
  const [editPickupId, setEditPickupId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ title: "", address: "", description: "" });
  const [editInvalid, setEditInvalid] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [commentPickupId, setCommentPickupId] = useState<string | null>(null);
  const [assignmentPickupId, setAssignmentPickupId] = useState<string | null>(null);

  const activeItems = useMemo(() => items.filter((item) => item.archivedAt === null), [items]);
  const archivedItems = useMemo(() => items.filter((item) => item.archivedAt !== null), [items]);
  const summary = useMemo(
    () => summarizePickupStatuses(activeItems.map((item) => item.status)),
    [activeItems],
  );
  const editPickup = editPickupId ? activeItems.find((item) => item.id === editPickupId) ?? null : null;
  const commentPickup = commentPickupId ? items.find((item) => item.id === commentPickupId) ?? null : null;
  const assignmentPickup = assignmentPickupId
    ? activeItems.find((item) => item.id === assignmentPickupId) ?? null
    : null;

  const startEdit = (item: PickupLifecycleItem) => {
    if (!canEdit || item.archivedAt !== null) return;
    setAssignmentPickupId(null);
    setEditPickupId(item.id);
    setEditDraft({ title: item.title, address: item.address, description: item.description });
    setEditInvalid(false);
    onPositionChange(item.position);
    onFocusPosition(item.position);
    onManualPositioningChange(false);
  };

  const cancelEdit = () => {
    setEditPickupId(null);
    setEditInvalid(false);
    onPositionChange(null);
    onManualPositioningChange(false);
  };

  const saveEdit = async () => {
    if (!canEdit || !editPickup || !editPosition) {
      setEditInvalid(true);
      return;
    }
    const validation = validatePickupDraft({
      ...editDraft,
      position: editPosition,
      areaId: editPickup.areaId,
      source: null,
    });
    if (!validation.valid) {
      setEditInvalid(true);
      return;
    }
    setEditSaving(true);
    setEditInvalid(false);
    try {
      await onEdit(editPickup.id, {
        title: validation.value.title,
        address: validation.value.address,
        description: validation.value.description,
        position: validation.value.position,
        areaId: validation.value.areaId,
      });
      cancelEdit();
    } catch {
      setEditInvalid(true);
    } finally {
      setEditSaving(false);
    }
  };

  const archive = async (item: PickupLifecycleItem) => {
    if (!canEdit || item.archivedAt !== null) return;
    const confirmed = typeof window === "undefined" || window.confirm(
      copy(
        language,
        `Sonderadresse „${item.title}“ archivieren? Sie bleibt später prüfbar.`,
        `Archive pickup address “${item.title}”? It will remain available for review.`,
      ),
    );
    if (!confirmed) return;
    if (editPickupId === item.id) cancelEdit();
    if (assignmentPickupId === item.id) setAssignmentPickupId(null);
    await onArchive(item.id);
  };

  const renderCard = (item: PickupLifecycleItem, archived: boolean) => {
    const assignmentCount = item.assignedRunIds.length + item.assignedCollectorIds.length;
    return (
      <article className={`pickup-lifecycle-card ${archived ? "is-archived" : ""}`} key={item.id}>
        <div className="pickup-lifecycle-copy">
          <strong>{item.title}</strong>
          <small>{item.address}</small>
          {item.description ? <p>{item.description}</p> : null}
          <div className="pickup-lifecycle-actions">
            <button
              type="button"
              onClick={() => setCommentPickupId((current) => current === item.id ? null : item.id)}
              aria-expanded={commentPickupId === item.id}
            >
              {commentPickupId === item.id
                ? copy(language, "Kommentare schließen", "Close comments")
                : copy(language, "Kommentare", "Comments")}
            </button>
            {!archived && canEdit ? (
              <button type="button" onClick={() => startEdit(item)}>
                {copy(language, "Bearbeiten", "Edit")}
              </button>
            ) : null}
            {!archived && (canAssign || assignmentCount > 0) ? (
              <button
                type="button"
                onClick={() => setAssignmentPickupId((current) => current === item.id ? null : item.id)}
                aria-expanded={assignmentPickupId === item.id}
              >
                {assignmentPickupId === item.id
                  ? copy(language, "Zuweisung schließen", "Close assignment")
                  : `${copy(language, "Zuweisung", "Assignment")}${assignmentCount ? ` · ${assignmentCount}` : ""}`}
              </button>
            ) : null}
            {!archived && canEdit ? (
              <button type="button" className="is-danger" onClick={() => void archive(item)}>
                {copy(language, "Archivieren", "Archive")}
              </button>
            ) : null}
          </div>
        </div>
        {archived ? (
          <span className="pickup-lifecycle-badge">{copy(language, "Archiviert", "Archived")}</span>
        ) : canEdit ? (
          <select
            aria-label={`${item.address}: ${copy(language, "Status", "Status")}`}
            value={item.status}
            onChange={(event) => void onStatusChange(item.id, event.currentTarget.value as PickupStatus)}
          >
            {STATUS_ORDER.map((status) => (
              <option value={status} key={status}>{statusLabel(language, status)}</option>
            ))}
          </select>
        ) : (
          <span className={`pickup-status is-${item.status}`}>{statusLabel(language, item.status)}</span>
        )}
      </article>
    );
  };

  return (
    <section className="pickup-lifecycle-panel" aria-label={copy(language, "Sonderadressen verwalten", "Manage pickup addresses")}>
      <header className="pickup-lifecycle-header">
        <div>
          <strong>{copy(language, "Aktive Sonderadressen", "Active pickup addresses")}</strong>
          <span>{summary.collected} / {summary.total} {copy(language, "eingesammelt", "collected")}</span>
        </div>
        <strong>{summary.percentCollected === null ? "–" : `${Math.round(summary.percentCollected)} %`}</strong>
      </header>

      <div className="pickup-lifecycle-list">
        {activeItems.length === 0 ? (
          <p>{copy(language, "Keine aktiven Sonderadressen.", "No active pickup addresses.")}</p>
        ) : activeItems.map((item) => renderCard(item, false))}
      </div>

      {editPickup ? (
        <div className="pickup-lifecycle-editor">
          <div className="pickup-lifecycle-editor-heading">
            <strong>{copy(language, "Sonderadresse bearbeiten", "Edit pickup address")}</strong>
            <button type="button" onClick={cancelEdit}>{copy(language, "Abbrechen", "Cancel")}</button>
          </div>
          <label>
            <span>{copy(language, "Titel", "Title")}</span>
            <input
              value={editDraft.title}
              maxLength={160}
              onChange={(event) => setEditDraft((current) => ({ ...current, title: event.currentTarget.value }))}
            />
          </label>
          <label>
            <span>{copy(language, "Adresse", "Address")}</span>
            <input
              value={editDraft.address}
              maxLength={320}
              autoComplete="street-address"
              onChange={(event) => setEditDraft((current) => ({ ...current, address: event.currentTarget.value }))}
            />
          </label>
          <label>
            <span>{copy(language, "Beschreibung", "Description")}</span>
            <textarea
              rows={3}
              maxLength={4_000}
              value={editDraft.description}
              onChange={(event) => setEditDraft((current) => ({ ...current, description: event.currentTarget.value }))}
            />
          </label>
          <div className="pickup-lifecycle-position">
            <button
              type="button"
              onClick={() => onManualPositioningChange(!manualPositioning)}
              disabled={!editPosition}
            >
              {manualPositioning
                ? copy(language, "Position übernehmen", "Use this position")
                : copy(language, "Position auf Karte korrigieren", "Adjust position on map")}
            </button>
            {editPosition ? (
              <span>{editPosition[1].toFixed(5)}, {editPosition[0].toFixed(5)}</span>
            ) : null}
          </div>
          {editInvalid ? (
            <p className="pickup-lifecycle-error" role="alert">
              {copy(language, "Bitte Titel, Adresse und Position prüfen.", "Check title, address and position.")}
            </p>
          ) : null}
          <button type="button" className="pickup-lifecycle-save" disabled={editSaving || !editPosition} onClick={() => void saveEdit()}>
            {editSaving ? copy(language, "Wird gespeichert…", "Saving…") : copy(language, "Änderungen speichern", "Save changes")}
          </button>
        </div>
      ) : null}

      {assignmentPickup ? (
        <PickupAssignmentEditor
          assignedRunIds={assignmentPickup.assignedRunIds}
          assignedCollectorIds={assignmentPickup.assignedCollectorIds}
          runOptions={assignmentRunOptions}
          collectorOptions={assignmentCollectorOptions}
          canAssign={canAssign}
          language={language}
          onSave={(runIds, collectorIds) => onAssignmentChange(assignmentPickup.id, runIds, collectorIds)}
        />
      ) : null}

      {commentPickup ? (
        <CommentsContextPanel
          campaignId={campaignId}
          targetType="pickup-task"
          targetId={commentPickup.id}
          targetLabel={`${commentPickup.title} · ${commentPickup.address}`}
          targetTeamId={null}
          access={null}
          online={online}
          language={language}
        />
      ) : null}

      {archivedItems.length > 0 ? (
        <div className="pickup-lifecycle-archive">
          <button type="button" onClick={() => setShowArchived((current) => !current)} aria-expanded={showArchived}>
            {showArchived
              ? copy(language, "Archivierte ausblenden", "Hide archived")
              : `${copy(language, "Archivierte anzeigen", "Show archived")} · ${archivedItems.length}`}
          </button>
          {showArchived ? (
            <div className="pickup-lifecycle-list">
              {archivedItems.map((item) => renderCard(item, true))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
