import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CampaignSyncDurableObject,
  notifyCampaignSync,
  type CampaignSyncDurableObjectState,
  type CampaignSyncWebSocket,
} from "../worker/campaignSyncDurableObject.ts";
import baseWorker from "../worker/index.ts";

class FakeSocket implements CampaignSyncWebSocket {
  readonly messages: string[] = [];
  send(data: string) {
    this.messages.push(data);
  }
}

class FakeState implements CampaignSyncDurableObjectState {
  readonly sockets: FakeSocket[] = [];
  acceptWebSocket(socket: CampaignSyncWebSocket) {
    this.sockets.push(socket as FakeSocket);
  }
  getWebSockets() {
    return this.sockets;
  }
}

function notification(seq: number, internal = true) {
  return new Request("https://campaign-sync.internal/notify", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(internal ? { "x-campaign-sync-internal": "1" } : {}),
    },
    body: JSON.stringify({ seq }),
  });
}

test("Campaign DO broadcasts tiny monotonic signals and ignores duplicates", async () => {
  const state = new FakeState();
  const durableObject = new CampaignSyncDurableObject(state, {});
  const first = new FakeSocket();
  const second = new FakeSocket();
  state.acceptWebSocket(first);
  state.acceptWebSocket(second);

  assert.equal((await durableObject.fetch(notification(123))).status, 204);
  assert.deepEqual(first.messages, ['{"type":"changed","seq":123}']);
  assert.deepEqual(second.messages, ['{"type":"changed","seq":123}']);

  assert.equal((await durableObject.fetch(notification(123))).status, 204);
  assert.equal(first.messages.length, 1, "duplicate feed notifications are harmless");
  assert.equal((await durableObject.fetch(notification(124))).status, 204);
  assert.deepEqual(first.messages.at(-1), '{"type":"changed","seq":124}');
});

test("disconnect/reconnect receives the next checkpoint without storing campaign data", async () => {
  const state = new FakeState();
  const durableObject = new CampaignSyncDurableObject(state, {});
  const oldSocket = new FakeSocket();
  state.acceptWebSocket(oldSocket);
  await durableObject.fetch(notification(200));
  state.sockets.splice(0, state.sockets.length);
  const reconnected = new FakeSocket();
  state.acceptWebSocket(reconnected);
  await durableObject.fetch(notification(201));
  assert.deepEqual(oldSocket.messages, ['{"type":"changed","seq":200}']);
  assert.deepEqual(reconnected.messages, ['{"type":"changed","seq":201}']);
  assert.equal(Object.prototype.hasOwnProperty.call(durableObject, "campaign"), false);
});

test("DO notification is internal and Wrangler has a single Campaign binding/migration", async () => {
  const state = new FakeState();
  const durableObject = new CampaignSyncDurableObject(state, {});
  assert.equal((await durableObject.fetch(notification(1, false))).status, 403);
  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(config, /"name":\s*"CAMPAIGN_SYNC"/u);
  assert.match(config, /"class_name":\s*"CampaignSyncDurableObject"/u);
  assert.match(config, /"tag":\s*"v1-campaign-sync"/u);
  const source = readFileSync(new URL("../worker/campaignSyncDurableObject.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /setInterval/u, "the hibernating DO must not poll while idle");
  assert.match(source, /acceptWebSocket/u);
});

test("Worker authenticates the WebSocket upgrade before forwarding it to the Campaign DO", async () => {
  const forwarded: { request: RequestInfo | URL; init?: RequestInit }[] = [];
  const accessDb = {
    prepare(query: string) {
      return {
        bind() {
          return this;
        },
        async first<T>() {
          if (!query.includes("FROM campaign_sessions")) return null as T | null;
          return {
            grant_id: "grant_realtime",
            campaign_id: "campaign_realtime",
            role: "admin",
            team_id: null,
            label: "Realtime Admin",
          } as T;
        },
        async all<T>() { return { results: [] as T[] }; },
      };
    },
  };
  const namespace = {
    idFromName(name: string) {
      assert.equal(name, "campaign_realtime");
      return "campaign-realtime-id";
    },
    get(id: unknown) {
      assert.equal(id, "campaign-realtime-id");
      return {
        async fetch(request: RequestInfo | URL, init?: RequestInit) {
          forwarded.push({ request, init });
          return Response.json({ forwarded: true });
        },
      };
    },
  };
  const request = new Request("https://flyer.test/api/campaigns/campaign_realtime/rxdb/ws", {
    method: "GET",
    headers: { cookie: "vf_session=authorized" },
  });
  const response = await baseWorker.fetch(request, { DB: accessDb as any, CAMPAIGN_SYNC: namespace });
  assert.equal(response.status, 200);
  assert.equal(forwarded.length, 1);
  const forwardedRequest = forwarded[0].request as Request;
  assert.equal(forwardedRequest.headers.get("upgrade"), "websocket");
  assert.equal(forwardedRequest.headers.get("x-campaign-sync-internal"), "1");

  const deniedDb = {
    prepare() {
      return { bind() { return this; }, async first() { return null; }, async all() { return { results: [] }; } };
    },
  };
  const denied = await baseWorker.fetch(request, { DB: deniedDb as any, CAMPAIGN_SYNC: namespace });
  assert.equal(denied.status, 401, "an unauthenticated upgrade never reaches the DO");
});

test("post-commit notifier targets one Campaign id and sends only the feed high-water mark", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const db = {
    prepare() {
      return {
        bind() { return this; },
        async first<T>() { return { seq: 77 } as T; },
      };
    },
  };
  const namespace = {
    idFromName(name: string) {
      assert.equal(name, "campaign_notify");
      return "notify-id";
    },
    get(id: unknown) {
      assert.equal(id, "notify-id");
      return {
        async fetch(input: RequestInfo | URL, init?: RequestInit) {
          calls.push({ input, init });
          return new Response(null, { status: 204 });
        },
      };
    },
  };
  await notifyCampaignSync(namespace, db as any, "campaign_notify");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init?.method, "POST");
  assert.equal((calls[0].init?.headers as Record<string, string>)["x-campaign-sync-internal"], "1");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { seq: 77 });
});
