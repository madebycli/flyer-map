import { spawnSync } from "node:child_process";

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

if (blocking.length > 0 || (audit.status ?? 1) !== 0) {
  console.error("Dependency audit failed.");
  console.error(
    JSON.stringify(
      blocking.map(([name, vulnerability]) => ({
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

console.log("Dependency audit passed.");
