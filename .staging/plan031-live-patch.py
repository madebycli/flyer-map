from pathlib import Path

path = Path('.staging/admin-v9-release.sh')
source = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'expected exactly one harness anchor, found {count}: {old[:120]!r}')
    source = source.replace(old, new, 1)


replace_once(
    '''TOTP_KEY="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
[[ "$TOTP_KEY" =~ ^[A-Za-z0-9_-]{43}$ ]] || { echo 'Invalid generated TOTP key.' >&2; exit 1; }
for value in "$SMOKE_BOOTSTRAP_SECRET" "$SMOKE_PASSWORD" "$INVITE_PASSWORD" "$TOTP_KEY"; do echo "::add-mask::$value"; done
SMOKE_DIGEST="$(printf '%s' "$SMOKE_BOOTSTRAP_SECRET" | sha256sum | awk '{print $1}')"
export SMOKE_BOOTSTRAP_SECRET SMOKE_PASSWORD INVITE_PASSWORD TOTP_KEY SMOKE_DIGEST
''',
    '''TOTP_KEY="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
[[ "$TOTP_KEY" =~ ^[A-Za-z0-9_-]{43}$ ]] || { echo 'Invalid generated TOTP key.' >&2; exit 1; }
[[ "$FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY" =~ ^[A-Za-z0-9_-]{43}$ ]] || { echo 'Invalid generated field-group recovery key.' >&2; exit 1; }
for value in "$SMOKE_BOOTSTRAP_SECRET" "$SMOKE_PASSWORD" "$INVITE_PASSWORD" "$TOTP_KEY" "$FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY"; do echo "::add-mask::$value"; done
SMOKE_DIGEST="$(printf '%s' "$SMOKE_BOOTSTRAP_SECRET" | sha256sum | awk '{print $1}')"
export SMOKE_BOOTSTRAP_SECRET SMOKE_PASSWORD INVITE_PASSWORD TOTP_KEY FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY SMOKE_DIGEST
''',
)

replace_once(
    '''npx wrangler d1 migrations apply "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote
CLEANUP_READY=1
''',
    '''npx wrangler d1 migrations apply "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote
npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command "SELECT name, sql FROM sqlite_master WHERE type='table' AND name='field_group_recoverable_credentials'; PRAGMA table_info(field_group_recoverable_credentials);" > "$OUT/plan031-migration.json"
jq -e '([.[].results[]? | select(.name=="field_group_recoverable_credentials")] | length) >= 1' "$OUT/plan031-migration.json" >/dev/null
jq -e '([.[].results[]? | select(.name=="credential_id")] | length) >= 1 and ([.[].results[]? | select(.name=="ciphertext_b64")] | length) >= 1' "$OUT/plan031-migration.json" >/dev/null
CLEANUP_READY=1
''',
)

replace_once(
    '''printf '%s' "$TOTP_KEY" | npx wrangler secret put ORGANIZATION_TOTP_KEY --name "$ADMIN_WORKER_NAME"

export CLOUDFLARE_ENV=admin_staging
''',
    '''printf '%s' "$TOTP_KEY" | npx wrangler secret put ORGANIZATION_TOTP_KEY --name "$ADMIN_WORKER_NAME"
printf '%s' "$FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY" | npx wrangler secret put FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY --name "$ADMIN_WORKER_NAME"
jq -n '{ok:true,field_group_recovery_key_configured:true,key_bytes:32}' > "$OUT/plan031-recovery-secret.json"

export CLOUDFLARE_ENV=admin_staging
''',
)

