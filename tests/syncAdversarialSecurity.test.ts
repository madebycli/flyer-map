import assert from "node:assert/strict";
import test from "node:test";
import type { AccessContext } from "../worker/access.ts";
import type { D1DatabaseLike } from "../worker/campaignRepository.ts";
import { handleCampaignMutation } from "../worker/mutationHandler.ts";

const campaignId = "campaign_adversarial_sync";
const adminAccess: AccessContext = {
  grantId: "grant_adversarial_admin",
  campaignId,
  role: "admin",
  teamId: null,
  label: "Audit Admin",
};

test("client task.create cannot reserve the server-owned task_auto_ namespace", async () => {
  let dbTouched = false;
  const db = new Proxy({}, {
    get() {
      dbTouched = true;
      throw new Error("reserved id must be rejected before D1 access");
    },
  }) as D1DatabaseLike;

  const response = await handleCampaignMutation(
    new Request("https://flyer.test/api/campaigns/campaign_adversarial_sync/mutations", {
      method: "POST",
      body: JSON.stringify({
        mutation: {
          id: "mutation_reserved_auto_street",
          campaignId,
          baseRevision: 0,
          createdAt: "2026-09-07T12:00:00.000Z",
          type: "task.create",
          payload: {
            taskId: "task_auto_deadbeef",
            areaId: "area_a",
            label: "poisoned automatic id",
            geometry: {
              type: "LineString",
              coordinates: [[8.6, 49.4], [8.61, 49.41]],
            },
          },
        },
      }),
    }),
    db,
    campaignId,
    adminAccess,
  );

  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    error: {
      code: "auto_street_id_reserved",
      message: "Automatische Street-IDs sind ausschließlich serverseitig reserviert.",
    },
  });
  assert.equal(dbTouched, false, "reserved automatic ids must fail before any canonical D1 read or write");
});
