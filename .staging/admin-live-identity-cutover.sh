#!/usr/bin/env bash
set -euo pipefail

ADMIN_DB_NAME='flyer-map-admin-staging-db'
ADMIN_WORKER_NAME='flyer-map-admin-staging'
PROD_D1_ID='0113e775-1e43-4d96-8b97-51fdeec7355b'
RXDB_STAGING_D1_ID='bcec3432-18ec-42a2-970a-64d52c8263d5'
OUT='/tmp/admin-live-identity-cutover'
mkdir -p "$OUT"

ALLOWED_ACCOUNT_ID="org_account_hotfix_allowed_${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT}"
RESTRICTED_ACCOUNT_ID="org_account_hotfix_restricted_${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT}"
ALLOWED_MEMBERSHIP_ID="org_membership_hotfix_allowed_${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT}"
RESTRICTED_MEMBERSHIP_ID="org_membership_hotfix_restricted_${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT}"
ALLOWED_SESSION_ID="org_session_hotfix_allowed_${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT}"
RESTRICTED_SESSION_ID="org_session_hotfix_restricted_${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT}"
RECOVERY_SESSION_ID="org_session_hotfix_recovery_${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT}"
ORGANIZER_SESSION_ID="org_session_hotfix_organizer_${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT}"
TEMP_ORGANIZER_INVITE_ID="org_invite_hotfix_organizer_${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT}"
TEMP_TOUCHED=0

cleanup_temp_identities() {
  if [[ "$TEMP_TOUCHED" != '1' ]]; then return 0; fi
  set +e
  npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --command "
    DELETE FROM organization_account_sessions
      WHERE id IN ('${ALLOWED_SESSION_ID}','${RESTRICTED_SESSION_ID}','${RECOVERY_SESSION_ID}','${ORGANIZER_SESSION_ID}');
    DELETE FROM organization_invites WHERE id = '${TEMP_ORGANIZER_INVITE_ID}';
    DELETE FROM organization_memberships WHERE id IN ('${ALLOWED_MEMBERSHIP_ID}','${RESTRICTED_MEMBERSHIP_ID}');
    DELETE FROM organization_accounts WHERE id IN ('${ALLOWED_ACCOUNT_ID}','${RESTRICTED_ACCOUNT_ID}');
  " >/dev/null 2>&1
  set -e
}
trap cleanup_temp_identities EXIT

node <<'NODE'
const fs = require('node:fs');
const c = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
if (c.main !== './worker/indexFc52.ts') throw new Error(`Production main changed: ${c.main}`);
if ((c.d1_databases || []).find((x) => x.binding === 'DB')?.database_id !== '0113e775-1e43-4d96-8b97-51fdeec7355b') throw new Error('Production D1 changed');
const expectedRateIds = new Map([
  ['FIELD_GROUP_JOIN_ACTOR_LIMITER', '91714001'],
  ['FIELD_GROUP_JOIN_CREDENTIAL_LIMITER', '91714002'],
  ['PICKUP_SEARCH_LIMITER', '91714003'],
]);
for (const [name, expectedId] of expectedRateIds) {
  if ((c.ratelimits || []).find((x) => x.name === name)?.namespace_id !== expectedId) {
    throw new Error(`Production rate limiter changed: ${name}`);
  }
}
if ((c.ratelimits || []).some((x) => x.name === 'ORGANIZATION_LOGIN_LIMITER')) throw new Error('Organizer limiter leaked into production config');
if ((c.compatibility_flags || []).includes('nodejs_compat')) throw new Error('Organizer compatibility flag leaked into production config');
NODE

ACCOUNTS_JSON="$(curl --fail-with-body --silent --show-error 'https://api.cloudflare.com/client/v4/accounts?per_page=50' -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H 'Content-Type: application/json')"
[[ "$(jq -r '.success' <<<"$ACCOUNTS_JSON")" == 'true' ]]
if [[ -n "${CONFIGURED_CLOUDFLARE_ACCOUNT_ID:-}" ]] && jq -e --arg id "$CONFIGURED_CLOUDFLARE_ACCOUNT_ID" '.result[]|select(.id==$id)' <<<"$ACCOUNTS_JSON" >/dev/null; then
  export CLOUDFLARE_ACCOUNT_ID="$CONFIGURED_CLOUDFLARE_ACCOUNT_ID"
elif [[ "$(jq '.result|length' <<<"$ACCOUNTS_JSON")" == '1' ]]; then
  export CLOUDFLARE_ACCOUNT_ID="$(jq -r '.result[0].id' <<<"$ACCOUNTS_JSON")"
else
  echo 'Cloudflare account is ambiguous.' >&2
  exit 1
