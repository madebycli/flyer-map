import { useMemo, useState } from "react";
import { CommentsContextPanel } from "../collaboration/CommentsContextPanel.tsx";
import type { LngLat } from "../domain/campaign.ts";
import { validatePickupDraft, type PickupStatus } from "../domain/pickup.ts";
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
  online: boolean;
  language: "de" | "en";
  editPosition: LngLat | null;
  manualPositioning: boolean;
  onEdit: (id: string, input: PickupLifecycleEdit) => void | Promise<void>;
  onArchive: (id: string) => void | Promise<void>;
  onPositionChange: (position: LngLat | null) => void;
  onFocusPosition: (position: LngLat) => void;
  onManualPositioningChange: (active: boolean) => void;
};

function copy(language: "de" | "en", german: string, english: string) {
  return language === "en" ? english : german;
}

export function PickupLifecyclePanel({
  campaignId,
  items,
  canEdit,
  online,
  language,
  editPosition,
  manualPositioning,
  onEdit,
  onArchive,
  onPositionChange,
  onFocusPosition,
  onManualPositioningChange,
}: Props) {
  const [manageOpen, setManageOpen] = useState(false);
  const [editPickupId, setEditPickupId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ title: "", address: "", description: "" });
  const [editInvalid, setEditInvalid] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedCommentPickupId, setArchivedCommentPickupId] = useState<string | null>(null);

  const activeItems = useMemo(() => items.filter((item) => item.archivedAt === null), [items]);
  const archivedItems = useMemo(() => items.filter((item) => item.archivedAt !== null), [items]);
  const editPickup = editPickupId ? activeItems.find((item) => item.id === editPickupId) ?? null : null;
  const archivedCommentPickup = archivedCommentPickupId
    ? archivedItems.find((item) => item.id === archivedCommentPickupId) ?? null
    : null;

  const startEdit = (item: PickupLifecycleItem) => {
    if (!canEdit || item.archivedAt !== null) return;
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
    await onArchive(item.id);
  };

  return (
    <section className="pickup-lifecycle-panel" aria-label={copy(language, "Sonderadressen bearbeiten", "Edit pickup addresses")}>
      {canEdit && activeItems.length > 0 ? (
        <button
          type="button"
          className="pickup-lifecycle-manage-toggle"
          onClick={() => setManageOpen((current) => !current)}
          aria-expanded={manageOpen}
        >
          {manageOpen
            ? copy(language, "Bearbeitung schließen", "Close editing")
            : copy(language, "Sonderadressen bearbeiten / archivieren", "Edit / archive pickup addresses")}
        </button>
      ) : null}

      {manageOpen ? (
        <div className="pickup-lifecycle-list">
          {activeItems.map((item) => (
            <article className="pickup-lifecycle-card" key={item.id}>
              <div className="pickup-lifecycle-copy">
                <strong>{item.title}</strong>
                <small>{item.address}</small>
              </div>
              <div className="pickup-lifecycle-actions">
                <button type="button" onClick={() => startEdit(item)}>
                  {copy(language, "Bearbeiten", "Edit")}
                </button>
                <button type="button" className="is-danger" onClick={() => void archive(item)}>
                  {copy(language, "Archivieren", "Archive")}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

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
            {editPosition ? <span>{editPosition[1].toFixed(5)}, {editPosition[0].toFixed(5)}</span> : null}
          </div>
          {editInvalid ? (
            <p className="pickup-lifecycle-error" role="alert">
              {copy(language, "Bitte Titel, Adresse und Position prüfen.", "Check title, address and position.")}
            </p>
          ) : null}
          <button
            type="button"
            className="pickup-lifecycle-save"
            disabled={editSaving || !editPosition}
            onClick={() => void saveEdit()}
          >
            {editSaving ? copy(language, "Wird gespeichert…", "Saving…") : copy(language, "Änderungen speichern", "Save changes")}
          </button>
        </div>
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
              {archivedItems.map((item) => (
                <article className="pickup-lifecycle-card is-archived" key={item.id}>
                  <div className="pickup-lifecycle-copy">
                    <strong>{item.title}</strong>
                    <small>{item.address}</small>
                    {item.description ? <p>{item.description}</p> : null}
                    <button
                      type="button"
                      onClick={() => setArchivedCommentPickupId((current) => current === item.id ? null : item.id)}
                      aria-expanded={archivedCommentPickupId === item.id}
                    >
                      {archivedCommentPickupId === item.id
                        ? copy(language, "Kommentare schließen", "Close comments")
                        : copy(language, "Kommentare prüfen", "Review comments")}
                    </button>
                  </div>
                  <span className="pickup-lifecycle-badge">{copy(language, "Archiviert", "Archived")}</span>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {archivedCommentPickup ? (
        <CommentsContextPanel
          campaignId={campaignId}
          targetType="pickup-task"
          targetId={archivedCommentPickup.id}
          targetLabel={`${archivedCommentPickup.title} · ${archivedCommentPickup.address}`}
          targetTeamId={null}
          access={null}
          online={online}
          language={language}
        />
      ) : null}
    </section>
  );
}