api_smoke = r'''

# Plan 031 room lifecycle acceptance. The team row is a staging-only fixture. Every
# room operation itself runs through the real HTTP API with the organizer MFA cookie.
PLAN031_CAMPAIGN_NAME="Plan031 Runtime ${GITHUB_RUN_ID}"
PLAN031_BROWSER_ROOM_LABEL="Hidden Runtime ${GITHUB_RUN_ID}"
TEAM_ID="team_plan031_${GITHUB_RUN_ID}"
export PLAN031_BROWSER_ROOM_LABEL
jq -n --arg name "$PLAN031_CAMPAIGN_NAME" '{name:$name,lifecycle:"active",map:{lng:13.405,lat:52.52,zoom:13,bearing:0}}' > "$PRIVATE/plan031-campaign.json"
PC="$(curl -sS -o "$PRIVATE/plan031-campaign-response.json" -w '%{http_code}' -b "$PRIVATE/cookies.txt" -X POST "$TEST_URL/api/organizations/${ORGANIZATION_ID}/campaigns" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' --data-binary @"$PRIVATE/plan031-campaign.json" || printf 000)"
[[ "$PC" == '201' ]]
PLAN031_CAMPAIGN_ID="$(jq -r '.campaign.id' "$PRIVATE/plan031-campaign-response.json")"
[[ "$PLAN031_CAMPAIGN_ID" =~ ^campaign_[A-Za-z0-9-]+$ ]]
export PLAN031_CAMPAIGN_ID
npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --command "INSERT INTO teams (id,campaign_id,name,color,created_at,updated_at) VALUES ('$TEAM_ID','$PLAN031_CAMPAIGN_ID','Plan 031 Team','#2563eb',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));" >/dev/null

create_group() {
  local label="$1" discoverable="$2" request_id="$3" output="$4"
  jq -n --arg label "$label" --arg teamId "$TEAM_ID" --arg requestId "$request_id" --argjson discoverable "$discoverable" '{label:$label,teamId:$teamId,mode:"distribution",discoverable:$discoverable,participantCount:3,requestId:$requestId}' > "$PRIVATE/group-create.json"
  local status
  status="$(curl -sS -o "$output" -w '%{http_code}' -b "$PRIVATE/cookies.txt" -X POST "$TEST_URL/api/campaigns/${PLAN031_CAMPAIGN_ID}/field-groups" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' --data-binary @"$PRIVATE/group-create.json" || printf 000)"
  [[ "$status" == '201' ]]
  jq -e '(.group.id|type=="string") and (.credentials.roomCode|type=="string") and (.credentials.qrToken|type=="string") and .alreadyApplied==false' "$output" >/dev/null
}

create_group "$PLAN031_BROWSER_ROOM_LABEL" false "create_browser_${GITHUB_RUN_ID}" "$PRIVATE/browser-group.json"
BROWSER_GROUP_ID="$(jq -r '.group.id' "$PRIVATE/browser-group.json")"
OLD_ROOM_CODE="$(jq -r '.credentials.roomCode' "$PRIVATE/browser-group.json")"
OLD_QR_TOKEN="$(jq -r '.credentials.qrToken' "$PRIVATE/browser-group.json")"
for value in "$OLD_ROOM_CODE" "$OLD_QR_TOKEN"; do echo "::add-mask::$value"; done
RECOVERY_CREATE="$(npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command "SELECT COUNT(*) AS n FROM field_group_recoverable_credentials WHERE campaign_id='$PLAN031_CAMPAIGN_ID' AND group_id='$BROWSER_GROUP_ID';")"
[[ "$(jq -r '.[0].results[0].n' <<<"$RECOVERY_CREATE")" == '2' ]]

REVEAL="$(curl -sS -o "$PRIVATE/browser-reveal.json" -w '%{http_code}' -b "$PRIVATE/cookies.txt" "$TEST_URL/api/campaigns/${PLAN031_CAMPAIGN_ID}/field-groups/${BROWSER_GROUP_ID}/credentials/current" || printf 000)"
[[ "$REVEAL" == '200' ]]
jq -e --arg code "$OLD_ROOM_CODE" --arg qr "$OLD_QR_TOKEN" '.credentials.roomCode==$code and .credentials.qrToken==$qr' "$PRIVATE/browser-reveal.json" >/dev/null

LIST="$(curl -sS -o "$OUT/plan031-hidden-list.json" -w '%{http_code}' -b "$PRIVATE/cookies.txt" "$TEST_URL/api/campaigns/${PLAN031_CAMPAIGN_ID}/field-groups" || printf 000)"
[[ "$LIST" == '200' ]]
jq -e --arg id "$BROWSER_GROUP_ID" '[.groups[] | select(.id==$id and .discoverable==false)] | length==1' "$OUT/plan031-hidden-list.json" >/dev/null
UNAUTH_LIST="$(curl -sS -o "$PRIVATE/plan031-unauth-list.json" -w '%{http_code}' "$TEST_URL/api/campaigns/${PLAN031_CAMPAIGN_ID}/field-groups" || printf 000)"
[[ "$UNAUTH_LIST" == '401' ]]

jq -n --arg requestId "rotate_browser_${GITHUB_RUN_ID}" '{requestId:$requestId}' > "$PRIVATE/rotate.json"
ROTATE="$(curl -sS -o "$PRIVATE/rotate-response.json" -w '%{http_code}' -b "$PRIVATE/cookies.txt" -X POST "$TEST_URL/api/campaigns/${PLAN031_CAMPAIGN_ID}/field-groups/${BROWSER_GROUP_ID}/credentials/rotate" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' --data-binary @"$PRIVATE/rotate.json" || printf 000)"
[[ "$ROTATE" == '200' ]]
NEW_ROOM_CODE="$(jq -r '.credentials.roomCode' "$PRIVATE/rotate-response.json")"
NEW_QR_TOKEN="$(jq -r '.credentials.qrToken' "$PRIVATE/rotate-response.json")"
for value in "$NEW_ROOM_CODE" "$NEW_QR_TOKEN"; do echo "::add-mask::$value"; done
[[ "$NEW_ROOM_CODE" != "$OLD_ROOM_CODE" && "$NEW_QR_TOKEN" != "$OLD_QR_TOKEN" ]]
REVEAL2="$(curl -sS -o "$PRIVATE/browser-reveal-rotated.json" -w '%{http_code}' -b "$PRIVATE/cookies.txt" "$TEST_URL/api/campaigns/${PLAN031_CAMPAIGN_ID}/field-groups/${BROWSER_GROUP_ID}/credentials/current" || printf 000)"
[[ "$REVEAL2" == '200' ]]
jq -e --arg code "$NEW_ROOM_CODE" --arg qr "$NEW_QR_TOKEN" '.credentials.roomCode==$code and .credentials.qrToken==$qr' "$PRIVATE/browser-reveal-rotated.json" >/dev/null
RECOVERY_ROTATE="$(npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command "SELECT COUNT(*) AS n FROM field_group_recoverable_credentials WHERE campaign_id='$PLAN031_CAMPAIGN_ID' AND group_id='$BROWSER_GROUP_ID';")"
[[ "$(jq -r '.[0].results[0].n' <<<"$RECOVERY_ROTATE")" == '2' ]]

jq -n --arg campaignId "$PLAN031_CAMPAIGN_ID" --arg secret "$OLD_ROOM_CODE" '{campaignId:$campaignId,kind:"room-code",secret:$secret}' > "$PRIVATE/join-old.json"
OLD_JOIN="$(curl -sS -o "$PRIVATE/join-old-response.json" -w '%{http_code}' -c "$PRIVATE/old-join-cookies.txt" -X POST "$TEST_URL/api/field-groups/join" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' --data-binary @"$PRIVATE/join-old.json" || printf 000)"
[[ "$OLD_JOIN" == '401' ]]
jq -e '.error.code=="join_unavailable"' "$PRIVATE/join-old-response.json" >/dev/null
jq -n --arg campaignId "$PLAN031_CAMPAIGN_ID" --arg secret "$NEW_ROOM_CODE" '{campaignId:$campaignId,kind:"room-code",secret:$secret}' > "$PRIVATE/join-new.json"
NEW_JOIN="$(curl -sS -o "$PRIVATE/join-new-response.json" -w '%{http_code}' -c "$PRIVATE/new-join-cookies.txt" -X POST "$TEST_URL/api/field-groups/join" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' --data-binary @"$PRIVATE/join-new.json" || printf 000)"
[[ "$NEW_JOIN" == '200' ]]
jq -e --arg id "$BROWSER_GROUP_ID" '.group.id==$id and .membership.temporary==true and .access.role=="field-group-member"' "$PRIVATE/join-new-response.json" >/dev/null

create_group "Revoke Runtime ${GITHUB_RUN_ID}" true "create_revoke_${GITHUB_RUN_ID}" "$PRIVATE/revoke-group.json"
REVOKE_GROUP_ID="$(jq -r '.group.id' "$PRIVATE/revoke-group.json")"
REVOKE="$(curl -sS -o "$PRIVATE/revoke-response.json" -w '%{http_code}' -b "$PRIVATE/cookies.txt" -X POST "$TEST_URL/api/campaigns/${PLAN031_CAMPAIGN_ID}/field-groups/${REVOKE_GROUP_ID}/credentials/revoke" -H "Origin: $TEST_URL" || printf 000)"
[[ "$REVOKE" == '200' ]]
REVOKE_REVEAL="$(curl -sS -o "$PRIVATE/revoke-reveal.json" -w '%{http_code}' -b "$PRIVATE/cookies.txt" "$TEST_URL/api/campaigns/${PLAN031_CAMPAIGN_ID}/field-groups/${REVOKE_GROUP_ID}/credentials/current" || printf 000)"
[[ "$REVOKE_REVEAL" == '409' ]]
jq -e '.error.code=="credential_recovery_unavailable"' "$PRIVATE/revoke-reveal.json" >/dev/null
REVOKE_RECOVERY="$(npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command "SELECT COUNT(*) AS n FROM field_group_recoverable_credentials WHERE campaign_id='$PLAN031_CAMPAIGN_ID' AND group_id='$REVOKE_GROUP_ID';")"
[[ "$(jq -r '.[0].results[0].n' <<<"$REVOKE_RECOVERY")" == '0' ]]

create_group "Close Runtime ${GITHUB_RUN_ID}" true "create_close_${GITHUB_RUN_ID}" "$PRIVATE/close-group.json"
CLOSE_GROUP_ID="$(jq -r '.group.id' "$PRIVATE/close-group.json")"
CLOSE="$(curl -sS -o "$PRIVATE/close-response.json" -w '%{http_code}' -b "$PRIVATE/cookies.txt" -X POST "$TEST_URL/api/campaigns/${PLAN031_CAMPAIGN_ID}/field-groups/${CLOSE_GROUP_ID}/close" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' --data '{"participantCount":4}' || printf 000)"
[[ "$CLOSE" == '200' ]]
jq -e '.group.state=="closed" and .tourSummary.participantCount==4' "$PRIVATE/close-response.json" >/dev/null
CLOSE_RECOVERY="$(npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command "SELECT COUNT(*) AS n FROM field_group_recoverable_credentials WHERE campaign_id='$PLAN031_CAMPAIGN_ID' AND group_id='$CLOSE_GROUP_ID';")"
[[ "$(jq -r '.[0].results[0].n' <<<"$CLOSE_RECOVERY")" == '0' ]]

create_group "Expiry Runtime ${GITHUB_RUN_ID}" true "create_expiry_${GITHUB_RUN_ID}" "$PRIVATE/expiry-group.json"
EXPIRY_GROUP_ID="$(jq -r '.group.id' "$PRIVATE/expiry-group.json")"
npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --command "UPDATE field_groups SET hard_expires_at='2000-01-01T00:00:00.000Z' WHERE id='$EXPIRY_GROUP_ID' AND campaign_id='$PLAN031_CAMPAIGN_ID';" >/dev/null
EXPIRY_TRIGGER="$(curl -sS -o "$PRIVATE/expiry-trigger.json" -w '%{http_code}' -b "$PRIVATE/cookies.txt" "$TEST_URL/api/campaigns/${PLAN031_CAMPAIGN_ID}/field-groups" || printf 000)"
[[ "$EXPIRY_TRIGGER" == '200' ]]
EXPIRY_STATE="$(npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command "SELECT state,(SELECT COUNT(*) FROM field_group_recoverable_credentials r WHERE r.campaign_id='$PLAN031_CAMPAIGN_ID' AND r.group_id='$EXPIRY_GROUP_ID') AS recovery_count FROM field_groups WHERE id='$EXPIRY_GROUP_ID' AND campaign_id='$PLAN031_CAMPAIGN_ID';")"
[[ "$(jq -r '.[0].results[0].state' <<<"$EXPIRY_STATE")" == 'expired' ]]
[[ "$(jq -r '.[0].results[0].recovery_count' <<<"$EXPIRY_STATE")" == '0' ]]

jq -n \
  --arg campaign_create "$PC" --arg reveal "$REVEAL2" --arg hidden_list "$LIST" --arg unauth_list "$UNAUTH_LIST" \
  --arg rotate "$ROTATE" --arg old_join "$OLD_JOIN" --arg new_join "$NEW_JOIN" --arg revoke "$REVOKE" --arg close "$CLOSE" --arg expiry "$EXPIRY_TRIGGER" \
  '{ok:true,campaign_create:$campaign_create,reveal_after_rotation:$reveal,hidden_room_list:$hidden_list,unauthenticated_list:$unauth_list,rotation:$rotate,old_credential_join:$old_join,new_credential_join:$new_join,revoke:$revoke,close:$close,expiry_trigger:$expiry,recovery_rows_after_rotate:2,recovery_rows_after_revoke:0,recovery_rows_after_close:0,recovery_rows_after_expiry:0}' > "$OUT/plan031-api.json"
'''