fi

LIST_JSON="$(npx wrangler d1 list --json)"
ADMIN_D1_ID="$(jq -r --arg name "$ADMIN_DB_NAME" '[.[]|select(.name==$name)]|if length==1 then .[0].uuid else empty end' <<<"$LIST_JSON")"
[[ -n "$ADMIN_D1_ID" ]] || { echo 'Admin D1 missing or ambiguous.' >&2; exit 1; }
[[ "$ADMIN_D1_ID" != "$PROD_D1_ID" && "$ADMIN_D1_ID" != "$RXDB_STAGING_D1_ID" ]] || { echo 'Protected D1 collision.' >&2; exit 1; }
export ADMIN_D1_ID ADMIN_DB_NAME ADMIN_WORKER_NAME PROD_D1_ID RXDB_STAGING_D1_ID

database_fingerprint() {
  local destination="$1"
  local temp_dir tables_file canonical_file table rows_file
  temp_dir="$(mktemp -d)"
  tables_file="$temp_dir/tables.json"
  canonical_file="$temp_dir/canonical.txt"
  npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command \
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;" > "$tables_file"
  : > "$canonical_file"
  while IFS= read -r table; do
    [[ "$table" =~ ^[A-Za-z0-9_]+$ ]] || { echo "Unexpected D1 table identifier: $table" >&2; rm -rf "$temp_dir"; return 1; }
    printf 'TABLE:%s\n' "$table" >> "$canonical_file"
    rows_file="$temp_dir/${table}.json"
    npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command \
      "SELECT * FROM \"${table}\";" > "$rows_file"
    jq -S -c '[.[].results[]? | to_entries | sort_by(.key) | from_entries] | sort_by(tojson)' "$rows_file" >> "$canonical_file"
  done < <(jq -r '[.[].results[]?] | .[].name' "$tables_file")
  sha256sum "$canonical_file" | awk '{print $1}' > "$destination"
  rm -rf "$temp_dir"
}

node <<'NODE'
const fs = require('node:fs');
const c = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
c.main = './worker/indexOrganizer.ts';
c.compatibility_flags = [...new Set([...(c.compatibility_flags || []), 'nodejs_compat'])];
c.env = c.env || {};
c.env.admin_staging = {
  name: process.env.ADMIN_WORKER_NAME,
  workers_dev: true,
  vars: {
    ORGANIZATION_BOOTSTRAP_SECRET_SHA256: process.env.FINAL_BOOTSTRAP_SECRET_SHA256,
    ORGANIZATION_PASSWORD_KDF_ITERATIONS: '600000'
  },
  d1_databases: [{
    binding: 'DB',
    database_name: process.env.ADMIN_DB_NAME,
    database_id: process.env.ADMIN_D1_ID,
    migrations_dir: 'migrations'
  }],
  durable_objects: { bindings: [
    { name: 'CAMPAIGN_SYNC', class_name: 'CampaignSyncDurableObject' },
    { name: 'ORGANIZATION_PASSWORD_KDF', class_name: 'OrganizationPasswordKdfDurableObject' }
  ]},
  ratelimits: [
    { name: 'FIELD_GROUP_JOIN_ACTOR_LIMITER', namespace_id: '91914001', simple: { limit: 30, period: 60 } },
    { name: 'FIELD_GROUP_JOIN_CREDENTIAL_LIMITER', namespace_id: '91914002', simple: { limit: 8, period: 60 } },
    { name: 'PICKUP_SEARCH_LIMITER', namespace_id: '91914003', simple: { limit: 20, period: 10 } },
    { name: 'ORGANIZATION_LOGIN_LIMITER', namespace_id: '91914004', simple: { limit: 12, period: 60 } }
  ]
};
c.migrations = c.migrations || [];
if (!c.migrations.some((x) => x.tag === 'v2-organization-password-kdf')) {
  c.migrations.push({ tag: 'v2-organization-password-kdf', new_sqlite_classes: ['OrganizationPasswordKdfDurableObject'] });
}
const protectedIds = new Set(['91714001','91714002','91714003','91814001','91814002','91814003']);
for (const limiter of c.env.admin_staging.ratelimits) {
  if (protectedIds.has(String(limiter.namespace_id))) throw new Error(`Rate collision ${limiter.namespace_id}`);
}
fs.writeFileSync('wrangler.jsonc', JSON.stringify(c, null, 2) + '\n');
NODE

npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command 'PRAGMA foreign_key_check;' > "$OUT/fk-before.json"
jq -e '[.[].results[]?] | length == 0' "$OUT/fk-before.json" >/dev/null

