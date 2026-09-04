import assert from "node:assert/strict";
import test from "node:test";
import { canDelegateOrganizationAccess } from "../worker/organizationDelegationGuard.ts";

test("Organizer may delegate any registered Organization capability", () => {
  assert.deepEqual(
    canDelegateOrganizationAccess(
      "organizer",
      [],
      "admin",
      ["campaign.manage", "account.manage", "audit.read"],
    ),
    { ok: true },
  );
  assert.deepEqual(
    canDelegateOrganizationAccess("organizer", [], "organizer", []),
    { ok: true },
  );
});

test("Admin can invite another admin only within their own capability ceiling", () => {
  assert.deepEqual(
    canDelegateOrganizationAccess(
      "admin",
      ["account.manage", "campaign.manage", "audit.read"],
      "admin",
      ["campaign.manage", "audit.read"],
    ),
    { ok: true },
  );
  assert.deepEqual(
    canDelegateOrganizationAccess(
      "admin",
      ["account.manage", "campaign.manage"],
      "admin",
      ["campaign.manage", "campaign.delete"],
    ),
    { ok: false, code: "capability_escalation" },
  );
});

test("Admin can never create an Organizer identity", () => {
  assert.deepEqual(
    canDelegateOrganizationAccess(
      "admin",
      ["account.manage", "role.manage", "campaign.manage"],
      "organizer",
      [],
    ),
    { ok: false, code: "organizer_only" },
  );
});
