import { useEffect, useMemo, useState } from "react";
import { fetchTeamCommentSummary, type TeamCommentSummaryGroup } from "../data/commentsApi.ts";
import {
  flushRxdbDrafts,
  loadCampaignSnapshot,
  saveCampaignSnapshot,
} from "../data/campaignStore.ts";
import type { PlatformAppContext } from "../platform/platformContract.ts";

type Props = {
  context: PlatformAppContext;
  online: boolean;
  onChanged: () => void;
};

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("de-DE", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function targetTypeLabel(value: string) {
  if (value === "area") return "Gebiet";
  if (value === "street-task") return "Straße";
  if (value === "house-task") return "Haus";
  return "Aktion";
}

export function TeamCommentsSummary({ context, online, onChanged }: Props) {
  const canSeeAll = context.accessRole === "admin";
  const defaultTeamId = context.activeTeam?.id ?? context.accessTeamId ?? context.teams[0]?.id ?? "";
  const [scope, setScope] = useState<string>(defaultTeamId || (canSeeAll ? "all" : ""));
  const [groups, setGroups] = useState<TeamCommentSummaryGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingAreaId, setEditingAreaId] = useState<string | null>(null);
  const [areaName, setAreaName] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!canSeeAll && context.accessTeamId && scope !== context.accessTeamId) {
      setScope(context.accessTeamId);
    } else if (!scope && defaultTeamId) {
      setScope(defaultTeamId);
    }
  }, [canSeeAll, context.accessTeamId, defaultTeamId, scope]);

  useEffect(() => {
    if (!online || !context.campaignId || !scope) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    void fetchTeamCommentSummary(context.campaignId, scope === "all" ? "all" : scope, controller.signal)
      .then((result) => {
        if (active) setGroups(result.groups);
      })
      .catch((cause: unknown) => {
        if (!active || (cause instanceof DOMException && cause.name === "AbortError")) return;
        setError(cause instanceof Error ? cause.message : "Kommentare konnten nicht geladen werden.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [context.campaignId, online, refreshToken, scope]);

  const activeTeam = useMemo(
    () => context.teams.find((team) => team.id === scope) ?? null,
    [context.teams, scope],
  );

  const canRenameArea = (areaId: string) => {
    if (context.accessRole === "admin") return true;
    if (context.accessRole !== "team-editor" || !context.accessTeamId) return false;
    const snapshot = loadCampaignSnapshot().snapshot;
    return snapshot.areas.some((area) => area.id === areaId && area.teamId === context.accessTeamId);
  };

  const startRename = (group: TeamCommentSummaryGroup) => {
    if (!group.areaId || !canRenameArea(group.areaId)) return;
    setEditingAreaId(group.areaId);
    setAreaName(group.areaName);
  };

  const commitRename = () => {
    if (!editingAreaId) return;
    const normalized = areaName.trim().replace(/\s+/gu, " ").slice(0, 60);
    if (!normalized) return;
    const loaded = loadCampaignSnapshot().snapshot;
    const currentArea = loaded.areas.find((area) => area.id === editingAreaId);
    if (!currentArea) return;
    if (
      context.accessRole !== "admin" &&
      !(context.accessRole === "team-editor" && context.accessTeamId === currentArea.teamId)
    ) return;
    const now = new Date().toISOString();
    saveCampaignSnapshot({
      ...loaded,
      areas: loaded.areas.map((area) =>
        area.id === editingAreaId ? { ...area, name: normalized, updatedAt: now } : area,
      ),
    });
    flushRxdbDrafts();
    setEditingAreaId(null);
    setAreaName("");
    onChanged();
    window.setTimeout(() => setRefreshToken((value) => value + 1), 250);
  };

  if (!online) {
    return <div className="team-center-empty">Kommentare benötigen für die Zusammenfassung eine Verbindung zum Server.</div>;
  }

  return (
    <div className="team-comments-summary">
      <div className="team-center-section-heading">
        <div>
          <span>Kommentare</span>
          <strong>{scope === "all" ? "Alle Teams" : activeTeam?.name ?? "Team"}</strong>
        </div>
        <button className="team-center-icon-button" type="button" onClick={() => setRefreshToken((value) => value + 1)} aria-label="Kommentare aktualisieren">↻</button>
      </div>

      <div className="team-center-segmented" role="group" aria-label="Kommentarbereich">
        {context.teams
          .filter((team) => context.accessRole === "admin" || team.id === context.accessTeamId)
          .map((team) => (
            <button key={team.id} type="button" className={scope === team.id ? "is-active" : ""} onClick={() => setScope(team.id)}>
              {team.name}
            </button>
          ))}
        {canSeeAll ? <button type="button" className={scope === "all" ? "is-active" : ""} onClick={() => setScope("all")}>Alle</button> : null}
      </div>

      {loading ? <div className="team-center-empty">Kommentare werden geladen …</div> : null}
      {error ? <div className="team-center-error" role="alert">{error}</div> : null}
      {!loading && !error && groups.length === 0 ? <div className="team-center-empty">Noch keine Kommentare in diesem Bereich.</div> : null}

      <div className="team-comments-groups">
        {groups.map((group) => (
          <section className="team-comments-area" key={group.areaId ?? "campaign"}>
            <header>
              <div>
                <span>{group.areaId ? "Gebiet" : "Allgemein"}</span>
                {editingAreaId === group.areaId ? (
                  <input
                    value={areaName}
                    maxLength={60}
                    autoFocus
                    onChange={(event) => setAreaName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitRename();
                      if (event.key === "Escape") setEditingAreaId(null);
                    }}
                  />
                ) : <strong>{group.areaName}</strong>}
              </div>
              {group.areaId && canRenameArea(group.areaId) ? (
                editingAreaId === group.areaId ? (
                  <div className="team-comments-area-actions">
                    <button type="button" onClick={commitRename}>Speichern</button>
                    <button type="button" onClick={() => setEditingAreaId(null)}>Abbrechen</button>
                  </div>
                ) : <button type="button" onClick={() => startRename(group)}>Umbenennen</button>
              ) : null}
            </header>
            <div className="team-comments-list">
              {group.comments.map((comment) => (
                <article key={comment.id}>
                  <div>
                    <strong>{comment.targetLabel}</strong>
                    <span>{targetTypeLabel(comment.targetType)} · {comment.authorLabel} · {formatDate(comment.createdAt)}</span>
                  </div>
                  <p>{comment.body}</p>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