STATE_QUERY="SELECT
  (SELECT COUNT(*) FROM organization_bootstrap_state) bootstrap_count,
  (SELECT COUNT(*) FROM organizations) organization_count,
  (SELECT COUNT(*) FROM organization_accounts) account_count,
  (SELECT COUNT(*) FROM organization_memberships) membership_count,
  (SELECT COUNT(*) FROM organization_account_sessions) organization_session_count,
  (SELECT COUNT(*) FROM organization_invites) invite_count,
  (SELECT COUNT(*) FROM organization_role_templates) role_template_count,
  (SELECT COUNT(*) FROM organization_audit_events) audit_count,
  (SELECT COUNT(*) FROM campaigns) campaign_count,
  (SELECT COUNT(*) FROM campaigns WHERE organization_id IS NOT NULL) owned_campaign_count,
  (SELECT COUNT(*) FROM campaign_access_grants) access_grant_count,
  (SELECT COUNT(*) FROM campaign_admin_accounts) legacy_admin_account_count;"
npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command "$STATE_QUERY" > "$OUT/state-before.json"
database_fingerprint "$OUT/database-fingerprint-before.sha256"

TARGET_JSON="$(npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command \
  "SELECT c.id campaign_id, c.organization_id organization_id
   FROM campaigns c
   WHERE c.organization_id IS NOT NULL
   ORDER BY c.id LIMIT 1;")"
[[ "$(jq '[.[].results[]?] | length' <<<"$TARGET_JSON")" == '1' ]] || { echo 'No Organization-owned Campaign available.' >&2; exit 1; }
CAMPAIGN_ID="$(jq -r '.[0].results[0].campaign_id' <<<"$TARGET_JSON")"
ORGANIZATION_ID="$(jq -r '.[0].results[0].organization_id' <<<"$TARGET_JSON")"

ORGANIZER_JSON="$(npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command \
  "SELECT m.id membership_id, m.account_id account_id
   FROM organization_memberships m
   WHERE m.organization_id = '${ORGANIZATION_ID}'
     AND m.role_kind = 'organizer'
     AND m.disabled_at IS NULL
   ORDER BY m.id LIMIT 1;")"
[[ "$(jq '[.[].results[]?] | length' <<<"$ORGANIZER_JSON")" == '1' ]] || { echo 'No active Organizer membership available.' >&2; exit 1; }
ORGANIZER_MEMBERSHIP_ID="$(jq -r '.[0].results[0].membership_id' <<<"$ORGANIZER_JSON")"
ORGANIZER_ACCOUNT_ID="$(jq -r '.[0].results[0].account_id' <<<"$ORGANIZER_JSON")"
FOREIGN_ORGANIZATION_ID="org_foreign_${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT}"
export CAMPAIGN_ID ORGANIZATION_ID ORGANIZER_MEMBERSHIP_ID ORGANIZER_ACCOUNT_ID FOREIGN_ORGANIZATION_ID

ALLOWED_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
RESTRICTED_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
RECOVERY_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
ORGANIZER_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
TEMP_INVITE_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
echo "::add-mask::$ALLOWED_SECRET"
echo "::add-mask::$RESTRICTED_SECRET"
echo "::add-mask::$RECOVERY_SECRET"
echo "::add-mask::$ORGANIZER_SECRET"
echo "::add-mask::$TEMP_INVITE_SECRET"
ALLOWED_HASH="$(printf '%s' "$ALLOWED_SECRET" | sha256sum | awk '{print $1}')"
RESTRICTED_HASH="$(printf '%s' "$RESTRICTED_SECRET" | sha256sum | awk '{print $1}')"
RECOVERY_HASH="$(printf '%s' "$RECOVERY_SECRET" | sha256sum | awk '{print $1}')"
ORGANIZER_HASH="$(printf '%s' "$ORGANIZER_SECRET" | sha256sum | awk '{print $1}')"
TEMP_INVITE_HASH="$(printf '%s' "$TEMP_INVITE_SECRET" | sha256sum | awk '{print $1}')"
NOW="$(node -e 'process.stdout.write(new Date().toISOString())')"
EXPIRES="$(node -e 'process.stdout.write(new Date(Date.now()+10*60*1000).toISOString())')"
ALLOWED_USERNAME="hotfix.allowed.${GITHUB_RUN_ID}.${GITHUB_RUN_ATTEMPT}"
RESTRICTED_USERNAME="hotfix.restricted.${GITHUB_RUN_ID}.${GITHUB_RUN_ATTEMPT}"
TEMP_TOUCHED=1

npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --command "
  INSERT INTO organization_accounts (id, username, username_normalized, disabled_at, created_at, updated_at)
  VALUES ('${ALLOWED_ACCOUNT_ID}','${ALLOWED_USERNAME}','${ALLOWED_USERNAME}',NULL,'${NOW}','${NOW}');
  INSERT INTO organization_accounts (id, username, username_normalized, disabled_at, created_at, updated_at)
  VALUES ('${RESTRICTED_ACCOUNT_ID}','${RESTRICTED_USERNAME}','${RESTRICTED_USERNAME}',NULL,'${NOW}','${NOW}');
  INSERT INTO organization_memberships (id, organization_id, account_id, role_kind, role_template_id, capabilities_json, disabled_at, created_at, updated_at)
  VALUES ('${ALLOWED_MEMBERSHIP_ID}','${ORGANIZATION_ID}','${ALLOWED_ACCOUNT_ID}','admin',NULL,'[\"campaign.manage\",\"account.manage\"]',NULL,'${NOW}','${NOW}');
  INSERT INTO organization_memberships (id, organization_id, account_id, role_kind, role_template_id, capabilities_json, disabled_at, created_at, updated_at)
  VALUES ('${RESTRICTED_MEMBERSHIP_ID}','${ORGANIZATION_ID}','${RESTRICTED_ACCOUNT_ID}','admin',NULL,'[\"audit.read\"]',NULL,'${NOW}','${NOW}');
  INSERT INTO organization_account_sessions (id, account_id, session_hash, assurance, created_at, expires_at, revoked_at)
  VALUES ('${ALLOWED_SESSION_ID}','${ALLOWED_ACCOUNT_ID}','${ALLOWED_HASH}','mfa','${NOW}','${EXPIRES}',NULL);
  INSERT INTO organization_account_sessions (id, account_id, session_hash, assurance, created_at, expires_at, revoked_at)
  VALUES ('${RESTRICTED_SESSION_ID}','${RESTRICTED_ACCOUNT_ID}','${RESTRICTED_HASH}','mfa','${NOW}','${EXPIRES}',NULL);
  INSERT INTO organization_account_sessions (id, account_id, session_hash, assurance, created_at, expires_at, revoked_at)
  VALUES ('${RECOVERY_SESSION_ID}','${ALLOWED_ACCOUNT_ID}','${RECOVERY_HASH}','recovery','${NOW}','${EXPIRES}',NULL);
  INSERT INTO organization_account_sessions (id, account_id, session_hash, assurance, created_at, expires_at, revoked_at)
  VALUES ('${ORGANIZER_SESSION_ID}','${ORGANIZER_ACCOUNT_ID}','${ORGANIZER_HASH}','mfa','${NOW}','${EXPIRES}',NULL);
  INSERT INTO organization_invites
    (id, organization_id, created_by_account_id, token_hash, role_kind, capabilities_json, created_at, expires_at, used_at, revoked_at)
  VALUES
    ('${TEMP_ORGANIZER_INVITE_ID}','${ORGANIZATION_ID}','${ALLOWED_ACCOUNT_ID}','${TEMP_INVITE_HASH}','organizer','[]','${NOW}','${EXPIRES}',NULL,NULL);
" >/dev/null

BRIDGE_DIAGNOSTIC_QUERY="SELECT
  m.id membership_id,
  c.id campaign_id,
  c.organization_id campaign_organization_id,
  m.organization_id membership_organization_id,
  m.role_kind,
  m.capabilities_json,
  r.capabilities_json template_capabilities_json,
  s.assurance,
  s.expires_at
FROM organization_account_sessions s
JOIN organization_accounts a
  ON a.id = s.account_id AND a.disabled_at IS NULL
JOIN organization_memberships m
  ON m.account_id = s.account_id AND m.disabled_at IS NULL
LEFT JOIN organization_role_templates r
  ON r.id = m.role_template_id AND r.organization_id = m.organization_id
JOIN campaigns c
  ON c.id = '${CAMPAIGN_ID}'
 AND c.organization_id = m.organization_id
 AND c.organization_id IS NOT NULL
WHERE s.session_hash = '${ALLOWED_HASH}'
  AND s.expires_at > '${NOW}'
  AND s.revoked_at IS NULL
  AND s.assurance = 'mfa'
LIMIT 1;"
npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command "$BRIDGE_DIAGNOSTIC_QUERY" > "$OUT/bridge-direct.json"
jq -e '[.[].results[]?] | length == 1' "$OUT/bridge-direct.json" >/dev/null

