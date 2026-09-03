import { chromium } from "playwright";

const baseUrl = process.env.STAGING_URL;
if (!baseUrl) throw new Error("STAGING_URL missing");

const now = new Date().toISOString();
const suffix = crypto.randomUUID();
const campaignId = `campaign_browser_gate_${suffix}`;
const teamId = `team_browser_gate_${suffix}`;
const areaId = `area_browser_gate_${suffix}`;
const initialStreetId = `task_initial_${suffix}`;
const initialHouseId = `task_house_${suffix}`;
const liveStreetId = `task_live_${suffix}`;
const teamName = `Browser Gate Team ${suffix.slice(0, 8)}`;
const liveStreetLabel = `Live Street ${suffix.slice(0, 8)}`;
const collections = ["campaigns", "teams", "areas", "streetTasks", "houseTasks"];

const snapshot = {
  schemaVersion: 3,
  revision: 0,
  campaign: {
    id: campaignId,
    name: `Browser Gate ${suffix.slice(0, 8)}`,
    status: "active",
    defaultMapView: null,
    createdAt: now,
    updatedAt: now,
  },
  teams: [{
    id: teamId,
    campaignId,
    name: teamName,
    color: "#2563eb",
    createdAt: now,
    updatedAt: now,
  }],
  areas: [{
    id: areaId,
    campaignId,
    teamId,
    name: "Browser Gate Area",
    geometry: {
      type: "Polygon",
      coordinates: [[
        [12.56, 55.67],
        [12.58, 55.67],
        [12.58, 55.69],
        [12.56, 55.69],
        [12.56, 55.67],
      ]],
    },
    createdAt: now,
    updatedAt: now,
  }],
  tasks: [{
    id: initialStreetId,
    campaignId,
    areaId,
    taskType: "street",
    label: "Initial Street",
    geometry: { type: "LineString", coordinates: [[12.565, 55.675], [12.575, 55.685]] },
    areaPreparationGeneration: null,
    status: "open",
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  }],
  houseTasks: [{
    id: initialHouseId,
    campaignId,
    areaId,
    taskType: "house",
    label: "Initial House",
    geometry: {
      type: "Polygon",
      coordinates: [[
        [12.568, 55.678],
        [12.569, 55.678],
        [12.569, 55.679],
        [12.568, 55.679],
        [12.568, 55.678],
      ]],
    },
    areaPreparationGeneration: null,
    parentStreetTaskId: initialStreetId,
    status: "open",
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  }],
};

function initialPullGate(page, label) {
  const seen = new Map();
  let resolveGate;
  let rejectGate;
  const promise = new Promise((resolve, reject) => {
    resolveGate = resolve;
    rejectGate = reject;
  });
  const timer = setTimeout(() => {
    rejectGate(new Error(`${label}: timed out waiting for initial pulls; seen=${JSON.stringify([...seen.keys()])}`));
  }, 30_000);

  page.on("response", async (response) => {
    const match = new URL(response.url()).pathname.match(/\/rxdb\/pull\/(campaigns|teams|areas|streetTasks|houseTasks)$/);
    if (!match) return;
    const collection = match[1];
    let body = null;
    try { body = await response.json(); } catch {}
    if (response.status() !== 200) {
      clearTimeout(timer);
      rejectGate(new Error(`${label}: ${collection} pull failed ${response.status()} ${JSON.stringify(body)}`));
      return;
    }
    seen.set(collection, body);
    if (collections.every((name) => seen.has(name))) {
      clearTimeout(timer);
      resolveGate(seen);
    }
  });
  return promise;
}

