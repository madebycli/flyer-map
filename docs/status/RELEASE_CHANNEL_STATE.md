# Release Channel State

Status snapshot: 2026-09-15

## Unbreakable release invariant

- Stable is sourced **only** from branch `main`.
- Unstable/Beta is sourced **only** from branch `unstable`.
- Feature, audit and temporary branches may never deploy directly to either public release channel.
- `main` may never deploy to the Unstable worker/database.
- `unstable` may never deploy to the Stable worker/database.
- Unstable uses its dedicated D1 database and may apply its own branch migrations there.
- Stable deploys do not apply D1 migrations automatically.

The machine-readable contract is `.release-channels.json`. The executable enforcement is `.github/workflows/release-channels.yml`. CI checks that both remain aligned.

## Channel mapping

| Channel | Source branch | Worker | Database | Public URL |
| --- | --- | --- | --- | --- |
| Stable | `main` | `flyer-map` | `flyer-map-db` | `https://flyer-map.cloudflare-eleven035.workers.dev` |
| Unstable | `unstable` | `flyer-map-unstable-backend` behind alias `flyer-map-unstable` | `flyer-map-unstable-db` | `https://flyer-map-unstable.cloudflare-eleven035.workers.dev` |

## Repository source snapshot before this release

- `main`: `9f1d9e4e7d067b38f133af73879fa3442c1bd868`
- `unstable`: `35e9987efcf7a113a93df22b47f6f828cd0a4944`
- Audit candidate: `audit/sync-d1-streetengine-ultra-2026-09-14`

These repository SHAs are a pre-release snapshot, not a claim about the currently running Cloudflare Worker.

## Exact deployed version

Every release stamps `SOURCE_COMMIT_SHA=$GITHUB_SHA` into the Worker configuration. `GET /api/runtime` exposes it as `sourceCommit` together with the runtime environment and Cloudflare Worker version metadata.

After every successful Stable or Unstable release, the workflow also uploads a `release-channel-state-<channel>` artifact containing `release-channel-state.json`. That file captures both public runtime endpoints at release time and is the durable release evidence for the exact deployed source revision.

This design deliberately avoids committing deployment-state updates back into `main` or `unstable`, which would otherwise create a new branch SHA and recursively trigger another deployment.