replace_once(
    '''jq -n --arg bootstrap "$B" --arg password "$L" --arg totp "$M" --arg me "$ME" '{ok:true,bootstrap_status:$bootstrap,password_status:$password,totp_status:$totp,me_status:$me}' > "$OUT/runtime-smoke.json"

if ! npm install --no-save --no-package-lock playwright@1.55.0 > "$OUT/playwright-npm-install.log" 2>&1; then
''',
    '''jq -n --arg bootstrap "$B" --arg password "$L" --arg totp "$M" --arg me "$ME" '{ok:true,bootstrap_status:$bootstrap,password_status:$password,totp_status:$totp,me_status:$me}' > "$OUT/runtime-smoke.json"\n''' + api_smoke + '''\nif ! npm install --no-save --no-package-lock playwright@1.55.0 > "$OUT/playwright-npm-install.log" 2>&1; then
''',
)

replace_once(
    '''if ! node .staging/admin-v9-browser.mjs > "$PRIVATE/browser.stdout" 2> "$PRIVATE/browser.stderr"; then
  if [[ ! -s "$OUT/browser-failure.json" ]]; then
    jq -n '{ok:false,stage:"browser_process",error:"Browser process failed before producing diagnostics"}' > "$OUT/browser-failure.json"
  fi
  exit 1
fi

unset -f curl
''',
    '''if ! node .staging/admin-v9-browser.mjs > "$PRIVATE/browser.stdout" 2> "$PRIVATE/browser.stderr"; then
  if [[ ! -s "$OUT/browser-failure.json" ]]; then
    jq -n '{ok:false,stage:"browser_process",error:"Browser process failed before producing diagnostics"}' > "$OUT/browser-failure.json"
  fi
  exit 1
fi
if ! node .staging/plan031-field-browser.mjs > "$PRIVATE/plan031-browser.stdout" 2> "$PRIVATE/plan031-browser.stderr"; then
  if [[ ! -s "$OUT/plan031-browser-failure.json" ]]; then
    jq -n '{ok:false,stage:"plan031_browser_process",error:"Plan 031 browser process failed before producing diagnostics"}' > "$OUT/plan031-browser-failure.json"
  fi
  exit 1
fi

unset -f curl
''',
)

