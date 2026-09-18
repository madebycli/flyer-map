import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fetchCanonicalAreas } from "../src/data/campaignApi.ts";

test("canonical Area bootstrap ignores tombstones and does not depend on the full snapshot endpoint", async () => {
  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return Response.json({
      documents: [
        { id: "area_old", name: "Alt", updatedAt: "2026-09-17T10:00:00.000Z", _deleted: true },
        { id: "area_current", name: "Aktuell", updatedAt: "2026-09-18T18:22:29.741Z" },
      ],
      checkpoint: { seq: 267 },
      campaignRevision: 20,
    });
  }) as typeof fetch;
  try {
    const areas = await fetchCanonicalAreas("campaign_test");
    assert.deepEqual(areas, [{ id: "area_current", name: "Aktuell", updatedAt: "2026-09-18T18:22:29.741Z" }]);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!, /\/api\/campaigns\/campaign_test\/rxdb\/pull\/areas/u);
    assert.doesNotMatch(calls[0]!, /snapshot/u);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("sync issue dialog opens per distinct incident instead of every retry emission", async () => {
  const source = await readFile("src/sync/SyncStatus.tsx", "utf8");
  assert.match(source, /function syncIssueFingerprint/u);
  assert.match(source, /activeIssueFingerprint = useRef<string \| null>\(null\)/u);
  assert.match(source, /const changed = fingerprint !== activeIssueFingerprint\.current/u);
  assert.match(source, /if \(changed\) \{[\s\S]*?setOpen\(true\);/u);
  assert.doesNotMatch(source, /if \(update\.syncIssue\) setOpen\(true\)/u);
  assert.match(source, /onClick=\{dismissIssue\}>Verstanden/u);
});

test("V4 diagnostics only poll preparation for a server-confirmed canonical Area", async () => {
  const source = await readFile("src/diagnostics/StreetEngineDiagnosticsV4.tsx", "utf8");
  assert.match(source, /fetchCanonicalAreas\(campaignId\)/u);
  assert.match(source, /areaSource!=="server"/u);
  assert.match(source, /LocalStorage nur zur Fehleranalyse, nicht autoritativ/u);
  assert.match(source, /Für lokale\/veraltete Gebiete wird keine Vorbereitung abgefragt/u);
  assert.doesNotMatch(source, /fetchCampaignSnapshot/u);
});

test("Street Engine preparation turns canonical area_not_found into a stale-local recovery message", async () => {
  const source = await readFile("src/map/useNetworkWorkspace.tsx", "utf8");
  assert.match(source, /response\.status===404&&code==='area_not_found'/u);
  assert.match(source, /Dieses lokale Gebiet ist nicht mehr im gemeinsamen Serverstand/u);
  assert.match(source, /void refresh\(\)\.catch\(\(\)=>undefined\)/u);
});