export CLOUDFLARE_ENV=admin_staging
rm -rf dist .wrangler .wrangler-admin-live-cutover-dry-run
npm run build >/dev/null
node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const redirect = JSON.parse(fs.readFileSync('.wrangler/deploy/config.json', 'utf8'));
const generated = JSON.parse(fs.readFileSync(path.resolve('.wrangler/deploy', redirect.configPath), 'utf8'));
if (generated.name !== process.env.ADMIN_WORKER_NAME) throw new Error('Wrong Worker');
if ((generated.d1_databases || []).find((x) => x.binding === 'DB')?.database_id !== process.env.ADMIN_D1_ID) throw new Error('Wrong D1');
if (!(generated.durable_objects?.bindings || []).some((x) => x.name === 'ORGANIZATION_PASSWORD_KDF')) throw new Error('KDF binding missing');
if (!(generated.compatibility_flags || []).includes('nodejs_compat')) throw new Error('nodejs_compat missing');
const serialized = JSON.stringify(generated);
if (serialized.includes(process.env.PROD_D1_ID) || serialized.includes(process.env.RXDB_STAGING_D1_ID)) throw new Error('Protected D1 leaked into Admin staging');
NODE
npx wrangler deploy --dry-run --outdir .wrangler-admin-live-cutover-dry-run >/dev/null
npx wrangler deploy 2>&1 | tee "$OUT/deploy.log"
TEST_URL="$(grep -Eo 'https://[^[:space:]]+\.workers\.dev' "$OUT/deploy.log" | tail -n1 || true)"
[[ -n "$TEST_URL" ]] || { echo 'No workers.dev URL found.' >&2; exit 1; }
VERSION_ID="$(sed -n 's/^Current Version ID: //p' "$OUT/deploy.log" | tail -n1)"
[[ "$VERSION_ID" =~ ^[0-9A-Fa-f-]{36}$ ]] || { echo 'No valid Worker version ID found.' >&2; exit 1; }
printf '%s\n' "$TEST_URL" > "$OUT/test-url.txt"
printf '%s\n' "$VERSION_ID" > "$OUT/version-id.txt"
PIN_HEADER="Cloudflare-Workers-Version-Overrides: ${ADMIN_WORKER_NAME}=\"${VERSION_ID}\""

ALLOWED_ME_STATUS="$(curl -sS -o "$OUT/allowed-me.json" -w '%{http_code}' -H "$PIN_HEADER" -H "Cookie: __Host-vf_organization_session=${ALLOWED_SECRET}" "$TEST_URL/api/organization/me")"
[[ "$ALLOWED_ME_STATUS" == '200' ]]
jq -e --arg membership "$ALLOWED_MEMBERSHIP_ID" '.assurance=="mfa" and any(.memberships[]; .id==$membership)' "$OUT/allowed-me.json" >/dev/null

ALLOWED_STATUS="$(curl -sS -o "$OUT/allowed-admin.json" -w '%{http_code}' -H "$PIN_HEADER" -H "Cookie: __Host-vf_organization_session=${ALLOWED_SECRET}" "$TEST_URL/api/access/current?campaign=${CAMPAIGN_ID}")"
[[ "$ALLOWED_STATUS" == '200' ]]
jq -e --arg campaign "$CAMPAIGN_ID" '.access.role=="admin" and .access.campaignId==$campaign and .access.identityProvider=="organization"' "$OUT/allowed-admin.json" >/dev/null

ORGANIZER_STATUS="$(curl -sS -o "$OUT/organizer-access.json" -w '%{http_code}' -H "$PIN_HEADER" -H "Cookie: __Host-vf_organization_session=${ORGANIZER_SECRET}" "$TEST_URL/api/access/current?campaign=${CAMPAIGN_ID}")"
[[ "$ORGANIZER_STATUS" == '200' ]]
jq -e --arg campaign "$CAMPAIGN_ID" '.access.role=="admin" and .access.campaignId==$campaign and .access.identityProvider=="organization"' "$OUT/organizer-access.json" >/dev/null

RESTRICTED_STATUS="$(curl -sS -o "$OUT/restricted-admin.json" -w '%{http_code}' -H "$PIN_HEADER" -H "Cookie: __Host-vf_organization_session=${RESTRICTED_SECRET}" -H 'X-Organization-Role: organizer' -H 'X-Organization-Capabilities: campaign.manage' -H 'X-MFA-Assurance: mfa' "$TEST_URL/api/access/current?campaign=${CAMPAIGN_ID}")"
[[ "$RESTRICTED_STATUS" == '401' ]]
jq -e '.error.code=="organization_access_required"' "$OUT/restricted-admin.json" >/dev/null

