import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { darkenHexColor } from "../src/domain/color.ts";

test("completed colors are a pure 25 percent black mix", () => {
  assert.equal(darkenHexColor("#2563eb", 0.25), "#1c4ab0");
  assert.equal(darkenHexColor("#FFFFFF", 0.25), "#bfbfbf");
  assert.equal(darkenHexColor("not-a-color", 0.25), "not-a-color");
});

test("normal Street and House renderer data carries a completedColor", async () => {
  const map = await readFile("src/map/MapView.tsx", "utf8");
  const houses = await readFile("src/map/houseRenderer.ts", "utf8");

  assert.match(map, /type RenderTask = DistributionTask & \{ color: string; completedColor: string \}/u);
  assert.match(map, /id: STREET_COMPLETED_LAYER_ID[\s\S]*?"line-color": \["get", "completedColor"\][\s\S]*?"line-opacity": 0\.98/u);
  assert.match(map, /id: HOUSE_OUTLINE_LAYER_ID[\s\S]*?"line-color": \[[\s\S]*?"completedColor"/u);
  assert.match(houses, /RenderHouse = HouseTask & \{ color: string; completedColor: string \}/u);
  assert.match(houses, /completedColor: house\.completedColor/u);
});
