import { useCallback, useEffect, useState } from "react";
import { CampaignApiError } from "../data/campaignApi.ts";
import {
  fetchFieldGroupMembers,
  removeFieldGroupMember,
  type FieldGroupMemberSummary,
} from "../data/fieldGroupApi.ts";
import "./field-group-members.css";

type FieldGroupMembersPanelProps = {
  campaignId: string;
  groupId: string;
  online: boolean;
  onChanged: () => void | Promise<void>;
};

function memberErrorMessage(error: unknown) {
  if (error instanceof CampaignApiError) {
    if (error.code === "group_not_active") return "Die Gruppe ist nicht mehr aktiv.";
    if (error.status === 403) return "Du darfst die Mitglieder dieser Gruppe nicht verwalten.";
    if (error.status === 401) return "Dein Zugriff ist nicht mehr gültig.";
    return error.message;
  }
  return "Gruppenmitglieder konnten nicht geladen werden.";
}

function joinedLabel(joinedAt: string) {
  const date = new Date(joinedAt);
  if (Number.isNaN(date.getTime())) return "Beitrittszeit unbekannt";
  return `Beigetreten ${date.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export function FieldGroupMembersPanel({
  campaignId,
  groupId,
  online,
  onChanged,
}: FieldGroupMembersPanelProps) {
  const [members, setMembers] = useState<FieldGroupMemberSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!online) return;
    setLoading(true);
    setError(null);
    try {
      setMembers(await fetchFieldGroupMembers(campaignId, groupId));
    } catch (loadError) {
      setError(memberErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [campaignId, groupId, online]);

  useEffect(() => {
    setMembers([]);
    setError(null);
    void load();
  }, [load]);

  const remove = async (member: FieldGroupMemberSummary) => {
    if (!online || savingId) return;
    if (!window.confirm(`${member.label} wirklich aus diesem Einsatz entfernen?`)) return;

    setSavingId(member.id);
    setError(null);
    try {
      await removeFieldGroupMember(campaignId, groupId, member.id);
      setMembers((current) => current.filter((candidate) => candidate.id !== member.id));
      await onChanged();
    } catch (removeError) {
      setError(memberErrorMessage(removeError));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="field-group-members">
      <div className="field-group-members-heading">
        <div>
          <span>Verbunden</span>
          <strong>Mitglieder</strong>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={!online || loading || Boolean(savingId)}
          aria-label="Gruppenmitglieder aktualisieren"
        >
          ↻
        </button>
      </div>

      {!online ? (
        <p className="field-group-members-muted">Mitgliederverwaltung benötigt Internet.</p>
      ) : null}
      {error ? <p className="field-group-members-error" role="alert">{error}</p> : null}
      {loading ? <p className="field-group-members-muted" role="status">Mitglieder werden geladen ...</p> : null}
      {!loading && online && !error && members.length === 0 ? (
        <p className="field-group-members-muted">Aktuell ist kein Gerät als Mitglied verbunden.</p>
      ) : null}

      <div className="field-group-members-list">
        {members.map((member) => (
          <div className="field-group-member" key={member.id}>
            <div>
              <strong>{member.label}</strong>
              <small>
                {member.kind === "temporary" ? "Temporärer Gruppenbeitritt" : "Campaign-Zugriff"}
                {` · ${joinedLabel(member.joinedAt)}`}
              </small>
            </div>
            <button
              type="button"
              onClick={() => void remove(member)}
              disabled={!online || Boolean(savingId)}
            >
              {savingId === member.id ? "Entferne ..." : "Entfernen"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