RECOVERY_STATUS="$(curl -sS -o "$OUT/recovery-session.json" -w '%{http_code}' -H "$PIN_HEADER" -H "Cookie: __Host-vf_organization_session=${RECOVERY_SECRET}" -H 'X-Organization-Role: organizer' -H 'X-Organization-Capabilities: campaign.manage' -H 'X-MFA-Assurance: mfa' "$TEST_URL/api/access/current?campaign=${CAMPAIGN_ID}")"
[[ "$RECOVERY_STATUS" == '401' ]]
jq -e '.error.code=="organization_access_required"' "$OUT/recovery-session.json" >/dev/null

FOREIGN_STATUS="$(curl -sS -o "$OUT/foreign-org-campaign.json" -w '%{http_code}' -X PATCH "$TEST_URL/api/organizations/${FOREIGN_ORGANIZATION_ID}/campaigns/${CAMPAIGN_ID}" -H "$PIN_HEADER" -H "Cookie: __Host-vf_organization_session=${ALLOWED_SECRET}" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' --data '{"lifecycle":"active"}')"
[[ "$FOREIGN_STATUS" == '403' ]]
jq -e '.error.code=="forbidden"' "$OUT/foreign-org-campaign.json" >/dev/null

SELF_GRANT_STATUS="$(curl -sS -o "$OUT/self-grant.json" -w '%{http_code}' -X PATCH "$TEST_URL/api/organizations/${ORGANIZATION_ID}/members/${ALLOWED_MEMBERSHIP_ID}" -H "$PIN_HEADER" -H "Cookie: __Host-vf_organization_session=${ALLOWED_SECRET}" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' --data '{"role":"organizer","capabilities":["campaign.delete","security.manage"]}')"
[[ "$SELF_GRANT_STATUS" == '405' ]]
jq -e '.error.code=="method_not_allowed"' "$OUT/self-grant.json" >/dev/null

ORGANIZER_INVITE_CREATE_STATUS="$(curl -sS -o "$OUT/organizer-invite-create.json" -w '%{http_code}' -X POST "$TEST_URL/api/organizations/${ORGANIZATION_ID}/invites" -H "$PIN_HEADER" -H "Cookie: __Host-vf_organization_session=${ALLOWED_SECRET}" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' --data '{"role":"organizer","capabilities":[],"expiresInHours":1}')"
[[ "$ORGANIZER_INVITE_CREATE_STATUS" == '403' ]]
jq -e '.error.code=="organizer_only"' "$OUT/organizer-invite-create.json" >/dev/null

ESCALATION_STATUS="$(curl -sS -o "$OUT/delegation-escalation.json" -w '%{http_code}' -X POST "$TEST_URL/api/organizations/${ORGANIZATION_ID}/invites" -H "$PIN_HEADER" -H "Cookie: __Host-vf_organization_session=${ALLOWED_SECRET}" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' --data '{"role":"admin","capabilities":["campaign.delete"],"expiresInHours":1}')"
[[ "$ESCALATION_STATUS" == '403' ]]
jq -e '.error.code=="capability_delegation_forbidden"' "$OUT/delegation-escalation.json" >/dev/null

ROLE_ESCALATION_STATUS="$(curl -sS -o "$OUT/role-escalation.json" -w '%{http_code}' -X POST "$TEST_URL/api/organizations/${ORGANIZATION_ID}/roles" -H "$PIN_HEADER" -H "Cookie: __Host-vf_organization_session=${ALLOWED_SECRET}" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' --data "{\"name\":\"hotfix-role-${GITHUB_RUN_ID}\",\"capabilities\":[\"campaign.delete\"]}")"
[[ "$ROLE_ESCALATION_STATUS" == '403' ]]
jq -e '.error.code=="capability_delegation_forbidden"' "$OUT/role-escalation.json" >/dev/null

ORGANIZER_INVITE_REVOKE_STATUS="$(curl -sS -o "$OUT/organizer-invite-revoke.json" -w '%{http_code}' -X DELETE "$TEST_URL/api/organizations/${ORGANIZATION_ID}/invites/${TEMP_ORGANIZER_INVITE_ID}" -H "$PIN_HEADER" -H "Cookie: __Host-vf_organization_session=${ALLOWED_SECRET}" -H "Origin: $TEST_URL")"
[[ "$ORGANIZER_INVITE_REVOKE_STATUS" == '403' ]]
jq -e '.error.code=="organizer_only"' "$OUT/organizer-invite-revoke.json" >/dev/null

ORGANIZER_DEACTIVATE_STATUS="$(curl -sS -o "$OUT/organizer-deactivate.json" -w '%{http_code}' -X DELETE "$TEST_URL/api/organizations/${ORGANIZATION_ID}/members/${ORGANIZER_MEMBERSHIP_ID}" -H "$PIN_HEADER" -H "Cookie: __Host-vf_organization_session=${ALLOWED_SECRET}" -H "Origin: $TEST_URL")"
[[ "$ORGANIZER_DEACTIVATE_STATUS" == '403' ]]
jq -e '.error.code=="organizer_only"' "$OUT/organizer-deactivate.json" >/dev/null

