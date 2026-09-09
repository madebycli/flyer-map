import { PreparationRunner, type PreparationAlarmStorage } from './streetNetwork/runner.ts';
import type { D1DatabaseLike } from "./campaignRepository.ts";
import { syncHeads } from './syncHeads.ts';
import { isRxdbCollectionName, type RxdbCollectionName } from '../src/data/rxdbSyncProtocol.ts';
import { handleRxdbPull, handleRxdbPush } from './rxdbSync.ts';
import { handleNetworkIntent } from './streetNetwork/api.ts';
import type { CampaignExecution } from './campaignExecution.ts';
import { requestDatabase } from './requestDatabase.ts';

/**
 * The Durable Object fans out invalidation and wakes D1 preparation jobs. It never
 * stores campaign documents or credentials; every client still authenticates
 * and catches up through the canonical RxDB pull endpoint.
 */
export type CampaignSyncWebSocket = {
  serializeAttachment?: (value:unknown)=>void;
  deserializeAttachment?: ()=>unknown;
  send(data: string): void;
  close?: (code?: number, reason?: string) => void;
};

export type CampaignSyncDurableObjectState = {
  storage?: PreparationAlarmStorage;
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

  private runner: PreparationRunner | null;
  private db:D1DatabaseLike|undefined;
  constructor(private readonly state: CampaignSyncDurableObjectState, env: unknown) {
    const bindings=env as {DB?:D1DatabaseLike;OSM_OVERPASS_URL?:string};
    this.db=bindings?.DB;
    this.runner=state.storage && bindings?.DB ? new PreparationRunner(state.storage,bindings.DB,{
      upstreamUrl:bindings.OSM_OVERPASS_URL,
      onProgress:(area,progress)=>{
        const message=JSON.stringify({type:'preparation',areaId:area.id,state:progress});
        for(const socket of state.getWebSockets()){
          const scope=socket.deserializeAttachment?.() as {teamId?:string;expiresAt?:number}|undefined;
          if(!scope||!scope.expiresAt||scope.expiresAt<Date.now()||(scope.teamId!=='*'&&scope.teamId!==area.teamId))continue;
          try{socket.send(message);}catch{/* Disconnected client catches up through scoped HTTP. */}
        }
      },
      onCommitted:async(executionDb)=>{
        const campaignId=await state.storage!.get<string>('preparationCampaign');
        if(!campaignId)return;
        const row=await syncHeads(executionDb??bindings.DB!,campaignId);
        this.broadcastChanged(row.seq,row.collections);
      },
    }):null;
  }
  async alarm() { await this.runner?.alarm(); }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if(request.method==='POST'&&url.pathname==='/execute'){
      if(request.headers.get(INTERNAL_HEADER)!=='1')return json({error:{code:'forbidden'}},{status:403});
      if(!this.db)return json({error:{code:'database_unavailable'}},{status:503});
      const raw=await request.text();if(new TextEncoder().encode(raw).length>300_000)return json({error:{code:'payload_too_large'}},{status:413});
      let input:CampaignExecution;try{input=JSON.parse(raw);}catch{return json({error:{code:'invalid_json'}},{status:400});}
      if(!input||typeof input.campaignId!=='string'||input.access?.campaignId!==input.campaignId||!['pull','push','network'].includes(input.operation))return json({error:{code:'invalid_execution'}},{status:400});
      const db=requestDatabase(this.db,50);
      const notify=async()=>{const heads=await syncHeads(db,input.campaignId);this.broadcastChanged(heads.seq,heads.collections);};
      if(input.operation==='network')return handleNetworkIntent(new Request('https://campaign-sync.internal/network',{method:'POST',body:JSON.stringify(input.input)}),db,input.campaignId,input.access,notify);
      if(!isRxdbCollectionName(input.collectionName))return json({error:{code:'invalid_collection'}},{status:400});
      const response=input.operation==='pull'
        ? await handleRxdbPull(db,input.campaignId,input.collectionName,input.access,input.input)
        : await handleRxdbPush(db,input.campaignId,input.collectionName,input.access,input.input,{schedule:async(campaignId,restart)=>{if(!this.runner)throw new Error('preparation_runner_unavailable');await this.runner.schedule(campaignId,restart);}});
      if(input.operation==='push'&&response.ok)await notify();
      return response;
    }
    if(request.method==='POST' && url.pathname==='/prepare') {
      if(request.headers.get(INTERNAL_HEADER)!=='1')return json({error:{code:'forbidden'}},{status:403});
      const payload=await request.json() as {campaignId?:unknown;restart?:boolean};
      if(typeof payload.campaignId!=='string'||!/^[A-Za-z0-9._:-]{1,160}$/.test(payload.campaignId))return json({error:{code:'invalid_campaign'}},{status:400});
      if(!this.runner)return json({error:{code:'preparation_runner_unavailable'}},{status:503});
      await this.runner.schedule(payload.campaignId,payload.restart===true);
      return new Response(null,{status:204});
    }
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
      const collections=payload&&typeof payload==='object'&&'collections' in payload?payload.collections:undefined;
      this.broadcastChanged(seq,collections&&typeof collections==='object'&&!Array.isArray(collections)?Object.fromEntries(Object.entries(collections).filter(([name,value])=>isRxdbCollectionName(name)&&parsedSequence(value)!==null&&Number(value)<=seq)):undefined);
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
    pair[1].serializeAttachment?.({teamId:request.headers.get('x-campaign-sync-team'),expiresAt:Date.now()+5*60_000});
    this.state.acceptWebSocket(pair[1]);
    return new Response(null, {
      status: 101,
      webSocket: pair[0],
    } as ResponseInit & { webSocket: CampaignSyncWebSocket });
  }

  /** Broadcast a tiny checkpoint hint; the pull endpoint remains authoritative. */
  broadcastChanged(seq: number,collections?:Partial<Record<RxdbCollectionName,number>>) {
    if (!Number.isSafeInteger(seq) || seq < 0 || seq <= this.lastBroadcastSeq) return;
    this.lastBroadcastSeq = seq;
    const message = JSON.stringify({ type: "changed", seq,...(collections?{collections}:{}) });
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
  const row = await syncHeads(db,campaignId);
  const seq = parsedSequence(row?.seq);
  if (seq === null || seq === 0) return;
  const id = namespace.idFromName(campaignId);
  await namespace.get(id).fetch("https://campaign-sync.internal/notify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [INTERNAL_HEADER]: "1",
    },
    body: JSON.stringify({ seq,collections:row.collections }),
  });
}

export async function schedulePreparation(namespace:CampaignSyncNamespace|undefined,campaignId:string,restart=false) {
  if(!namespace)throw new Error('preparation_runner_unavailable');
  const response=await namespace.get(namespace.idFromName(campaignId)).fetch('https://campaign-sync.internal/prepare',{
    method:'POST',headers:{'content-type':'application/json',[INTERNAL_HEADER]:'1'},body:JSON.stringify({campaignId,restart}),
  });
  if(!response.ok)throw new Error('preparation_runner_unavailable');
}
