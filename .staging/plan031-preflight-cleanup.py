from pathlib import Path

path = Path('.staging/admin-v9-release.sh')
source = path.read_text(encoding='utf-8')
old = '''CLEANUP_READY=1
npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command 'PRAGMA foreign_key_check;' > "$OUT/fk-before.json"
'''
new = '''CLEANUP_READY=1
# This D1 is dedicated to organizer-admin staging. Failed historical runs may have
# exited before the old pristine-state guard enabled its trap, so clear only the
# isolated organizer fixtures before asserting an empty starting state.
npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote \\
  --command "DELETE FROM campaigns WHERE organization_id IS NOT NULL; DELETE FROM organization_bootstrap_state; DELETE FROM organizations; DELETE FROM organization_accounts; DELETE FROM organization_login_throttles;" >/dev/null
npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command 'PRAGMA foreign_key_check;' > "$OUT/fk-before.json"
'''
count = source.count(old)
if count != 1:
    raise SystemExit(f'expected one preflight cleanup anchor, found {count}')
path.write_text(source.replace(old, new, 1), encoding='utf-8')
