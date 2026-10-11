import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchRooms } from './api.ts';
import type { RoomRecord } from './roomsLogic.ts';

/**
 * The rooms of the Aktion as the server has them, polled while the page is visible (an open room changes: headcount, houses, who ended it), plus a clock
 * that follows the server's time (the phone's clock may be off by minutes; a timer that starts at the wrong moment is worse than none).
 */
export function useRooms(campaignId: string, enabled: boolean) {
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offset = useRef(0);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const reply = await fetchRooms(campaignId);
      offset.current = reply.serverNow - Date.now();
      setRooms(reply.rooms); setLoaded(true); setError(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Räume konnten nicht geladen werden'); }
  }, [campaignId, enabled]);
  useEffect(() => {
    if (!enabled) { setRooms([]); setLoaded(false); return; }
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15_000);
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [enabled, refresh]);
  /** Server time now. */
  const now = useCallback(() => Date.now() + offset.current, []);
  return { rooms, loaded, error, refresh, now, active: rooms.filter((r) => r.status === 'active') };
}

/** A value that changes every `ms` while `on`: what makes a timer tick. */
export function useTick(on: boolean, ms: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), ms);
    return () => window.clearInterval(timer);
  }, [on, ms]);
  return tick;
}
