import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/organization/OrganizationApp.tsx", import.meta.url), "utf8");
const securitySource = readFileSync(new URL("../src/organization/OrganizationSecurityCenter.tsx", import.meta.url), "utf8");
const adminCss = readFileSync(new URL("../src/organization/organization-admin.css", import.meta.url), "utf8");
const securityCss = readFileSync(new URL("../src/organization/organization-security.css", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");

test("organizer admin exposes the security center in primary navigation", () => {
  assert.match(appSource, /<a href="\/admin\/security">Sicherheit<\/a>/u);
});

test("organizer pages override the map shell scroll lock", () => {
  assert.match(
    adminCss,
    /body:has\(\.org-page\), body:has\(\.org-admin-page\)[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/u,
  );
});

test("security forms can shrink and wrap instead of overflowing horizontally", () => {
  assert.match(adminCss, /\.org-form--panel \{[^}]*max-width: 100%;[^}]*min-width: 0;/u);
  assert.match(adminCss, /\.org-form input, \.org-form select, \.org-select-label select \{[^}]*max-width: 100%;[^}]*min-width: 0;/u);
  assert.match(adminCss, /\.org-radio \{[^}]*max-width: 100%;[^}]*min-width: 0;[^}]*flex-wrap: wrap;/u);
  assert.match(adminCss, /\.org-campaign-grid > \* \{ min-width: 0; \}/u);
});

test("one-time invite links stay attached to their row and open in a themed dialog", () => {
  assert.match(securitySource, /targetId: result\.invite\.id/u);
  assert.match(securitySource, />Link anzeigen<\/button>/u);
  assert.match(securitySource, /<OneTimeLinkDialog value=\{oneTimeLink\}/u);
  assert.doesNotMatch(securitySource, /\{generatedLink \? <section className="org-warning"/u);
  assert.match(securityCss, /\.org-link-dialog-backdrop/u);
  assert.match(securityCss, /\.org-security-action--danger/u);
});

test("campaign.create is not delegable in the Security Center because new Campaigns are Organizer-only", () => {
  const capabilityBlock = securitySource.slice(
    securitySource.indexOf("const CAPABILITIES"),
    securitySource.indexOf("] as const;", securitySource.indexOf("const CAPABILITIES")),
  );
  assert.doesNotMatch(capabilityBlock, /campaign\.create/u);
  assert.match(securitySource, /membership\.role === "organizer"/u);
});

test("bare field root redirects to central login instead of mounting or creating a Campaign", () => {
  assert.match(mainSource, /else if \(!campaignIdFromUrl\(\)\) \{/u);
  assert.match(mainSource, /window\.location\.replace\("\/login"\)/u);
});