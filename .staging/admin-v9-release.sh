#!/usr/bin/env bash
set -euo pipefail

ADMIN_DB_NAME='flyer-map-admin-staging-db'
ADMIN_WORKER_NAME='flyer-map-admin-staging'
PROD_D1_ID='0113e775-1e43-4d96-8b97-51fdeec7355b'
RXDB_STAGING_D1_ID='bcec3432-18ec-42a2-970a-64d52c8263d5'
OUT='/tmp/admin-v9'
PRIVATE='/tmp/admin-v9-private'
mkdir -p "$OUT" "$PRIVATE"
CLEANUP_READY=0
CLEANED=0

cleanup_remote() {
  if [[ "$CLEANUP_READY" != '1' || "$CLEANED" == '1' ]]; then return 0; fi
  set +e
  npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote \
    --command "DELETE FROM campaigns WHERE organization_id IS NOT NULL; DELETE FROM organization_bootstrap_state; DELETE FROM organizations; DELETE FROM organization_accounts; DELETE FROM organization_login_throttles;" >/dev/null 2>&1
  set -e
}
trap cleanup_remote EXIT

node <<'NODE'
const fs = require('node:fs');
const c = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
if (c.main !== './worker/indexFc52.ts') throw new Error(`Production main changed: ${c.main}`);
if ((c.d1_databases || []).find((x) => x.binding === 'DB')?.database_id !== '0113e775-1e43-4d96-8b97-51fdeec7355b') throw new Error('Production D1 changed');
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

SMOKE_BOOTSTRAP_SECRET="$(openssl rand -hex 32)"
SMOKE_PASSWORD="Smoke-$(openssl rand -hex 24)"
INVITE_PASSWORD="Invite-$(openssl rand -hex 24)"
TOTP_KEY="$(openssl rand -hex 32)"
for value in "$SMOKE_BOOTSTRAP_SECRET" "$SMOKE_PASSWORD" "$INVITE_PASSWORD" "$TOTP_KEY"; do echo "::add-mask::$value"; done
SMOKE_DIGEST="$(printf '%s' "$SMOKE_BOOTSTRAP_SECRET" | sha256sum | awk '{print $1}')"
export SMOKE_BOOTSTRAP_SECRET SMOKE_PASSWORD INVITE_PASSWORD TOTP_KEY SMOKE_DIGEST

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
    ORGANIZATION_BOOTSTRAP_SECRET_SHA256: process.env.SMOKE_DIGEST,
    ORGANIZATION_PASSWORD_KDF_ITERATIONS: '600000',
    ORGANIZATION_KDF_DIAGNOSTICS: '1'
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
for (const limiter of c.env.admin_staging.ratelimits) if (protectedIds.has(String(limiter.namespace_id))) throw new Error(`Rate collision ${limiter.namespace_id}`);
fs.writeFileSync('wrangler.jsonc', JSON.stringify(c, null, 2) + '\n');
NODE

npx wrangler d1 migrations apply "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote
CLEANUP_READY=1
npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command 'PRAGMA foreign_key_check;' > "$OUT/fk-before.json"
jq -e '[.[].results[]?] | length == 0' "$OUT/fk-before.json" >/dev/null
STATE="$(npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command "SELECT (SELECT COUNT(*) FROM organization_bootstrap_state) bootstrap_count,(SELECT COUNT(*) FROM organizations) organization_count,(SELECT COUNT(*) FROM organization_accounts) account_count,(SELECT COUNT(*) FROM campaigns WHERE organization_id IS NOT NULL) owned_campaign_count;")"
printf '%s' "$STATE" > "$OUT/state-before.json"
jq -e '.[0].results[0] | .bootstrap_count==0 and .organization_count==0 and .account_count==0 and .owned_campaign_count==0' <<<"$STATE" >/dev/null || { echo 'Admin staging is not pristine.' >&2; exit 1; }

printf '%s' "$TOTP_KEY" | npx wrangler secret put ORGANIZATION_TOTP_KEY --name "$ADMIN_WORKER_NAME"