LEGACY_SETUP_STATUS="$(curl -sS -o "$OUT/legacy-setup.json" -w '%{http_code}' -X POST "$TEST_URL/api/admin-accounts/setup" -H "$PIN_HEADER" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' --data "{\"campaignId\":\"${CAMPAIGN_ID}\",\"token\":\"invalid\",\"username\":\"legacy\",\"password\":\"not-used-password\"}")"
[[ "$LEGACY_SETUP_STATUS" == '409' ]]
jq -e '.error.code=="organization_identity_required"' "$OUT/legacy-setup.json" >/dev/null

LEGACY_RESET_STATUS="$(curl -sS -o "$OUT/legacy-reset.json" -w '%{http_code}' -X POST "$TEST_URL/api/admin-accounts/password-reset" -H "$PIN_HEADER" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' --data "{\"campaignId\":\"${CAMPAIGN_ID}\",\"token\":\"manually-constructed\"}")"
[[ "$LEGACY_RESET_STATUS" == '409' ]]
jq -e '.error.code=="organization_identity_required"' "$OUT/legacy-reset.json" >/dev/null

LEGACY_RECOVER_STATUS="$(curl -sS -o "$OUT/legacy-recover.json" -w '%{http_code}' -X POST "$TEST_URL/api/admin/recover" -H "$PIN_HEADER" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' --data "{\"campaignId\":\"${CAMPAIGN_ID}\",\"operatorRecovery\":\"manually-constructed\"}")"
[[ "$LEGACY_RECOVER_STATUS" == '409' ]]
jq -e '.error.code=="organization_identity_required"' "$OUT/legacy-recover.json" >/dev/null

LEGACY_BOOTSTRAP_STATUS="$(curl -sS -o "$OUT/legacy-bootstrap.json" -w '%{http_code}' -X POST "$TEST_URL/api/admin/bootstrap" -H "$PIN_HEADER" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' --data "{\"campaignId\":\"${CAMPAIGN_ID}\",\"bootstrap\":\"manually-constructed\"}")"
[[ "$LEGACY_BOOTSTRAP_STATUS" == '409' ]]
jq -e '.error.code=="organization_identity_required"' "$OUT/legacy-bootstrap.json" >/dev/null

LEGACY_ADMIN_LINK_STATUS="$(curl -sS -o "$OUT/legacy-admin-link.json" -w '%{http_code}' -X POST "$TEST_URL/api/campaigns/${CAMPAIGN_ID}/access" -H "$PIN_HEADER" -H "Cookie: __Host-vf_organization_session=${ALLOWED_SECRET}" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' --data '{"role":"admin","teamId":null,"label":"legacy-admin-must-fail"}')"
[[ "$LEGACY_ADMIN_LINK_STATUS" == '409' ]]
jq -e '.error.code=="organization_admin_invite_required"' "$OUT/legacy-admin-link.json" >/dev/null

CROSS_ORIGIN_STATUS="$(curl -sS -o "$OUT/cross-origin.json" -w '%{http_code}' -X POST "$TEST_URL/api/organizations/${ORGANIZATION_ID}/invites" -H "$PIN_HEADER" -H "Cookie: __Host-vf_organization_session=${ALLOWED_SECRET}" -H 'Origin: https://attacker.invalid' -H 'Content-Type: application/json' --data '{"role":"admin","capabilities":[],"expiresInHours":1}')"
[[ "$CROSS_ORIGIN_STATUS" == '403' ]]
jq -e '.error.code=="origin_forbidden"' "$OUT/cross-origin.json" >/dev/null

UNKNOWN_API_STATUS="$(curl -sS -o "$OUT/unknown-api.json" -w '%{http_code}' -H "$PIN_HEADER" "$TEST_URL/api/organizations/${ORGANIZATION_ID}/definitely-unknown")"
[[ "$UNKNOWN_API_STATUS" == '404' ]]
jq -e '.error.code=="not_found"' "$OUT/unknown-api.json" >/dev/null

