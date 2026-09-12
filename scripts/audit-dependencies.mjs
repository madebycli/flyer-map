import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const audit = spawnSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["audit", "--audit-level=high", "--json"],
  { encoding: "utf8" }
);
const rawReport = audit.stdout.trim();

let report;
try {
  report = JSON.parse(rawReport);
} catch {
  if (audit.stderr.trim()) console.error(audit.stderr.trim());
  console.error("Dependency audit did not return valid JSON.");
  process.exit(audit.status ?? 1);
}

if (report.error) {
  console.error(JSON.stringify(report.error));
  process.exit(audit.status ?? 1);
}

const severityRank = { low: 1, moderate: 2, high: 3, critical: 4 };
const blocking = Object.entries(report.vulnerabilities ?? {}).filter(
  ([, vulnerability]) => severityRank[vulnerability.severity] >= severityRank.high
);
const historicalMapLibre = packageJson.dependencies?.["maplibre-gl"] === "5.7.1";
const allowedAdvisory =
  "https://github.com/advisories/GHSA-jrc7-96c5-q579";

const isAllowedHistoricalMapLibre = ([name, vulnerability]) => {
  if (!historicalMapLibre || name !== "maplibre-gl") return false;
  const via = Array.isArray(vulnerability.via) ? vulnerability.via : [];
  return (
    via.length > 0 &&
    via.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        item.url === allowedAdvisory
    )
  );
};

const unexpected = blocking.filter(
  (entry) => !isAllowedHistoricalMapLibre(entry)
);
const allBlockingAreAllowed =
  blocking.length > 0 &&
  blocking.every(isAllowedHistoricalMapLibre);

if (unexpected.length > 0 || (audit.status ?? 1) !== 0 && !allBlockingAreAllowed) {
  console.error("Dependency audit failed.");
  console.error(
    JSON.stringify(
      unexpected.map(([name, vulnerability]) => ({
        name,
        severity: vulnerability.severity,
        via: (vulnerability.via ?? []).map((item) =>
          typeof item === "object" && item !== null
            ? item.url ?? item.title ?? item.name
            : item
        ),
        nodes: vulnerability.nodes
      })),
      null,
      2
    )
  );
  process.exit(audit.status ?? 1);
}

if (allBlockingAreAllowed) {
  console.warn(
    "Dependency audit passed with the explicit MapLibre 5.7.1 historical-renderer exception for GHSA-jrc7-96c5-q579."
  );
} else {
  console.log("Dependency audit passed.");
}