export CLOUDFLARE_ENV=admin_staging
rm -rf dist .wrangler
npm run build
node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const redirect = JSON.parse(fs.readFileSync('.wrangler/deploy/config.json', 'utf8'));
const generated = JSON.parse(fs.readFileSync(path.resolve('.wrangler/deploy', redirect.configPath), 'utf8'));
if (generated.name !== process.env.ADMIN_WORKER_NAME) throw new Error('Wrong Worker');
if ((generated.d1_databases || []).find((x) => x.binding === 'DB')?.database_id !== process.env.ADMIN_D1_ID) throw new Error('Wrong D1');
if (!(generated.durable_objects?.bindings || []).some((x) => x.name === 'ORGANIZATION_PASSWORD_KDF' && x.class_name === 'OrganizationPasswordKdfDurableObject')) throw new Error('KDF binding missing');
if (generated.vars?.ORGANIZATION_PASSWORD_KDF_ITERATIONS !== '600000') throw new Error('600k KDF policy missing');
if (!(generated.compatibility_flags || []).includes('nodejs_compat')) throw new Error('nodejs_compat missing');
const serialized = JSON.stringify(generated);
if (serialized.includes(process.env.PROD_D1_ID) || serialized.includes(process.env.RXDB_STAGING_D1_ID)) throw new Error('Protected D1 leaked into Admin candidate');
NODE
npx wrangler deploy --dry-run --outdir .wrangler-admin-v9-dry-run >/dev/null
npx wrangler deploy 2>&1 | tee "$OUT/deploy-smoke.log"
TEST_URL="$(grep -Eo 'https://[^[:space:]]+\.workers\.dev' "$OUT/deploy-smoke.log" | tail -n1 || true)"
[[ -n "$TEST_URL" ]] || { echo 'No workers.dev URL found.' >&2; exit 1; }
export TEST_URL

for attempt in $(seq 1 24); do
  START="$(curl -sSLo "$PRIVATE/start.html" -w '%{http_code}' "$TEST_URL/start" || printf 000)"
  PROBE="$(jq -n --arg s "$SMOKE_BOOTSTRAP_SECRET" '{bootstrapSecret:$s}')"
  CODE="$(curl -sS -o "$PRIVATE/candidate-probe.json" -w '%{http_code}' -X POST "$TEST_URL/api/organization/bootstrap" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' --data "$PROBE" || printf 000)"
  if [[ "$START" -ge 200 && "$START" -lt 400 && "$CODE" == '400' ]]; then break; fi
  [[ "$attempt" != '24' ]] || { echo 'Candidate did not converge.' >&2; exit 1; }
  sleep 5
done

HEAD_CODE="$(curl -sS -I -D "$OUT/head-api-headers.txt" -o /dev/null -w '%{http_code}' "$TEST_URL/api/organization/me" || printf 000)"
[[ "$HEAD_CODE" == '405' ]]
grep -Eqi '^content-type: application/json' "$OUT/head-api-headers.txt"
grep -Eqi '^cache-control: no-store' "$OUT/head-api-headers.txt"
grep -Eqi '^allow: GET' "$OUT/head-api-headers.txt"
grep -Eqi '^x-frame-options: DENY' "$OUT/head-api-headers.txt"
grep -Eqi '^x-content-type-options: nosniff' "$OUT/head-api-headers.txt"
UNKNOWN="$(curl -sS -o "$OUT/unknown-api.json" -w '%{http_code}' "$TEST_URL/api/organization/not-a-route" || printf 000)"
[[ "$UNKNOWN" == '404' ]]
jq -e '.error.code=="api_route_not_found"' "$OUT/unknown-api.json" >/dev/null
jq -n --arg head "$HEAD_CODE" --arg unknown "$UNKNOWN" '{ok:true,head_status:$head,unknown_status:$unknown}' > "$OUT/method-gate.json"

SMOKE_USERNAME="runtime.smoke.${GITHUB_RUN_ID}"
ORGANIZATION_NAME="Runtime Smoke ${GITHUB_RUN_ID}"
export SMOKE_USERNAME
jq -n --arg organizationName "$ORGANIZATION_NAME" --arg username "$SMOKE_USERNAME" --arg password "$SMOKE_PASSWORD" --arg bootstrapSecret "$SMOKE_BOOTSTRAP_SECRET" '{organizationName:$organizationName,username:$username,password:$password,bootstrapSecret:$bootstrapSecret}' > "$PRIVATE/bootstrap.json"
B="$(curl -sS -o "$PRIVATE/bootstrap-response.json" -w '%{http_code}' -c "$PRIVATE/cookies.txt" -X POST "$TEST_URL/api/organization/bootstrap" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' --data-binary @"$PRIVATE/bootstrap.json" || printf 000)"
if [[ "$B" != '201' ]]; then
  CODE="$(jq -r '.error.code//"non_json"' "$PRIVATE/bootstrap-response.json" 2>/dev/null || printf non_json)"
  REASON="$(jq -r '.error.details.reason//""' "$PRIVATE/bootstrap-response.json" 2>/dev/null || true)"
  jq -n --arg status "$B" --arg code "$CODE" --arg reason "$REASON" '{ok:false,stage:"bootstrap",http_status:$status,error_code:$code,reason:$reason}' > "$OUT/runtime-smoke.json"
  exit 1