replace_once(
    '''npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command 'PRAGMA foreign_key_check;' > "$OUT/fk-after.json"
jq -e '[.[].results[]?] | length == 0' "$OUT/fk-after.json" >/dev/null

node <<'NODE'
''',
    '''npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command 'PRAGMA foreign_key_check;' > "$OUT/fk-after.json"
jq -e '[.[].results[]?] | length == 0' "$OUT/fk-after.json" >/dev/null
PLAN031_CLEAN="$(npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command "SELECT (SELECT COUNT(*) FROM field_groups WHERE campaign_id='$PLAN031_CAMPAIGN_ID') group_count,(SELECT COUNT(*) FROM field_group_join_credentials WHERE campaign_id='$PLAN031_CAMPAIGN_ID') credential_count,(SELECT COUNT(*) FROM field_group_recoverable_credentials WHERE campaign_id='$PLAN031_CAMPAIGN_ID') recovery_count,(SELECT COUNT(*) FROM field_group_memberships WHERE campaign_id='$PLAN031_CAMPAIGN_ID') membership_count;")"
printf '%s' "$PLAN031_CLEAN" > "$OUT/plan031-clean-state.json"
jq -e '.[0].results[0] | .group_count==0 and .credential_count==0 and .recovery_count==0 and .membership_count==0' <<<"$PLAN031_CLEAN" >/dev/null

node <<'NODE'
''',
)

path.write_text(source, encoding='utf-8')
