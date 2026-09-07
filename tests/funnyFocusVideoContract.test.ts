import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentPath = "src/platform/FunnyFocusVideo.tsx";
const mainPath = "src/main.tsx";

test("funny focus video stays local and alternates the two requested clips", async () => {
  const source = await readFile(componentPath, "utf8");

  assert.match(source, /HOLD_TO_TOGGLE_MS\s*=\s*5_000/u);
  assert.match(source, /RbVMiu4ubT0/u);
  assert.match(source, /91aqFhjxWB4/u);
  assert.match(source, /\.platform-grid-button/u);
  assert.match(source, /autoplay=1/u);
  assert.match(source, /mute=1/u);
  assert.match(source, /controls=0/u);
  assert.match(source, /loop=1/u);
  assert.match(source, /playlist=\$\{videoId\}/u);
  assert.match(source, /\(current \+ 1\) % VIDEO_IDS\.length/u);

  assert.doesNotMatch(source, /campaignStore|campaignApi|rxdb/iu);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /\/api\//u);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/iu);
});

test("funny focus video is mounted beside the platform shell, not inside map state", async () => {
  const source = await readFile(mainPath, "utf8");

  assert.match(source, /import \{ FunnyFocusVideo \} from "\.\/platform\/FunnyFocusVideo";/u);
  assert.match(source, /<PlatformShell\s*\/>[\s\S]*<FunnyFocusVideo\s*\/>/u);
});
