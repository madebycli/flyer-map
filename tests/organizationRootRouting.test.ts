import assert from "node:assert/strict";
import test from "node:test";
import { redirectBareRootToOrganizationLogin } from "../worker/indexOrganizer.ts";

test("bare Organizer Worker root redirects to central login", () => {
  for (const method of ["GET", "HEAD"] as const) {
    const response = redirectBareRootToOrganizationLogin(new Request("https://flyer.test/", { method }));
    assert.equal(response?.status, 302);
    assert.equal(response?.headers.get("location"), "https://flyer.test/login");
  }
});

test("explicit Campaign field links and workbench links are not redirected", () => {
  assert.equal(
    redirectBareRootToOrganizationLogin(new Request("https://flyer.test/?campaign=campaign_a")),
    null,
  );
  assert.equal(
    redirectBareRootToOrganizationLogin(new Request("https://flyer.test/?workbench=ui")),
    null,
  );
  assert.equal(
    redirectBareRootToOrganizationLogin(new Request("https://flyer.test/admin")),
    null,
  );
});

test("invalid or missing Campaign selectors cannot enter the field runtime", () => {
  for (const url of [
    "https://flyer.test/",
    "https://flyer.test/?foo=bar",
    "https://flyer.test/?campaign=%2Fbad",
  ]) {
    assert.equal(redirectBareRootToOrganizationLogin(new Request(url))?.status, 302);
  }
});