fi
jq -e '(.organization.id|type=="string") and (.account.id|type=="string") and (.recoveryCodes|length==10) and (.otpauthUri|startswith("otpauth://totp/"))' "$PRIVATE/bootstrap-response.json" >/dev/null
ORGANIZATION_ID="$(jq -r '.organization.id' "$PRIVATE/bootstrap-response.json")"
ORGANIZER_TOTP_SECRET="$(jq -r '.otpauthUri' "$PRIVATE/bootstrap-response.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(new URL(s.trim()).searchParams.get("secret")||""));')"
echo "::add-mask::$ORGANIZER_TOTP_SECRET"
export ORGANIZATION_ID ORGANIZER_TOTP_SECRET

jq -n --arg username "$SMOKE_USERNAME" --arg password "$SMOKE_PASSWORD" '{username:$username,password:$password}' > "$PRIVATE/login.json"
L="$(curl -sS -o "$PRIVATE/login-response.json" -w '%{http_code}' -b "$PRIVATE/cookies.txt" -c "$PRIVATE/cookies.txt" -X POST "$TEST_URL/api/organization/login/password" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' --data-binary @"$PRIVATE/login.json" || printf 000)"
[[ "$L" == '200' ]]
OTP="$(python - "$ORGANIZER_TOTP_SECRET" <<'PY'
import base64,hashlib,hmac,struct,sys,time
key=base64.b32decode(sys.argv[1],casefold=True); c=int(time.time())//30
d=hmac.new(key,struct.pack('>Q',c),hashlib.sha1).digest(); o=d[-1]&15
n=((d[o]&127)<<24)|((d[o+1]&255)<<16)|((d[o+2]&255)<<8)|(d[o+3]&255)
print(f'{n%1000000:06d}')
PY
)"
M="$(curl -sS -o "$PRIVATE/totp-response.json" -w '%{http_code}' -b "$PRIVATE/cookies.txt" -c "$PRIVATE/cookies.txt" -X POST "$TEST_URL/api/organization/login/totp" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' --data "{\"code\":\"$OTP\"}" || printf 000)"
[[ "$M" == '200' ]]
ME="$(curl -sS -o "$PRIVATE/me.json" -w '%{http_code}' -b "$PRIVATE/cookies.txt" "$TEST_URL/api/organization/me" || printf 000)"
[[ "$ME" == '200' ]]
jq -e '.assurance=="mfa" and (.memberships|length==1) and .memberships[0].role=="organizer"' "$PRIVATE/me.json" >/dev/null
jq -n --arg bootstrap "$B" --arg password "$L" --arg totp "$M" --arg me "$ME" '{ok:true,bootstrap_status:$bootstrap,password_status:$password,totp_status:$totp,me_status:$me}' > "$OUT/runtime-smoke.json"

npm install --no-save --no-package-lock playwright@1.55.0 >/dev/null
npx playwright install --with-deps chromium >/dev/null
node .staging/admin-v9-browser.mjs

cleanup_remote
CLEANED=1
CLEAN="$(npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command "SELECT (SELECT COUNT(*) FROM organization_bootstrap_state) bootstrap_count,(SELECT COUNT(*) FROM organizations) organization_count,(SELECT COUNT(*) FROM organization_accounts) account_count,(SELECT COUNT(*) FROM campaigns WHERE organization_id IS NOT NULL) owned_campaign_count;")"
printf '%s' "$CLEAN" > "$OUT/clean-state.json"
jq -e '.[0].results[0] | .bootstrap_count==0 and .organization_count==0 and .account_count==0 and .owned_campaign_count==0' <<<"$CLEAN" >/dev/null
npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command 'PRAGMA foreign_key_check;' > "$OUT/fk-after.json"
jq -e '[.[].results[]?] | length == 0' "$OUT/fk-after.json" >/dev/null

