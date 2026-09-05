from pathlib import Path

path = Path('.staging/admin-v9-release.sh')
source = path.read_text(encoding='utf-8')

replacements = {
    '''REVEAL="$(curl -sS -o "$PRIVATE/browser-reveal.json" -w '%{http_code}' -b "$PRIVATE/cookies.txt" "$TEST_URL/api/campaigns/${PLAN031_CAMPAIGN_ID}/field-groups/${BROWSER_GROUP_ID}/credentials/current" || printf 000)"''':
    '''REVEAL="$(curl -sS -o "$PRIVATE/browser-reveal.json" -w '%{http_code}' -b "$PRIVATE/cookies.txt" -X POST "$TEST_URL/api/campaigns/${PLAN031_CAMPAIGN_ID}/field-groups/${BROWSER_GROUP_ID}/credentials/current" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' || printf 000)"''',
    '''REVEAL2="$(curl -sS -o "$PRIVATE/browser-reveal-rotated.json" -w '%{http_code}' -b "$PRIVATE/cookies.txt" "$TEST_URL/api/campaigns/${PLAN031_CAMPAIGN_ID}/field-groups/${BROWSER_GROUP_ID}/credentials/current" || printf 000)"''':
    '''REVEAL2="$(curl -sS -o "$PRIVATE/browser-reveal-rotated.json" -w '%{http_code}' -b "$PRIVATE/cookies.txt" -X POST "$TEST_URL/api/campaigns/${PLAN031_CAMPAIGN_ID}/field-groups/${BROWSER_GROUP_ID}/credentials/current" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' || printf 000)"''',
    '''REVOKE_REVEAL="$(curl -sS -o "$PRIVATE/revoke-reveal.json" -w '%{http_code}' -b "$PRIVATE/cookies.txt" "$TEST_URL/api/campaigns/${PLAN031_CAMPAIGN_ID}/field-groups/${REVOKE_GROUP_ID}/credentials/current" || printf 000)"''':
    '''REVOKE_REVEAL="$(curl -sS -o "$PRIVATE/revoke-reveal.json" -w '%{http_code}' -b "$PRIVATE/cookies.txt" -X POST "$TEST_URL/api/campaigns/${PLAN031_CAMPAIGN_ID}/field-groups/${REVOKE_GROUP_ID}/credentials/current" -H "Origin: $TEST_URL" -H 'Content-Type: application/json' || printf 000)"''',
}

for old, new in replacements.items():
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'expected exactly one reveal-method anchor, found {count}: {old[:120]!r}')
    source = source.replace(old, new, 1)

path.write_text(source, encoding='utf-8')
