import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = directory + "/" + entry.name;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/u.test(entry.name) ? [path] : [];
  });
}

test("client src does not import server worker modules", () => {
  const srcDirectory = fileURLToPath(new URL("../src/", import.meta.url));
  for (const path of sourceFiles(srcDirectory)) {
    const content = readFileSync(path, "utf8");
    assert.doesNotMatch(
      content,
      /from\s+["'][^"']*\bworker\//u,
      path,
    );
    assert.doesNotMatch(
      content,
      /import\(["'][^"']*\bworker\//u,
      path,
    );
  }
});
