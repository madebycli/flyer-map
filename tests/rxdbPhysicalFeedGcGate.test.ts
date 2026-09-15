import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(absolute));
    else if (/\.(?:ts|tsx|js|mjs)$/u.test(entry.name)) files.push(absolute);
  }
  return files;
}

test("physical campaign sync feed GC stays disabled until coordinated multi-tab rebootstrap exists", async () => {
  const offenders: string[] = [];
  for (const file of await sourceFiles("worker")) {
    const source = await readFile(file, "utf8");
    if (/DELETE\s+FROM\s+campaign_sync_changes/iu.test(source)) offenders.push(file);
  }
  assert.deepEqual(
    offenders,
    [],
    "Do not physically compact campaign_sync_changes in production Worker code until multi-tab expired-checkpoint recovery is coordinated and regression-tested.",
  );
});
