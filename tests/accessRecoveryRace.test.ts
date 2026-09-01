import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { accessTokenFromUrl } from "../src/data/campaignApi.ts";
import {
  loadCampaignSnapshot,
  saveCampaignSnapshot,
  subscribeCampaignStore,
  type CampaignStoreUpdate,
} from "../src/data/campaignStore.ts";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";

const campaignId = "campaign_access-race";
const accessToken = "a".repeat(64);
const timestamp = "2026-09-01T00:00:00.000Z";

function serverSnapshot(): CampaignSnapshot {
  return {
    schemaVersion: 3,
    revision: 0,
    campaign: {
      id: campaignId,
      name: "Access Race",
      status: "active",
      defaultMapView: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    teams: [],
    areas: [],
    tasks: [],
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for campaign access state.");
}

test("fresh Access-Link startup waits for redemption before operator recovery", async () => {
  const gateSource = await readFile(
    new URL("../src/access/AccessRecoveryGate.tsx", import.meta.url),
    "utf8",
  );
  assert.match(gateSource, /subscribeCampaignStore/u);
  assert.doesNotMatch(gateSource, /fetchCurrentAccess/u);

  const storage = memoryStorage();
  const location = {
    href: "https://flyer.test/?campaign=" + campaignId + "#access=" + accessToken,
  };
  const fakeWindow = {
    location,
    history: {
      replaceState(_state: unknown, _title: string, next: string | URL) {
        location.href = String(next);
      },
    },
    localStorage: storage,
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    setInterval() {
      return 0;
    },
  };
  const fakeDocument = {
    addEventListener() {},
    removeEventListener() {},
    visibilityState: "visible",
  };
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  let redeemResolver: ((response: Response) => void) | null = null;
  let redeemStarted!: () => void;
  const redeemHasStarted = new Promise<void>((resolve) => {
    redeemStarted = resolve;
  });
  const redeemResponse = new Promise<Response>((resolve) => {
    redeemResolver = resolve;
  });

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: fakeDocument,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    requests.push(path);
    if (path === "/api/access/redeem") {
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        campaignId,
        token: accessToken,
      });
      redeemStarted();
      return redeemResponse;
    }
    if (path === "/api/campaigns/" + campaignId + "/snapshot") {
      return Response.json(serverSnapshot());
    }
    throw new Error("Unexpected request: " + path);
  };

  const updates: CampaignStoreUpdate[] = [];
  const unsubscribe = subscribeCampaignStore((update) => updates.push(update));

  try {
    saveCampaignSnapshot(loadCampaignSnapshot().snapshot);
    await redeemHasStarted;

    assert.equal(updates.at(-1)?.accessState, "pending");
    assert.equal(updates.some((update) => update.accessState === "required"), false);
    assert.equal(accessTokenFromUrl(), accessToken);
    assert.equal(
      requests.some((path) => path.includes("/api/access/current")),
      false,
    );

    redeemResolver!(Response.json({
      access: {
        campaignId,
        role: "team-editor",
        teamId: "team_existing",
        label: "Team Nord",
      },
    }));

    await waitFor(
      () => updates.some((update) => update.accessState === "authenticated") &&
        accessTokenFromUrl() === null,
    );

    const authenticated = [...updates]
      .reverse()
      .find((update) => update.accessState === "authenticated");
    assert.equal(authenticated?.access?.role, "team-editor");
    assert.equal(authenticated?.access?.teamId, "team_existing");
    assert.equal(
      [...storage.values.values()].some((value) => value.includes(accessToken)),
      false,
    );
    assert.deepEqual(
      requests.filter((path) => path.includes("/api/access/current")),
      [],
    );
  } finally {
    unsubscribe();
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete (globalThis as { window?: unknown }).window;
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else delete (globalThis as { document?: unknown }).document;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
});
