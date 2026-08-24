import { useCallback, useEffect, useRef, useState } from "react";
import {
  CampaignApiError,
  campaignIdFromUrl,
  fetchCampaignSnapshot,
  fetchCampaignVersion,
  putCampaignSnapshot,
  setCampaignIdInUrl,
} from "./campaignApi";
import {
  loadCampaignSnapshot,
  saveCampaignConflictSnapshot,
  saveCampaignSnapshot,
} from "./campaignStore";
import type { CampaignSnapshot } from "../domain/campaign";

type SyncState = "starting" | "synced" | "saving" | "local-only" | "conflict" | "error";

const POLL_INTERVAL_MS = 5_000;

function isNetworkLikeError(error: unknown) {
  return (
    error instanceof CampaignApiError &&
    (error.status === 0 || error.status === 503)
  );
}

function shouldPreserveBeforeServerReplace(local: CampaignSnapshot, server: CampaignSnapshot) {
  return (
    local.campaign.id !== server.campaign.id ||
    local.revision !== server.revision ||
    JSON.stringify(local) !== JSON.stringify(server)
  );
}

export function useCampaignPersistence(online: boolean) {
  const [initialLoad] = useState(loadCampaignSnapshot);
  const [snapshot, setSnapshot] = useState<CampaignSnapshot>(initialLoad.snapshot);
  const [storageWarning, setStorageWarning] = useState<string | null>(initialLoad.warning);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("starting");
  const [localMutationTick, setLocalMutationTick] = useState(0);

  const snapshotRef = useRef(snapshot);
  const campaignIdRef = useRef<string | null>(null);
  const serverRevisionRef = useRef<number | null>(null);
  const remoteSnapshotRef = useRef<CampaignSnapshot | null>(null);
  const initializedRef = useRef(false);
  const bootstrapInFlightRef = useRef(false);
  const writeInFlightRef = useRef(false);
  const pendingSnapshotRef = useRef<CampaignSnapshot | null>(null);
  const mountedRef = useRef(true);

  const applyRemoteSnapshot = useCallback((next: CampaignSnapshot) => {
    remoteSnapshotRef.current = next;
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  useEffect(() => {
    snapshotRef.current = snapshot;
    setStorageWarning(saveCampaignSnapshot(snapshot));
  }, [snapshot]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reloadServerAfterRejection = useCallback(
    async (campaignId: string, optimisticSnapshot: CampaignSnapshot, message: string) => {
      const preserved = saveCampaignConflictSnapshot(optimisticSnapshot);

      try {
        const serverSnapshot = await fetchCampaignSnapshot(campaignId);
        if (!mountedRef.current) return;
        serverRevisionRef.current = serverSnapshot.revision;
        pendingSnapshotRef.current = null;
        applyRemoteSnapshot(serverSnapshot);
        setSyncState("conflict");
        setSyncWarning(
          `${message} Der aktuelle Serverstand wurde geladen.${
            preserved ? " Deine lokale Version bleibt als Sicherheitskopie in diesem Browser erhalten." : ""
          }`,
        );
      } catch {
        if (!mountedRef.current) return;
        pendingSnapshotRef.current = optimisticSnapshot;
        setSyncState("error");
        setSyncWarning(
          `${message} Der lokale Stand bleibt auf diesem Gerät erhalten; der Serverstand konnte noch nicht neu geladen werden.`,
        );
      }
    },
    [applyRemoteSnapshot],
  );

  const flushPending = useCallback(async () => {
    if (
      !online ||
      !initializedRef.current ||
      writeInFlightRef.current ||
      serverRevisionRef.current === null
    ) {
      return;
    }

    const candidate = pendingSnapshotRef.current;
    const campaignId = campaignIdRef.current;
    if (!candidate || !campaignId || candidate.campaign.id !== campaignId) return;

    pendingSnapshotRef.current = null;
    writeInFlightRef.current = true;
    setSyncState("saving");

    const baseRevision = serverRevisionRef.current;
    const outgoing: CampaignSnapshot = {
      ...candidate,
      revision: baseRevision + 1,
    };

    try {
      const stored = await putCampaignSnapshot(campaignId, baseRevision, outgoing);
      if (!mountedRef.current) return;
      serverRevisionRef.current = stored.revision;
      remoteSnapshotRef.current = stored;

      const latest = snapshotRef.current;
      if (latest === candidate) {
        applyRemoteSnapshot(stored);
        setSyncState("synced");
        setSyncWarning(null);
      } else {
        pendingSnapshotRef.current = latest;
      }
    } catch (error) {
      if (!mountedRef.current) return;
      if (isNetworkLikeError(error)) {
        pendingSnapshotRef.current = candidate;
        setSyncState("local-only");
        setSyncWarning("Änderung ist lokal gespeichert. Der gemeinsame Serverstand ist momentan nicht erreichbar.");
      } else {
        const message =
          error instanceof CampaignApiError && error.code === "revision_conflict"
            ? "Synchronisierungskonflikt: Ein anderes Gerät hat diese Campaign inzwischen geändert."
            : `Server hat die lokale Änderung abgelehnt${
                error instanceof CampaignApiError ? `: ${error.message}` : "."
              }`;
        await reloadServerAfterRejection(campaignId, candidate, message);
      }
    } finally {
      writeInFlightRef.current = false;
      if (mountedRef.current && pendingSnapshotRef.current && online) {
        queueMicrotask(() => void flushPending());
      }
    }
  }, [applyRemoteSnapshot, online, reloadServerAfterRejection]);

  const bootstrap = useCallback(async () => {
    if (bootstrapInFlightRef.current || initializedRef.current || !online) return;
    bootstrapInFlightRef.current = true;
    setSyncState("starting");

    const localAtStart = snapshotRef.current;
    const urlCampaignId = campaignIdFromUrl();
    const targetCampaignId = urlCampaignId ?? localAtStart.campaign.id;
    campaignIdRef.current = targetCampaignId;
    setCampaignIdInUrl(targetCampaignId);

    try {
      let serverSnapshot: CampaignSnapshot;
      try {
        serverSnapshot = await fetchCampaignSnapshot(targetCampaignId);
      } catch (error) {
        if (
          error instanceof CampaignApiError &&
          error.status === 404 &&
          (!urlCampaignId || urlCampaignId === snapshotRef.current.campaign.id)
        ) {
          const local = snapshotRef.current;
          serverSnapshot = await putCampaignSnapshot(targetCampaignId, null, local);
        } else {
          throw error;
        }
      }

      if (!mountedRef.current) return;
      const latestLocal = snapshotRef.current;

      if (
        latestLocal.campaign.id === targetCampaignId &&
        latestLocal.revision > serverSnapshot.revision
      ) {
        try {
          const outgoing: CampaignSnapshot = {
            ...latestLocal,
            revision: serverSnapshot.revision + 1,
          };
          serverSnapshot = await putCampaignSnapshot(
            targetCampaignId,
            serverSnapshot.revision,
            outgoing,
          );
        } catch (error) {
          if (!mountedRef.current) return;
          if (isNetworkLikeError(error)) {
            serverRevisionRef.current = serverSnapshot.revision;
            remoteSnapshotRef.current = serverSnapshot;
            initializedRef.current = true;
            pendingSnapshotRef.current = latestLocal;
            setSyncState("local-only");
            setSyncWarning("Der lokale Stand bleibt erhalten und wird synchronisiert, sobald der Server wieder erreichbar ist.");
            return;
          }

          await reloadServerAfterRejection(
            targetCampaignId,
            latestLocal,
            "Der lokale Start-Cache war neuer als der Server, konnte aber nicht konfliktfrei übernommen werden.",
          );
          initializedRef.current = true;
          serverRevisionRef.current = remoteSnapshotRef.current?.revision ?? null;
          return;
        }
      } else if (shouldPreserveBeforeServerReplace(latestLocal, serverSnapshot)) {
        saveCampaignConflictSnapshot(latestLocal);
      }

      serverRevisionRef.current = serverSnapshot.revision;
      initializedRef.current = true;
      pendingSnapshotRef.current = null;
      applyRemoteSnapshot(serverSnapshot);
      setSyncState("synced");
      setSyncWarning(null);
    } catch (error) {
      if (!mountedRef.current) return;
      if (isNetworkLikeError(error)) {
        setSyncState("local-only");
        setSyncWarning("Gemeinsamer Serverstand ist momentan nicht erreichbar. Der lokale Browser-Stand bleibt verfügbar.");
      } else if (error instanceof CampaignApiError && error.status === 404) {
        setSyncState("error");
        setSyncWarning("Die Campaign aus diesem Link wurde auf dem Server nicht gefunden. Lokale Daten wurden nicht überschrieben.");
      } else {
        setSyncState("error");
        setSyncWarning(
          error instanceof CampaignApiError
            ? `Synchronisierung fehlgeschlagen: ${error.message}`
            : "Synchronisierung ist unerwartet fehlgeschlagen.",
        );
      }
    } finally {
      bootstrapInFlightRef.current = false;
    }
  }, [applyRemoteSnapshot, online, reloadServerAfterRejection]);

  const pollVersion = useCallback(async () => {
    if (
      !online ||
      !initializedRef.current ||
      writeInFlightRef.current ||
      pendingSnapshotRef.current ||
      serverRevisionRef.current === null ||
      !campaignIdRef.current
    ) {
      return;
    }

    try {
      const version = await fetchCampaignVersion(campaignIdRef.current);
      if (!mountedRef.current || version === serverRevisionRef.current) return;

      const current = snapshotRef.current;
      if (remoteSnapshotRef.current && current !== remoteSnapshotRef.current) {
        saveCampaignConflictSnapshot(current);
      }

      const serverSnapshot = await fetchCampaignSnapshot(campaignIdRef.current);
      if (!mountedRef.current) return;
      serverRevisionRef.current = serverSnapshot.revision;
      applyRemoteSnapshot(serverSnapshot);
      setSyncState("synced");
      setSyncWarning(null);
    } catch (error) {
      if (!mountedRef.current || isNetworkLikeError(error)) return;
      setSyncState("error");
      setSyncWarning(
        error instanceof CampaignApiError
          ? `Versionsprüfung fehlgeschlagen: ${error.message}`
          : "Versionsprüfung ist unerwartet fehlgeschlagen.",
      );
    }
  }, [applyRemoteSnapshot, online]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!online) {
      setSyncState("local-only");
      return;
    }

    if (!initializedRef.current) {
      void bootstrap();
      return;
    }

    if (pendingSnapshotRef.current) void flushPending();
  }, [bootstrap, flushPending, online]);

  useEffect(() => {
    if (localMutationTick === 0) return;
    pendingSnapshotRef.current = snapshotRef.current;
    if (initializedRef.current && online) void flushPending();
  }, [flushPending, localMutationTick, online]);

  useEffect(() => {
    if (!online) return;
    const interval = window.setInterval(() => {
      if (!initializedRef.current) void bootstrap();
      else void pollVersion();
    }, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (!initializedRef.current) void bootstrap();
        else void pollVersion();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [bootstrap, online, pollVersion]);

  const commitSnapshot = useCallback(
    (update: (current: CampaignSnapshot) => CampaignSnapshot) => {
      setSnapshot((current) => {
        const next = update(current);
        if (next === current) return current;
        const now = new Date().toISOString();
        const committed: CampaignSnapshot = {
          ...next,
          revision: current.revision + 1,
          campaign: {
            ...next.campaign,
            updatedAt: now,
          },
        };
        snapshotRef.current = committed;
        return committed;
      });
      setLocalMutationTick((current) => current + 1);
    },
    [],
  );

  return {
    snapshot,
    commitSnapshot,
    storageWarning,
    syncWarning,
    syncState,
  };
}
