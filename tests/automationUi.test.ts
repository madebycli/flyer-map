import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Automationen use the real Admin launcher path and remain server-controlled", async () => {
  const [worker, api, shell, hub, css, contract, domain] = await Promise.all([
    readFile("worker/automationConfig.ts", "utf8"),
    readFile("src/data/automationApi.ts", "utf8"),
    readFile("src/platform/PlatformShell.tsx", "utf8"),
    readFile("src/collaboration/AutomationHub.tsx", "utf8"),
    readFile("src/collaboration/automation-hub.css", "utf8"),
    readFile("src/platform/platformContract.ts", "utf8"),
    readFile("src/domain/automations.ts", "utf8"),
  ]);

  assert.match(worker, /access\.role !== "admin"/u);
  assert.match(worker, /automation_rules/u);
  assert.match(worker, /request\.method !== "GET" && request\.method !== "PATCH"/u);
  assert.match(api, /credentials: "same-origin"/u);
  assert.match(api, /cache: "no-store"/u);
  assert.match(api, /method: "PATCH"/u);
  assert.match(contract, /context\.accessRole === "admin"/u);
  assert.match(contract, /label: "Automationen"/u);
  assert.match(shell, /<AutomationHub/u);
  assert.match(shell, /automationsOpen/u);
  assert.match(hub, /Migration 0009/u);
  assert.match(hub, /bereits geladene Konfiguration bleibt sichtbar/u);
  assert.match(hub, /Wird gespeichert/u);
  assert.match(hub, /disabled=\{!online/u);
  assert.match(hub, /role="switch"/u);
  assert.doesNotMatch(hub, /setInterval|setTimeout|setImmediate/u);
  assert.doesNotMatch(hub, /dangerouslySetInnerHTML/u);
  assert.doesNotMatch(hub, /fake|mock|Workbench/iu);
  assert.match(css, /min-height: 2\.55rem/u);
  assert.match(css, /max-height: min\(92dvh/u);
  assert.match(domain, /complete-parent-street-when-all-houses-complete/u);
});