CONSECUTIVE=0
PUBLIC_STATUS='000'
for attempt in $(seq 1 30); do
  PUBLIC_STATUS="$(curl -sS -o "$OUT/allowed-admin-public.json" -w '%{http_code}' -H "Cookie: __Host-vf_organization_session=${ALLOWED_SECRET}" "$TEST_URL/api/access/current?campaign=${CAMPAIGN_ID}" || printf 000)"
  if [[ "$PUBLIC_STATUS" == '200' ]] && jq -e --arg campaign "$CAMPAIGN_ID" '.access.role=="admin" and .access.campaignId==$campaign and .access.identityProvider=="organization"' "$OUT/allowed-admin-public.json" >/dev/null 2>&1; then
    CONSECUTIVE=$((CONSECUTIVE+1))
    [[ "$CONSECUTIVE" -ge 3 ]] && break
  else
    CONSECUTIVE=0
  fi
  [[ "$attempt" == '30' ]] || sleep 4
done
[[ "$CONSECUTIVE" -ge 3 ]] || { echo 'Public Worker alias did not converge to central Admin identity cutover.' >&2; exit 1; }

cleanup_temp_identities
TEMP_TOUCHED=0

npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command 'PRAGMA foreign_key_check;' > "$OUT/fk-after.json"
jq -e '[.[].results[]?] | length == 0' "$OUT/fk-after.json" >/dev/null
npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command "$STATE_QUERY" > "$OUT/state-after.json"
jq -S '.[0].results[0]' "$OUT/state-before.json" > "$OUT/state-before.normalized.json"
jq -S '.[0].results[0]' "$OUT/state-after.json" > "$OUT/state-after.normalized.json"
diff -u "$OUT/state-before.normalized.json" "$OUT/state-after.normalized.json"
database_fingerprint "$OUT/database-fingerprint-after.sha256"
diff -u "$OUT/database-fingerprint-before.sha256" "$OUT/database-fingerprint-after.sha256"

START="$(curl -sS -o /dev/null -w '%{http_code}' "$TEST_URL/start")"
LOGIN="$(curl -sS -o /dev/null -w '%{http_code}' "$TEST_URL/login")"
ME="$(curl -sS -o /dev/null -w '%{http_code}' "$TEST_URL/api/organization/me")"
[[ "$START" -ge 200 && "$START" -lt 400 ]]
[[ "$LOGIN" -ge 200 && "$LOGIN" -lt 400 ]]
[[ "$ME" == '401' ]]

jq -n \
  --arg allowed "$ALLOWED_STATUS" \
  --arg organizer "$ORGANIZER_STATUS" \
  --arg restricted "$RESTRICTED_STATUS" \
  --arg recovery "$RECOVERY_STATUS" \
  --arg foreign "$FOREIGN_STATUS" \
  --arg self_grant "$SELF_GRANT_STATUS" \
  --arg organizer_invite_create "$ORGANIZER_INVITE_CREATE_STATUS" \
  --arg escalation "$ESCALATION_STATUS" \
  --arg role_escalation "$ROLE_ESCALATION_STATUS" \
  --arg organizer_invite_revoke "$ORGANIZER_INVITE_REVOKE_STATUS" \
  --arg organizer_deactivate "$ORGANIZER_DEACTIVATE_STATUS" \
  --arg legacy_setup "$LEGACY_SETUP_STATUS" \
  --arg legacy_reset "$LEGACY_RESET_STATUS" \
  --arg legacy_recover "$LEGACY_RECOVER_STATUS" \
  --arg legacy_bootstrap "$LEGACY_BOOTSTRAP_STATUS" \
  --arg legacy_admin_link "$LEGACY_ADMIN_LINK_STATUS" \
  --arg cross_origin "$CROSS_ORIGIN_STATUS" \
  --arg unknown_api "$UNKNOWN_API_STATUS" \
  --arg public "$PUBLIC_STATUS" \
  --argjson consecutive "$CONSECUTIVE" \
  '{ok:true,allowed_admin:$allowed,organizer:$organizer,restricted_admin:$restricted,recovery_session_rejected:$recovery,foreign_org_rejected:$foreign,self_grant_rejected:$self_grant,organizer_invite_create_rejected:$organizer_invite_create,privilege_escalation_blocked:$escalation,role_escalation_blocked:$role_escalation,organizer_invite_revoke_rejected:$organizer_invite_revoke,organizer_deactivate_rejected:$organizer_deactivate,legacy_setup_blocked:$legacy_setup,legacy_reset_blocked:$legacy_reset,legacy_recover_blocked:$legacy_recover,legacy_bootstrap_blocked:$legacy_bootstrap,legacy_admin_link_blocked:$legacy_admin_link,cross_origin_blocked:$cross_origin,unknown_api_fail_closed:$unknown_api,public_admin:$public,consecutive:$consecutive,temporary_identities_removed:true,database_state_preserved:true,database_fingerprint_preserved:true}' > "$OUT/identity-cutover.json"
