import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const SOURCE_ROOTS = ["src", "worker"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const AUDITED_WORKER_LOGGER = "worker/fieldGroupAudit.ts";

async function sourceFiles() {
  const files: string[] = [];

  async function walk(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
        continue;
      }
      const dot = entry.name.lastIndexOf(".");
      const extension = dot >= 0 ? entry.name.slice(dot) : "";
      if (SOURCE_EXTENSIONS.has(extension)) files.push(child);
    }
  }

  for (const root of SOURCE_ROOTS) await walk(root);
  return files.sort();
}

async function combinedSource() {
  const files = await sourceFiles();
  const chunks = await Promise.all(files.map(async (path) => `\n/* ${path} */\n${await readFile(path, "utf8")}`));
  return chunks.join("\n");
}

test("security static guard: no dangerouslySetInnerHTML in application or Worker source", async () => {
  const source = await combinedSource();
  assert.equal(source.includes("dangerouslySetInnerHTML"), false);
});

test("security static guard: no eval or Function-constructor execution", async () => {
  const source = await combinedSource();
  assert.doesNotMatch(source, /\beval\s*\(/u);
  assert.doesNotMatch(source, /\bnew\s+Function\s*\(/u);
});

test("security static guard: no document.write or insertAdjacentHTML sinks", async () => {
  const source = await combinedSource();
  assert.doesNotMatch(source, /\bdocument\.write\s*\(/u);
  assert.doesNotMatch(source, /\.insertAdjacentHTML\s*\(/u);
});

test("security static guard: credential-like values are not written to web storage", async () => {
  const source = await combinedSource();
  const dangerousStorageWrite = /(?:localStorage|sessionStorage)\.setItem\([^\n]{0,160}(?:token|secret|password|totp|recovery|credential)/giu;
  assert.doesNotMatch(source, dangerousStorageWrite);
});

test("security static guard: Worker logging is limited to the audited field group logger", async () => {
  const files = (await sourceFiles()).filter(
    (path) => path.startsWith("worker/") && path !== AUDITED_WORKER_LOGGER,
  );
  const workerSource = (await Promise.all(files.map((path) => readFile(path, "utf8")))).join("\n");
  assert.doesNotMatch(workerSource, /\bconsole\.(?:log|info|debug|warn|error)\s*\(/u);

  const auditSource = await readFile(AUDITED_WORKER_LOGGER, "utf8");
  const loggingCalls = auditSource.match(/\bconsole\.(?:log|info|debug|warn|error)\s*\(/gu) ?? [];
  assert.deepEqual(loggingCalls, ["console.info("]);
});

test("security static guard: SQL template interpolation is limited to the audited write guard", async () => {
  const sqlFiles = ["worker/campaignRepository.ts", "worker/mutationRepository.ts"];
  const allowedExpressions = new Set(["guard", "guardExistsSql()"]);
  const expectedGuard = "EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND write_token = ?)";

  for (const path of sqlFiles) {
    const source = await readFile(path, "utf8");
    const expressions = [...source.matchAll(/\$\{([^}]+)\}/gu)].map((match) => match[1].trim());
    const unexpected = expressions.filter((expression) => !allowedExpressions.has(expression));
    assert.deepEqual(unexpected, [], `${path} contains an unaudited SQL template expression`);
    assert.match(
      source,
      new RegExp(`function guardExistsSql\\(\\) \\{\\s*return ${JSON.stringify(expectedGuard).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")};\\s*\\}`, "u"),
    );
  }
});

test("security static guard: website-only build has no Service Worker or web manifest registration", async () => {
  const source = await combinedSource();
  assert.doesNotMatch(source, /serviceWorker\.register/u);
  assert.doesNotMatch(source, /\.webmanifest\b/u);
});

test("security static guard: no continuous GPS watch is introduced", async () => {
  const source = await combinedSource();
  assert.doesNotMatch(source, /geolocation\.watchPosition\s*\(/u);
});
