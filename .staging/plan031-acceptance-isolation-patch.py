from pathlib import Path

path = Path('.staging/admin-v9-release.sh')
source = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'expected exactly one isolation anchor, found {count}: {old[:120]!r}')
    source = source.replace(old, new, 1)


replace_once(
    "ADMIN_DB_NAME='flyer-map-admin-staging-db'\nADMIN_WORKER_NAME='flyer-map-admin-staging'\n",
    "ADMIN_DB_NAME='flyer-map-admin-acceptance-db'\nADMIN_WORKER_NAME='flyer-map-admin-acceptance'\nPERSISTENT_ADMIN_DB_NAME='flyer-map-admin-staging-db'\n",
)

replace_once(
    '''LIST_JSON="$(npx wrangler d1 list --json)"
ADMIN_D1_ID="$(jq -r --arg name "$ADMIN_DB_NAME" '[.[]|select(.name==$name)]|if length==1 then .[0].uuid else empty end' <<<"$LIST_JSON")"
[[ -n "$ADMIN_D1_ID" ]] || { echo 'Admin D1 missing or ambiguous.' >&2; exit 1; }
[[ "$ADMIN_D1_ID" != "$PROD_D1_ID" && "$ADMIN_D1_ID" != "$RXDB_STAGING_D1_ID" ]] || { echo 'Protected D1 collision.' >&2; exit 1; }
export ADMIN_D1_ID ADMIN_DB_NAME ADMIN_WORKER_NAME PROD_D1_ID RXDB_STAGING_D1_ID
''',
    '''LIST_JSON="$(npx wrangler d1 list --json)"
PERSISTENT_ADMIN_D1_ID="$(jq -r --arg name "$PERSISTENT_ADMIN_DB_NAME" '[.[]|select(.name==$name)]|if length==1 then .[0].uuid else empty end' <<<"$LIST_JSON")"
[[ -n "$PERSISTENT_ADMIN_D1_ID" ]] || { echo 'Persistent Admin Staging D1 missing or ambiguous.' >&2; exit 1; }
ADMIN_D1_ID="$(jq -r --arg name "$ADMIN_DB_NAME" '[.[]|select(.name==$name)]|if length==1 then .[0].uuid else empty end' <<<"$LIST_JSON")"
if [[ -z "$ADMIN_D1_ID" ]]; then
  npx wrangler d1 create "$ADMIN_DB_NAME" >/dev/null
  LIST_JSON="$(npx wrangler d1 list --json)"
  ADMIN_D1_ID="$(jq -r --arg name "$ADMIN_DB_NAME" '[.[]|select(.name==$name)]|if length==1 then .[0].uuid else empty end' <<<"$LIST_JSON")"
fi
[[ -n "$ADMIN_D1_ID" ]] || { echo 'Acceptance D1 missing or ambiguous after create.' >&2; exit 1; }
[[ "$ADMIN_D1_ID" != "$PROD_D1_ID" && "$ADMIN_D1_ID" != "$RXDB_STAGING_D1_ID" && "$ADMIN_D1_ID" != "$PERSISTENT_ADMIN_D1_ID" ]] || { echo 'Protected D1 collision.' >&2; exit 1; }
export ADMIN_D1_ID ADMIN_DB_NAME ADMIN_WORKER_NAME PROD_D1_ID RXDB_STAGING_D1_ID PERSISTENT_ADMIN_D1_ID PERSISTENT_ADMIN_DB_NAME
''',
)

path.write_text(source, encoding='utf-8')
