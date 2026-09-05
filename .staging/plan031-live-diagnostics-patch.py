from pathlib import Path

path = Path('.staging/admin-v9-release.sh')
source = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'expected exactly one diagnostics anchor, found {count}: {old[:120]!r}')
    source = source.replace(old, new, 1)


replace_once(
    'PLAN031_CAMPAIGN_NAME="Plan031 Runtime ${GITHUB_RUN_ID}"\n',
    '''plan031_checkpoint() {
  local stage="$1" status="${2:-ok}"
  jq -nc --arg stage "$stage" --arg status "$status" '{stage:$stage,status:$status}' >> "$OUT/plan031-checkpoints.jsonl"
}
: > "$OUT/plan031-checkpoints.jsonl"
plan031_checkpoint "matrix_start"

PLAN031_CAMPAIGN_NAME="Plan031 Runtime ${GITHUB_RUN_ID}"
''',
)

replace_once(
    '[[ "$PC" == \'201\' ]]\n',
    'plan031_checkpoint "campaign_create_http" "$PC"\n[[ "$PC" == \'201\' ]]\n',
)

replace_once(
    '[[ "$PLAN031_CAMPAIGN_ID" =~ ^campaign_[A-Za-z0-9-]+$ ]]\n',
    '[[ "$PLAN031_CAMPAIGN_ID" =~ ^campaign_[A-Za-z0-9-]+$ ]]\nplan031_checkpoint "campaign_id_valid"\n',
)

replace_once(
    'npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --command "INSERT INTO teams (id,campaign_id,name,color,created_at,updated_at) VALUES (\'$TEAM_ID\',\'$PLAN031_CAMPAIGN_ID\',\'Plan 031 Team\',\'#2563eb\',strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\'),strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\'));" >/dev/null\n',
    'npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --command "INSERT INTO teams (id,campaign_id,name,color,created_at,updated_at) VALUES (\'$TEAM_ID\',\'$PLAN031_CAMPAIGN_ID\',\'Plan 031 Team\',\'#2563eb\',strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\'),strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\'));" >/dev/null\nplan031_checkpoint "team_fixture_inserted"\n',
)

replace_once(
    '  [[ "$status" == \'201\' ]]\n',
    '''  plan031_checkpoint "create_group_http" "$status"
  if [[ "$status" != '201' ]]; then
    local error_code
    error_code="$(jq -r '.error.code // "unknown"' "$output" 2>/dev/null || printf 'unparseable')"
    jq -n --arg stage "create_group" --arg status "$status" --arg errorCode "$error_code" \
      '{stage:$stage,http_status:$status,error_code:$errorCode}' > "$OUT/plan031-create-group-failure.json"
  fi
  [[ "$status" == '201' ]]
''',
)

replace_once(
    '[[ "$(jq -r \'.[0].results[0].n\' <<<"$RECOVERY_CREATE")" == \'2\' ]]\n',
    'RECOVERY_CREATE_COUNT="$(jq -r \'.[0].results[0].n\' <<<"$RECOVERY_CREATE")"\nplan031_checkpoint "recovery_rows_after_create" "$RECOVERY_CREATE_COUNT"\n[[ "$RECOVERY_CREATE_COUNT" == \'2\' ]]\n',
)

replace_once(
    '[[ "$REVEAL" == \'200\' ]]\n',
    'plan031_checkpoint "reveal_current_http" "$REVEAL"\n[[ "$REVEAL" == \'200\' ]]\n',
)

replace_once(
    '[[ "$LIST" == \'200\' ]]\n',
    'plan031_checkpoint "manager_hidden_list_http" "$LIST"\n[[ "$LIST" == \'200\' ]]\n',
)

replace_once(
    '[[ "$UNAUTH_LIST" == \'401\' ]]\n',
    'plan031_checkpoint "unauth_list_http" "$UNAUTH_LIST"\n[[ "$UNAUTH_LIST" == \'401\' ]]\n',
)

replace_once(
    '[[ "$ROTATE" == \'200\' ]]\n',
    'plan031_checkpoint "rotate_http" "$ROTATE"\n[[ "$ROTATE" == \'200\' ]]\n',
)

replace_once(
    '[[ "$REVEAL2" == \'200\' ]]\n',
    'plan031_checkpoint "reveal_rotated_http" "$REVEAL2"\n[[ "$REVEAL2" == \'200\' ]]\n',
)

replace_once(
    '[[ "$OLD_JOIN" == \'401\' ]]\n',
    'plan031_checkpoint "old_join_http" "$OLD_JOIN"\n[[ "$OLD_JOIN" == \'401\' ]]\n',
)

replace_once(
    '[[ "$NEW_JOIN" == \'200\' ]]\n',
    'plan031_checkpoint "new_join_http" "$NEW_JOIN"\n[[ "$NEW_JOIN" == \'200\' ]]\n',
)

replace_once(
    '[[ "$REVOKE" == \'200\' ]]\n',
    'plan031_checkpoint "revoke_http" "$REVOKE"\n[[ "$REVOKE" == \'200\' ]]\n',
)

replace_once(
    '[[ "$REVOKE_REVEAL" == \'409\' ]]\n',
    'plan031_checkpoint "revoke_reveal_http" "$REVOKE_REVEAL"\n[[ "$REVOKE_REVEAL" == \'409\' ]]\n',
)

