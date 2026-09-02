import type { D1DatabaseLike } from "./campaignRepository.ts";

/**
 * The Durable Object is intentionally only an invalidation fan-out.  It never
 * stores campaign documents or credentials; every client still authenticates
 * and catches up through the canonical RxDB pull endpoint.
 */
export type CampaignSyncWebSocket = {
  send(data: string): void;
  close?: (code?: number, reason?: string) => void;
};

export type CampaignSyncDurableObjectState = {
  acceptWebSocket(socket: CampaignSyncWebSocket): void;
  getWebSockets(): CampaignSyncWebSocket[];
};

export type CampaignSyncNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
};

const INTERNAL_HEADER = "x-campaign-sync-internal";
const NO_STORE_HEADERS = { "cache-control": "no-store" };

function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, {
    ...init,
    headers: { ...NO_STORE_HEADERS, ...init.headers },
  });
}

function parsedSequence(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export class CampaignSyncDurableObject {
  private lastBroadcastSeq = 0;

  constructor(private readonly state: CampaignSyncDurableObjectState, _env: unknown) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname.endsWith("/notify")) {
      if (request.headers.get(INTERNAL_HEADER) !== "1") {
        return json({ error: { code: "forbidden", message: "Interne Benachrichtigung erforderlich." } }, { status: 403 });
      }
      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return json({ error: { code: "invalid_notification", message: "Ungültige Realtime-Benachrichtigung." } }, { status: 400 });
      }
      const seq = parsedSequence(payload && typeof payload === "object" ? (payload as Record<string, unknown>).seq : null);
      if (seq === null) {
        return json({ error: { code: "invalid_notification", message: "Die Feed-Sequenz ist ungültig." } }, { status: 400 });
      }
      this.broadcastChanged(seq);
      return new Response(null, { status: 204, headers: NO_STORE_HEADERS });
    }

    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: { code: "upgrade_required", message: "Campaign-Realtime benötigt einen WebSocket-Upgrade." } }, { status: 426 });
    }
    if (request.headers.get(INTERNAL_HEADER) !== "1") {
      return json({ error: { code: "forbidden", message: "Interne Campaign-Realtime-Verbindung erforderlich." } }, { status: 403 });
    }
    const WebSocketPairConstructor = (globalThis as typeof globalThis & {
      WebSocketPair?: new () => { 0: CampaignSyncWebSocket; 1: CampaignSyncWebSocket };
    }).WebSocketPair;
    if (!WebSocketPairConstructor) {
      // Node-based unit tests and local HTTP preview do not expose the
      // Workers WebSocketPair.  Production Workers always do.
      return json({ error: { code: "websocket_unavailable", message: "WebSocket-Realtime ist in dieser Laufzeit nicht verfügbar." } }, { status: 501 });
    }
    const pair = new WebSocketPairConstructor();
    this.state.acceptWebSocket(pair[1]);
    return new Response(null, {
      status: 101,
      webSocket: pair[0],
    } as ResponseInit & { webSocket: CampaignSyncWebSocket });
  }

  /** Broadcast a tiny checkpoint hint; the pull endpoint remains authoritative. */
  broadcastChanged(seq: number) {
    if (!Number.isSafeInteger(seq) || seq < 0 || seq <= this.lastBroadcastSeq) return;
    this.lastBroadcastSeq = seq;
    const message = JSON.stringify({ type: "changed", seq });
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // Hibernating sockets can disappear between enumeration and send.
      }
    }
  }

  // Hibernation callbacks.  Clients never send domain writes through the DO.
  webSocketMessage(_socket: CampaignSyncWebSocket, _message: string | ArrayBuffer) {}
  webSocketClose(_socket: CampaignSyncWebSocket, _code: number, _reason: string, _wasClean: boolean) {}
  webSocketError(_socket: CampaignSyncWebSocket, _error: unknown) {}
}

/** Notify the one Campaign DO only after the D1/feed commit has succeeded. */
export async function notifyCampaignSync(
  namespace: CampaignSyncNamespace | undefined,
  db: D1DatabaseLike,
  campaignId: string,
) {
  if (!namespace) return;
  const row = await db.prepare(
    "SELECT COALESCE(MAX(seq), 0) AS seq FROM campaign_sync_changes WHERE campaign_id = ?",
  ).bind(campaignId).first<{ seq: number }>();
  const seq = parsedSequence(row?.seq);
  if (seq === null || seq === 0) return;
  const id = namespace.idFromName(campaignId);
  await namespace.get(id).fetch("https://campaign-sync.internal/notify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [INTERNAL_HEADER]: "1",
    },
    body: JSON.stringify({ seq }),
  });
}
