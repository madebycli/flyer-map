import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const appSource = read("src/organization/OrganizationApp.tsx");
const securitySource = read("src/organization/OrganizationSecurityCenter.tsx");
const inviteSource = read("src/organization/OrganizationInviteCenter.tsx");
const sharedSource = read("src/organization/shared.tsx");
const pickerSource = read("src/organization/AdminMapPicker.tsx");
const kitCss = read("src/ui/kit.css");
const orgMain = read("src/organization/main.tsx");
const mainSource = read("src/main.tsx");

test("one admin navigation exposes campaigns, invitations and the security center on every page", () => {
  assert.match(sharedSource, /label: "Einladungen"[\s\S]*?href: "\/admin\/invites"/u);
  assert.match(sharedSource, /label: "Sicherheit"[\s\S]*?href: "\/admin\/security"/u);
  for (const source of [appSource, securitySource, inviteSource]) assert.match(source, /<AdminBar /u);
});

test("organizer pages scroll like documents and never load the map shell CSS", () => {
  assert.match(kitCss, /html:has\(\.ui-page\), body:has\(\.ui-page\)\s*\{[^}]*overflow: auto/u);
  assert.doesNotMatch(orgMain, /styles\.css|street-mode\.css|m4\.css|ui-dark-mode/u);
  assert.match(orgMain, /import "\.\.\/ui\/ui\.css"/u);
});

test("forms and grids can shrink instead of overflowing horizontally", () => {
  assert.match(kitCss, /\.ui-input\s*\{[^}]*width: 100%;[^}]*min-width: 0;/u);
  assert.match(kitCss, /\.ui-card\s*\{[^}]*min-width: 0;/u);
  assert.match(kitCss, /\.ui-grid > \* \{ min-width: 0; \}/u);
  assert.match(kitCss, /\.ui-form\s*\{[^}]*min-width: 0;/u);
});

test("one-time links open in a themed dialog and invitations live on one page", () => {
  assert.match(inviteSource, /<OneTimeLinkDialog title=\{dialog\.title\} link=\{dialog\.link\}/u);
  assert.match(inviteSource, />Link anzeigen<\/Button>/u);
  assert.match(sharedSource, /role="dialog"|<Dialog /u);
  assert.match(kitCss, /\.ui-scrim/u);
  assert.match(kitCss, /\.ui-btn\.danger/u);
  assert.doesNotMatch(securitySource, /createOrganizationInvite/u, "the security center no longer duplicates the invitation form");
  assert.match(securitySource, /href="\/admin\/invites"/u);
});

test("secrets travel in the URL fragment and are removed from the address bar once read", () => {
  assert.match(inviteSource, /url\.hash = new URLSearchParams\(\{ token: secret \}\)/u);
  assert.match(sharedSource, /window\.history\.replaceState\(null, "", `\$\{window\.location\.pathname\}\$\{window\.location\.search\}`\)/u);
});

test("campaign.create is not delegable in the Security Center because new Campaigns are Organizer-only", () => {
  const block = securitySource.slice(securitySource.indexOf("const CAPABILITIES"), securitySource.indexOf("] as const;", securitySource.indexOf("const CAPABILITIES")));
  assert.doesNotMatch(block, /campaign\.create/u);
  assert.match(securitySource, /membership\?\.role === "organizer"/u);
});

test("Admin UI reserves new Campaign creation for Organizer memberships", () => {
  assert.match(appSource, /const canCreateCampaign = Boolean\(me\.assurance === "mfa" && membership\?\.role === "organizer"\)/u);
  assert.match(appSource, /organizerMemberships = me\.memberships\.filter\(\(item\) => item\.role === "organizer"\)/u);
  assert.match(appSource, /Neue Campaigns können ausschließlich von einem Organizer/u);
  assert.doesNotMatch(appSource, /membership\?\.capabilities\.includes\("campaign\.create"\)/u);
});

test("the focus picker uses the deployment's basemap, never a hard-coded tile server", () => {
  assert.match(pickerSource, /fetch\("\/api\/v5\/basemap"/u);
  assert.doesNotMatch(pickerSource, /openstreetmap\.org|tile\.openstreetmap/u);
});

test("the bare root goes to the sign-in page, a campaign address goes to the field map", () => {
  assert.match(mainSource, /toFieldMap\(new URL\(window\.location\.href\)\)/u);
  assert.match(mainSource, /window\.location\.replace\(`\/login\$\{diagnostic\}`\)/u);
  assert.match(appSource, /Feldkarte öffnen/u);
});

test("the entry loads the organiser pages as their own chunk", () => {
  assert.match(mainSource, /import\("\.\/organization\/main\.tsx"\)/u);
  assert.doesNotMatch(mainSource, /legacyMain|PlatformShell|MapView/u);
});
