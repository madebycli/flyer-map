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

path.write_text(source, encoding='utf-8')
