import assert from "node:assert/strict";
import test from "node:test";
import {
  TEAM_COLORS,
  nextAvailableTeamColor,
  type Team,
} from "../src/domain/campaign.ts";

function team(id: string, color: string): Team {
  return {
    id,
    campaignId: "campaign_colors",
    name: id,
    color,
    createdAt: "2026-08-25T10:00:00.000Z",
    updatedAt: "2026-08-25T10:00:00.000Z",
  };
}

test("team palette starts with the product-defined five colors", () => {
  assert.deepEqual(
    TEAM_COLORS.slice(0, 5).map((color) => color.label),
    ["Orange", "Blau", "Grün", "Rot", "Grau"],
  );
});

test("team palette is expanded beyond the old eight presets", () => {
  assert.ok(TEAM_COLORS.length >= 10);
  assert.equal(new Set(TEAM_COLORS.map((color) => color.value.toLowerCase())).size, TEAM_COLORS.length);
});

test("new teams receive the first unused product-order color", () => {
  assert.equal(nextAvailableTeamColor([]), TEAM_COLORS[0].value);
  assert.equal(
    nextAvailableTeamColor([
      team("team_1", TEAM_COLORS[0].value),
      team("team_2", TEAM_COLORS[1].value.toUpperCase()),
    ]),
    TEAM_COLORS[2].value,
  );
});

test("all exhausted palette colors receive a deterministic unused fallback", () => {
  const teams = TEAM_COLORS.map((color, index) => team(`team_${index}`, color.value));
  const fallback = nextAvailableTeamColor(teams);
  assert.match(fallback, /^#[0-9a-f]{6}$/iu);
  assert.equal(teams.some((item) => item.color.toLowerCase() === fallback.toLowerCase()), false);
  assert.equal(nextAvailableTeamColor(teams), fallback);
});