function documentPullGate(page, collectionName, documentId, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: no live ${collectionName} pull containing ${documentId}`)), 20_000);
    const handler = async (response) => {
      const path = new URL(response.url()).pathname;
      if (!path.endsWith(`/rxdb/pull/${collectionName}`)) return;
      let body = null;
      try { body = await response.json(); } catch {}
      if (response.status() !== 200) {
        clearTimeout(timer);
        page.off("response", handler);
        reject(new Error(`${label}: live pull failed ${response.status()} ${JSON.stringify(body)}`));
        return;
      }
      if (Array.isArray(body?.documents) && body.documents.some((document) => document?.id === documentId)) {
        clearTimeout(timer);
        page.off("response", handler);
        resolve(body);
      }
    };
    page.on("response", handler);
  });
}

async function accessOf(context) {
  const response = await context.request.get(`${baseUrl}/api/access/current?campaign=${encodeURIComponent(campaignId)}`);
  const body = await response.json();
  if (response.status() !== 200) throw new Error(`access/current failed ${response.status()} ${JSON.stringify(body)}`);
  return body.access;
}

const browser = await chromium.launch({ headless: true });
try {
  const contextA = await browser.newContext();
  const createResponse = await contextA.request.post(`${baseUrl}/api/campaigns`, { data: { snapshot } });
  const created = await createResponse.json();
  if (!createResponse.ok()) throw new Error(`campaign create failed ${createResponse.status()} ${JSON.stringify(created)}`);
  if (!created?.initialAccessToken) throw new Error("campaign create returned no initialAccessToken");

  const contextB = await browser.newContext();
  const redeemResponse = await contextB.request.post(`${baseUrl}/api/access/redeem`, {
    data: { campaignId, token: created.initialAccessToken },
  });
  const redeemed = await redeemResponse.json();
  if (!redeemResponse.ok()) throw new Error(`second-browser redeem failed ${redeemResponse.status()} ${JSON.stringify(redeemed)}`);

  const accessA = await accessOf(contextA);
  const accessB = await accessOf(contextB);
  if (accessA?.role !== "admin" || accessB?.role !== "admin") {
    throw new Error(`expected admin in both browsers, got A=${JSON.stringify(accessA)} B=${JSON.stringify(accessB)}`);
  }

  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const pullA = initialPullGate(pageA, "browser A");
  const pullB = initialPullGate(pageB, "browser B");
  await Promise.all([
    pageA.goto(`${baseUrl}/?campaign=${encodeURIComponent(campaignId)}`, { waitUntil: "domcontentloaded" }),
    pageB.goto(`${baseUrl}/?campaign=${encodeURIComponent(campaignId)}`, { waitUntil: "domcontentloaded" }),
  ]);

  const [seenA, seenB] = await Promise.all([pullA, pullB]);
  for (const [label, seen] of [["A", seenA], ["B", seenB]]) {
    const teams = seen.get("teams")?.documents;
    if (!Array.isArray(teams) || !teams.some((team) => team.id === teamId && team.name === teamName)) {
      throw new Error(`browser ${label}: admin did not receive canonical team ${teamId}`);
    }
  }

  await pageB.waitForTimeout(500);
  const textB = await pageB.locator("body").innerText();
  if (/Synchronisierung fehlgeschlagen|Datenbankmigration/i.test(textB)) {
    throw new Error(`browser B still shows sync/migration error: ${textB.slice(0, 1000)}`);
  }

  let mainFrameNavigations = 0;
  pageB.on("framenavigated", (frame) => {
    if (frame === pageB.mainFrame()) mainFrameNavigations += 1;
  });
  const livePull = documentPullGate(pageB, "streetTasks", liveStreetId, "browser B");
  const mutation = {
    id: `mutation_${crypto.randomUUID()}`,
    campaignId,
    type: "task.create",
    payload: {
      taskId: liveStreetId,
      areaId,
      label: liveStreetLabel,
      geometry: { type: "LineString", coordinates: [[12.566, 55.676], [12.576, 55.686]] },
      source: null,
    },
    baseRevision: 0,
    createdAt: new Date().toISOString(),
  };

  const mutationResult = await pageA.evaluate(async ({ campaignId, mutation }) => {
    const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/mutations`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mutation, fieldGroupId: null }),
    });
    let body = null;
    try { body = await response.json(); } catch {}
    return { status: response.status, body };
  }, { campaignId, mutation });
  if (mutationResult.status !== 200) {
    throw new Error(`browser A mutation failed ${mutationResult.status} ${JSON.stringify(mutationResult.body)}`);
  }

  const liveBody = await livePull;
  if (!liveBody.documents.some((document) => document.id === liveStreetId && document.label === liveStreetLabel)) {
    throw new Error("browser B live pull did not contain expected street document");
  }
  if (mainFrameNavigations !== 0) {
    throw new Error(`browser B navigated/reloaded ${mainFrameNavigations} times during live sync`);
  }

  const finalTextB = await pageB.locator("body").innerText();
  if (/Synchronisierung fehlgeschlagen|Datenbankmigration/i.test(finalTextB)) {
    throw new Error(`browser B entered sync error after live update: ${finalTextB.slice(0, 1000)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    campaignId,
    accessA: { role: accessA.role, teamId: accessA.teamId ?? null },
    accessB: { role: accessB.role, teamId: accessB.teamId ?? null },
    initialPullsA: collections,
    initialPullsB: collections,
    adminReceivedTeam: teamName,
    liveStreetReceivedWithoutReload: liveStreetId,
  }, null, 2));

  await contextA.close();
  await contextB.close();
} finally {
  await browser.close();
}