node <<'NODE'
const fs = require('node:fs');
const c = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
c.env.admin_staging.vars.ORGANIZATION_BOOTSTRAP_SECRET_SHA256 = process.env.FINAL_BOOTSTRAP_SECRET_SHA256;
delete c.env.admin_staging.vars.ORGANIZATION_KDF_DIAGNOSTICS;
fs.writeFileSync('wrangler.jsonc', JSON.stringify(c, null, 2) + '\n');
NODE
rm -rf dist .wrangler/deploy
npm run build >/dev/null
npx wrangler deploy 2>&1 | tee "$OUT/deploy-final.log"
FINAL_URL="$(grep -Eo 'https://[^[:space:]]+\.workers\.dev' "$OUT/deploy-final.log" | tail -n1 || true)"
[[ -n "$FINAL_URL" ]]
TEST_URL="$FINAL_URL"
export TEST_URL

CONSECUTIVE=0
for attempt in $(seq 1 24); do
  PROBE="$(jq -n --arg s "$SMOKE_BOOTSTRAP_SECRET" '{bootstrapSecret:$s}')"
  CODE="$(curl -sS -o "$PRIVATE/final-rotation-probe.json" -w '%{http_code}' -X POST "$TEST_URL/api/organization/bootstrap" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' --data "$PROBE" || printf 000)"
  if [[ "$CODE" == '403' ]]; then CONSECUTIVE=$((CONSECUTIVE+1)); [[ "$CONSECUTIVE" -ge 3 ]] && break; else CONSECUTIVE=0; fi
  sleep 5
done
[[ "$CONSECUTIVE" -ge 3 ]]
START="$(curl -sSLo "$PRIVATE/final-start.html" -w '%{http_code}' "$TEST_URL/start")"
ME_FINAL="$(curl -sS -o "$PRIVATE/final-me.json" -w '%{http_code}' "$TEST_URL/api/organization/me")"
HEAD_FINAL="$(curl -sS -I -D "$OUT/final-head-api-headers.txt" -o /dev/null -w '%{http_code}' "$TEST_URL/api/organization/me")"
ORIGIN="$(curl -sS -o "$PRIVATE/final-origin.json" -w '%{http_code}' -X POST "$TEST_URL/api/organization/login/password" -H 'Origin: https://invalid.example' -H 'Content-Type: application/json' --data '{}')"
[[ "$START" -ge 200 && "$START" -lt 400 ]]
[[ "$ME_FINAL" == '401' ]]
[[ "$HEAD_FINAL" == '405' ]]
[[ "$ORIGIN" == '403' ]]
grep -Eqi '^content-type: application/json' "$OUT/final-head-api-headers.txt"
grep -Eqi '^x-frame-options: DENY' "$OUT/final-head-api-headers.txt"
grep -Eqi '^x-content-type-options: nosniff' "$OUT/final-head-api-headers.txt"
curl -sS -D "$OUT/final-start-headers.txt" -o /dev/null "$TEST_URL/start"
grep -Eqi '^x-frame-options: DENY' "$OUT/final-start-headers.txt"
grep -Eqi '^x-content-type-options: nosniff' "$OUT/final-start-headers.txt"
printf '%s\n' "$TEST_URL" > "$OUT/test-url.txt"
jq -n --arg start "$START" --arg me "$ME_FINAL" --arg head "$HEAD_FINAL" --arg cross_origin "$ORIGIN" --arg source "$AUDITED_SOURCE_SHA" '{ok:true,start:$start,unauthenticated_me:$me,head_api:$head,cross_origin:$cross_origin,audited_source:$source,production_untouched:true}' > "$OUT/final-safety.json"

git show "$AUDITED_SOURCE_SHA:wrangler.jsonc" > "$OUT/checked-in-wrangler.jsonc"
node <<'NODE'
const fs = require('node:fs');
const c = JSON.parse(fs.readFileSync('/tmp/admin-v9/checked-in-wrangler.jsonc', 'utf8'));
if (c.main !== './worker/indexFc52.ts') throw new Error('Checked-in production main changed');
if ((c.d1_databases || []).find((x) => x.binding === 'DB')?.database_id !== '0113e775-1e43-4d96-8b97-51fdeec7355b') throw new Error('Checked-in production D1 changed');
NODE
