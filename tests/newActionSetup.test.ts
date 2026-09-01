import assert from "node:assert/strict";
import test from "node:test";
import type { ActionTemplateBlueprint } from "../src/domain/actionTemplate.ts";
import {
  buildNewActionSetupDraft,
  compatibleActionTemplates,
} from "../src/domain/newActionSetup.ts";

function template(mode: "distribution" | "collection", name: string): ActionTemplateBlueprint {
  return {
    schemaVersion: 2,
    mode,
    name,
    defaultMapView: null,
    operationalDefaults: { fieldGroupDiscoverableByDefault: true },
    teams: [],
    areas: [],
    roadSections: [],
  };
}

test("new action may deliberately start without a template", () => {
  assert.deepEqual(
    buildNewActionSetupDraft({
      actionName: "  Frühjahr 2027  ",
      mode: "distribution",
      template: null,
    }),
    {
      actionName: "Frühjahr 2027",
      mode: "distribution",
      templateName: null,
      cycleLabel: null,
    },
  );
});

test("new action accepts only a template matching the selected mode", () => {
  const distribution = template("distribution", "Flyer Standard");
  const collection = template("collection", "Auto Standard");

  assert.equal(
    buildNewActionSetupDraft({
      actionName: "Herbst 2027",
      mode: "collection",
      template: collection,
      cycleLabel: "Herbst 2027",
    }).templateName,
    "Auto Standard",
  );

  assert.throws(
    () => buildNewActionSetupDraft({
      actionName: "Herbst 2027",
      mode: "collection",
      template: distribution,
    }),
    /template_mode_mismatch/u,
  );
});

test("template picker filters distribution and collection independently", () => {
  const templates = [
    template("distribution", "Flyer 1"),
    template("collection", "Auto 1"),
    template("distribution", "Flyer 2"),
  ];

  assert.deepEqual(
    compatibleActionTemplates(templates, "distribution").map((item) => item.name),
    ["Flyer 1", "Flyer 2"],
  );
  assert.deepEqual(
    compatibleActionTemplates(templates, "collection").map((item) => item.name),
    ["Auto 1"],
  );
});

test("action and optional cycle labels are bounded inert text", () => {
  assert.throws(
    () => buildNewActionSetupDraft({ actionName: " ", mode: "distribution", template: null }),
    /invalid_action_name/u,
  );
  assert.throws(
    () => buildNewActionSetupDraft({
      actionName: "Aktion",
      mode: "distribution",
      template: null,
      cycleLabel: "x".repeat(161),
    }),
    /invalid_cycle_label/u,
  );

  const codeLike = buildNewActionSetupDraft({
    actionName: "<script>alert(1)</script>",
    mode: "distribution",
    template: null,
  });
  assert.equal(codeLike.actionName, "<script>alert(1)</script>");
});
