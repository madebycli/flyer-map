import type { Meta } from './api.ts';
import { postMutation } from './api.ts';

type Area = Meta['areas'][number];
export type Me = { collectorId: string; label: string } | null;

/** What the Gebietsliste shows for one Area, derived only from server state (never from what the UI did last). */
export type AreaView = {
  phase: 'open' | 'working' | 'done';
  /** Names of the people currently in the Area's Room. */
  members: string[];
  /** This device holds the Area (claimed it itself). */
  mine: boolean;
  /** This device is in the Area's Room (holder or participant). */
  inRoom: boolean;
  canClaim: boolean;
  canJoin: boolean;
  canLeave: boolean;
  canRelease: boolean;
  canComplete: boolean;
  runId: string | null;
};

export function areaView(area: Area, runs: Meta['runs'], me: Me): AreaView {
  const info = area.collection;
  const none: AreaView = { phase: 'open', members: [], mine: false, inRoom: false, canClaim: false, canJoin: false, canLeave: false, canRelease: false, canComplete: false, runId: null };
  if (!info || info.status === 'archived') return { ...none, phase: 'done' };
  if (info.status === 'completed') return { ...none, phase: 'done', runId: info.runId };
  const run = info.runId ? runs.find((r) => r.id === info.runId) : undefined;
  if (info.status === 'open' || !run) return { ...none, phase: 'open', canClaim: !!me && info.status === 'open' };
  const inRoom = !!me && run.members.some((m) => m.collectorId === me.collectorId);
  const mine = !!me && info.claimedById === me.collectorId;
  return {
    phase: 'working', members: run.members.map((m) => m.label), mine, inRoom, runId: run.id,
    canClaim: false, canJoin: !!me && !inRoom, canLeave: inRoom, canRelease: mine && inRoom, canComplete: inRoom,
  };
}

/** Finished Areas count fully; unfinished ones never read 100 %, however many houses are done. */
export function areaPercent(done: number, total: number, phase: AreaView['phase']): number | null {
  if (total <= 0) return null;
  const raw = (done / total) * 100;
  if (phase === 'done') return 100;
  return Math.min(99, Math.floor(raw));
}

const uid = (prefix: string) => `collection_${prefix}_${crypto.randomUUID()}`;

/** The legacy Run/claim mutations, with the identity of this device. Each call is one idempotent user action. */
export function collectionActions(campaignId: string, meta: Meta) {
  const me = meta.collectorId ? { collectorId: meta.collectorId, label: meta.collectorLabel ?? 'Helfer' } : null;
  const send = (type: string, payload: Record<string, unknown>) => postMutation(campaignId, type, payload, { revisionFrom: 'collection' });
  const need = () => { if (!me) throw new Error('Nur Abhol-Helfer können Gebiete übernehmen.'); return me; };
  return {
    /** Übernehmen: the first Area of a helper creates the Room (Run); further Areas go into the same one. */
    async claim(areaId: string) {
      const who = need();
      let run = meta.runs.find((r) => r.members.some((m) => m.collectorId === who.collectorId));
      if (!run) {
        if (!meta.mainAreaId) throw new Error('Die Aktion hat noch kein Sammelgebiet.');
        const runId = uid('run');
        await send('collection.run.start', { runId, memberId: uid('member'), mainAreaId: meta.mainAreaId, collectorId: who.collectorId, label: who.label });
        run = { id: runId, mainAreaId: meta.mainAreaId, members: [{ collectorId: who.collectorId, label: who.label }] };
      }
      await send('collection.run.claim-areas', { runId: run.id, collectorId: who.collectorId, collectorLabel: who.label, areaIds: [areaId] });
      await send('collection.run.start-area', { runId: run.id, collectorId: who.collectorId, areaId });
    },
    /** Teilnehmen: join the existing Room instead of creating a competing one. */
    async join(runId: string) { const who = need(); await send('collection.run.join', { runId, memberId: uid('member'), collectorId: who.collectorId, label: who.label }); },
    async leave(runId: string) { const who = need(); await send('collection.run.leave', { runId, collectorId: who.collectorId }); },
    async release(runId: string, areaId: string) { const who = need(); await send('collection.run.release-area', { runId, areaId, collectorId: who.collectorId }); },
    async complete(runId: string, areaId: string) { const who = need(); await send('collection.run.complete-area', { runId, areaId, collectorId: who.collectorId }); },
  };
}

/** Why an action failed, in words a helper understands (the server's conflict codes are not for people). */
export function actionErrorText(error: unknown): string {
  const code = (error as { code?: string }).code ?? '';
  if (/area_unavailable|not_claimed|not_releasable|not_completable/.test(code)) return 'Das Gebiet wurde inzwischen von jemand anderem verändert.';
  if (/run_not_active/.test(code)) return 'Der Arbeitsraum ist nicht mehr aktiv.';
  if (/member/.test(code)) return 'Du bist nicht (mehr) im Arbeitsraum.';
  return 'Das hat nicht geklappt. Bitte erneut versuchen.';
}
