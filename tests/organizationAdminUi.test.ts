import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/organization/OrganizationApp.tsx", import.meta.url), "utf8");
const adminCss = readFileSync(new URL("../src/organization/organization-admin.css", import.meta.url), "utf8");

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