replace_once(
    '[[ "$(jq -r \'.[0].results[0].n\' <<<"$REVOKE_RECOVERY")" == \'0\' ]]\n',
    'REVOKE_RECOVERY_COUNT="$(jq -r \'.[0].results[0].n\' <<<"$REVOKE_RECOVERY")"\nplan031_checkpoint "revoke_recovery_rows" "$REVOKE_RECOVERY_COUNT"\n[[ "$REVOKE_RECOVERY_COUNT" == \'0\' ]]\n',
)

replace_once(
    '[[ "$CLOSE" == \'200\' ]]\n',
    'plan031_checkpoint "close_http" "$CLOSE"\n[[ "$CLOSE" == \'200\' ]]\n',
)

replace_once(
    '[[ "$(jq -r \'.[0].results[0].n\' <<<"$CLOSE_RECOVERY")" == \'0\' ]]\n',
    'CLOSE_RECOVERY_COUNT="$(jq -r \'.[0].results[0].n\' <<<"$CLOSE_RECOVERY")"\nplan031_checkpoint "close_recovery_rows" "$CLOSE_RECOVERY_COUNT"\n[[ "$CLOSE_RECOVERY_COUNT" == \'0\' ]]\n',
)

replace_once(
    '''npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --command "UPDATE field_groups SET hard_expires_at='2000-01-01T00:00:00.000Z' WHERE id='$EXPIRY_GROUP_ID' AND campaign_id='$PLAN031_CAMPAIGN_ID';" >/dev/null
''',
    '''plan031_checkpoint "expiry_force_start"
npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --command "UPDATE field_groups SET hard_expires_at='2000-01-01T00:00:00.000Z' WHERE id='$EXPIRY_GROUP_ID' AND campaign_id='$PLAN031_CAMPAIGN_ID';" >/dev/null
EXPIRY_FORCED_DB="$(npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command "SELECT hard_expires_at FROM field_groups WHERE id='$EXPIRY_GROUP_ID' AND campaign_id='$PLAN031_CAMPAIGN_ID';")"
EXPIRY_FORCED_VALUE="$(jq -r '.[0].results[0].hard_expires_at // "missing"' <<<"$EXPIRY_FORCED_DB")"
plan031_checkpoint "expiry_force_done" "$EXPIRY_FORCED_VALUE"
[[ "$EXPIRY_FORCED_VALUE" == '2000-01-01T00:00:00.000Z' ]]
''',
)

replace_once(
    '[[ "$EXPIRY_TRIGGER" == \'200\' ]]\n',
    '''plan031_checkpoint "expiry_trigger_http" "$EXPIRY_TRIGGER"
[[ "$EXPIRY_TRIGGER" == '200' ]]
EXPIRY_POLL_STATE='active'
EXPIRY_POLL_RECOVERY='2'
for expiry_attempt in $(seq 1 15); do
  EXPIRY_POLL_DB="$(npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command "SELECT state,(SELECT COUNT(*) FROM field_group_recoverable_credentials r WHERE r.campaign_id='$PLAN031_CAMPAIGN_ID' AND r.group_id='$EXPIRY_GROUP_ID') AS recovery_count FROM field_groups WHERE id='$EXPIRY_GROUP_ID' AND campaign_id='$PLAN031_CAMPAIGN_ID';")"
  EXPIRY_POLL_STATE="$(jq -r '.[0].results[0].state // "missing"' <<<"$EXPIRY_POLL_DB")"
  EXPIRY_POLL_RECOVERY="$(jq -r '.[0].results[0].recovery_count // "missing"' <<<"$EXPIRY_POLL_DB")"
  plan031_checkpoint "expiry_poll_${expiry_attempt}" "state=${EXPIRY_POLL_STATE};recovery=${EXPIRY_POLL_RECOVERY}"
  if [[ "$EXPIRY_POLL_STATE" == 'expired' && "$EXPIRY_POLL_RECOVERY" == '0' ]]; then
    break
  fi
  [[ "$expiry_attempt" == '15' ]] && break
  sleep 2
  EXPIRY_TRIGGER="$(curl -sS -o "$PRIVATE/expiry-trigger.json" -w '%{http_code}' -b "$PRIVATE/cookies.txt" "$TEST_URL/api/campaigns/${PLAN031_CAMPAIGN_ID}/field-groups" || printf 000)"
  plan031_checkpoint "expiry_retry_http_${expiry_attempt}" "$EXPIRY_TRIGGER"
  [[ "$EXPIRY_TRIGGER" == '200' ]]
done
''',
)

replace_once(
    '''[[ "$(jq -r '.[0].results[0].state' <<<"$EXPIRY_STATE")" == 'expired' ]]
[[ "$(jq -r '.[0].results[0].recovery_count' <<<"$EXPIRY_STATE")" == '0' ]]
''',
    '''EXPIRY_FINAL_STATE="$(jq -r '.[0].results[0].state' <<<"$EXPIRY_STATE")"
EXPIRY_RECOVERY_COUNT="$(jq -r '.[0].results[0].recovery_count' <<<"$EXPIRY_STATE")"
plan031_checkpoint "expiry_db_state" "state=${EXPIRY_FINAL_STATE};recovery=${EXPIRY_RECOVERY_COUNT}"
[[ "$EXPIRY_FINAL_STATE" == 'expired' ]]
[[ "$EXPIRY_RECOVERY_COUNT" == '0' ]]
''',
)

path.write_text(source, encoding='utf-8')
