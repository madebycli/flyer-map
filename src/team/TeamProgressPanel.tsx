import { useEffect, useMemo, useState } from "react";
import { fetchCampaignSnapshot } from "../data/campaignApi.ts";
import { loadCampaignSnapshot } from "../data/campaignStore.ts";
import type { CampaignSnapshot } from "../domain/campaign.ts";
import {
  calculateTeamHouseProgress,
  calculateTeamProgress,
} from "../domain/progressStats.ts";

type TeamProgressPanelProps = {
  campaignId: string | null;
  teamId: string | null;
  online: boolean;
};

type LoadState = "idle" | "loading" | "ready" | "error";

function completedLabel(completed: number, total: number, noun: string) {
  if (total === 0) return `Noch keine ${noun}`;
  const percent = Math.round((completed / total) * 100);
  return `${completed} / ${total} · ${percent} %`;
}

export function TeamProgressPanel({ campaignId, teamId, online }: TeamProgressPanelProps) {
  const [snapshot, setSnapshot] = useState<CampaignSnapshot | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [source, setSource] = useState<"server" | "local">("server");

  useEffect(() => {
    let cancelled = false;

    if (!campaignId || !teamId) {
      setSnapshot(null);
      setLoadState("idle");
      return () => {
        cancelled = true;
      };
    }

    if (!online) {
      const local = loadCampaignSnapshot().snapshot;
      if (local.campaign.id !== campaignId) {
        setSnapshot(null);
        setLoadState("error");
      } else {
        setSnapshot(local);
        setSource("local");
        setLoadState("ready");
      }
      return () => {
        cancelled = true;
      };
    }

    setLoadState("loading");
    setSource("server");
    void fetchCampaignSnapshot(campaignId)
      .then((next) => {
        if (cancelled) return;
        setSnapshot(next);
        setLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setSnapshot(null);
        setLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [campaignId, teamId, online]);

  const progress = useMemo(() => {
    if (!snapshot || !teamId) return null;
    return {
      streets: calculateTeamProgress(snapshot, teamId),
      houses: calculateTeamHouseProgress(snapshot, teamId),
    };
  }, [snapshot, teamId]);

  if (!campaignId || !teamId) return null;

  return (
    <div className="team-hub-progress" aria-live="polite">
      <div className="team-hub-meta-row">
        <span>Team-Fortschritt</span>
        <strong>{source === "local" ? "Lokaler Stand" : "Serverstand"}</strong>
      </div>
      {loadState === "loading" ? <p>Fortschritt wird geladen ...</p> : null}
      {loadState === "error" ? <p>Fortschritt ist gerade nicht verfügbar.</p> : null}
      {loadState === "ready" && progress ? (
        <div className="team-hub-info-grid">
          <div>
            <span>Straßen</span>
            <strong>
              {completedLabel(progress.streets.completed, progress.streets.total, "Straßen")}
            </strong>
          </div>
          <div>
            <span>Häuser</span>
            <strong>
              {completedLabel(progress.houses.completed, progress.houses.total, "Häuser")}
            </strong>
          </div>
        </div>
      ) : null}
    </div>
  );
}
