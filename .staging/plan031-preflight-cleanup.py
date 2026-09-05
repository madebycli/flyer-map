from pathlib import Path

path = Path('.staging/admin-v9-release.sh')
source = path.read_text(encoding='utf-8')

owned_campaign_cleanup = """DELETE FROM domain_events WHERE campaign_id IN (SELECT id FROM campaigns WHERE organization_id IS NOT NULL); DELETE FROM comments WHERE campaign_id IN (SELECT id FROM campaigns WHERE organization_id IS NOT NULL); DELETE FROM field_sessions WHERE campaign_id IN (SELECT id FROM campaigns WHERE organization_id IS NOT NULL); DELETE FROM field_group_recoverable_credentials WHERE campaign_id IN (SELECT id FROM campaigns WHERE organization_id IS NOT NULL); DELETE FROM field_group_join_credentials WHERE campaign_id IN (SELECT id FROM campaigns WHERE organization_id IS NOT NULL); DELETE FROM field_group_memberships WHERE campaign_id IN (SELECT id FROM campaigns WHERE organization_id IS NOT NULL); DELETE FROM field_groups WHERE campaign_id IN (SELECT id FROM campaigns WHERE organization_id IS NOT NULL); DELETE FROM house_tasks WHERE campaign_id IN (SELECT id FROM campaigns WHERE organization_id IS NOT NULL); DELETE FROM tasks WHERE campaign_id IN (SELECT id FROM campaigns WHERE organization_id IS NOT NULL); DELETE FROM areas WHERE campaign_id IN (SELECT id FROM campaigns WHERE organization_id IS NOT NULL); DELETE FROM campaigns WHERE organization_id IS NOT NULL;"""

old_exit = '''  npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote \\
    --command "DELETE FROM campaigns WHERE organization_id IS NOT NULL; DELETE FROM organization_bootstrap_state; DELETE FROM organizations; DELETE FROM organization_accounts; DELETE FROM organization_login_throttles;" >/dev/null 2>&1
'''
new_exit = f'''  npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote \\
    --command "{owned_campaign_cleanup} DELETE FROM organization_bootstrap_state; DELETE FROM organizations; DELETE FROM organization_accounts; DELETE FROM organization_login_throttles;" >/dev/null 2>&1
'''
if source.count(old_exit) != 1:
    raise SystemExit(f'expected one exit cleanup anchor, found {source.count(old_exit)}')
source = source.replace(old_exit, new_exit, 1)

old_preflight = '''CLEANUP_READY=1
npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command 'PRAGMA foreign_key_check;' > "$OUT/fk-before.json"
'''
new_preflight = f'''CLEANUP_READY=1
# This D1 is dedicated to organizer-admin staging. Failed historical runs can leave
# organizer fixtures behind. Remove team-referencing children before their campaign,
# because several schema edges intentionally use ON DELETE RESTRICT for team scope.
npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote \\
  --command "{owned_campaign_cleanup} DELETE FROM organization_bootstrap_state; DELETE FROM organizations; DELETE FROM organization_accounts; DELETE FROM organization_login_throttles;" >/dev/null
jq -n '{{ok:true,order:"children-before-campaign"}}' > "$OUT/plan031-preflight-cleanup.json"
npx wrangler d1 execute "$ADMIN_DB_NAME" --env admin_staging --config wrangler.jsonc --remote --json --command 'PRAGMA foreign_key_check;' > "$OUT/fk-before.json"
'''
if source.count(old_preflight) != 1:
    raise SystemExit(f'expected one preflight cleanup anchor, found {source.count(old_preflight)}')
source = source.replace(old_preflight, new_preflight, 1)

path.write_text(source, encoding='utf-8')
