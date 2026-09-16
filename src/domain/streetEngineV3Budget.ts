const MIB = 1024 * 1024;

export const STREET_ENGINE_V3_RUN_BUDGET = Object.freeze({
  workerRequests: { hard: 100 },
  d1RowsRead: { preferred: 5_000, hard: 10_000 },
  d1RowsWritten: { hard: 500 },
  durableObjectRequests: { hard: 100 },
  durableObjectDurationGbSeconds: { preferred: 25, hard: 65 },
  r2ClassAOperations: { preferred: 9, hard: 20 },
  r2ClassBOriginReads: { hard: 200 },
  browserDownloadBytes: { preferred: 20 * MIB, hard: 40 * MIB },
  browserUploadBytes: { preferred: 5 * MIB },
} as const);

export type StreetEngineV3ResourceUsage = {
  workerRequests: number;
  d1RowsRead: number;
  d1RowsWritten: number;
  durableObjectRequests: number;
  durableObjectDurationGbSeconds: number;
  r2ClassAOperations: number;
  r2ClassBOriginReads: number;
  browserDownloadBytes: number;
  browserUploadBytes: number;
};

export type StreetEngineV3BudgetFinding = {
  resource: keyof StreetEngineV3ResourceUsage;
  kind: 'preferred' | 'hard';
  actual: number;
  limit: number;
};

export type StreetEngineV3BudgetResult = {
  status: 'ok' | 'warn' | 'blocked';
  findings: StreetEngineV3BudgetFinding[];
};

function checkedUsage(usage: StreetEngineV3ResourceUsage) {
  for (const [resource, value] of Object.entries(usage)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`street_engine_v3_budget_invalid_${resource}`);
    }
  }
}

/**
 * Fail-closed per-generation budget gate. These are StreetEngine subsystem
 * budgets, intentionally much lower than Cloudflare account limits.
 */
export function evaluateStreetEngineV3Budget(
  usage: StreetEngineV3ResourceUsage,
): StreetEngineV3BudgetResult {
  checkedUsage(usage);
  const findings: StreetEngineV3BudgetFinding[] = [];
  for (const resource of Object.keys(STREET_ENGINE_V3_RUN_BUDGET) as (keyof StreetEngineV3ResourceUsage)[]) {
    const limits = STREET_ENGINE_V3_RUN_BUDGET[resource] as { preferred?: number; hard?: number };
    const actual = usage[resource];
    if (limits.hard !== undefined && actual > limits.hard) {
      findings.push({ resource, kind: 'hard', actual, limit: limits.hard });
      continue;
    }
    if (limits.preferred !== undefined && actual > limits.preferred) {
      findings.push({ resource, kind: 'preferred', actual, limit: limits.preferred });
    }
  }
  return {
    status: findings.some((finding) => finding.kind === 'hard')
      ? 'blocked'
      : findings.length
        ? 'warn'
        : 'ok',
    findings,
  };
}

export type StreetEngineV3ShardDescriptor = {
  id: string;
  compressedBytes: number;
};

export type StreetEngineV3TransferPlan = {
  shardCount: number;
  downloadBytes: number;
  status: 'ok' | 'warn' | 'blocked';
};

/**
 * Cold-run transfer preflight. Duplicate references to the same immutable
 * object are counted once. Conflicting byte sizes for the same content id fail
 * closed because the manifest is not internally consistent.
 */
export function planStreetEngineV3ShardTransfer(
  shards: readonly StreetEngineV3ShardDescriptor[],
): StreetEngineV3TransferPlan {
  const unique = new Map<string, number>();
  for (const shard of shards) {
    if (!shard.id || !Number.isSafeInteger(shard.compressedBytes) || shard.compressedBytes < 0) {
      throw new Error('street_engine_v3_manifest_invalid_shard');
    }
    const prior = unique.get(shard.id);
    if (prior !== undefined && prior !== shard.compressedBytes) {
      throw new Error('street_engine_v3_manifest_conflicting_shard');
    }
    unique.set(shard.id, shard.compressedBytes);
  }

  let downloadBytes = 0;
  for (const size of unique.values()) {
    const next = downloadBytes + size;
    if (!Number.isSafeInteger(next)) throw new Error('street_engine_v3_manifest_transfer_overflow');
    downloadBytes = next;
  }

  const limits = STREET_ENGINE_V3_RUN_BUDGET.browserDownloadBytes;
  return {
    shardCount: unique.size,
    downloadBytes,
    status: downloadBytes > limits.hard
      ? 'blocked'
      : downloadBytes > limits.preferred
        ? 'warn'
        : 'ok',
  };
}
