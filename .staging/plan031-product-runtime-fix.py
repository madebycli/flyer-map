from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


field_groups = Path("worker/fieldGroups.ts")
replace_once(
    field_groups,
    '''function canManageTeam(access: AccessContext, teamId: string) {
  return access.role === "admin" || (access.role === "team-editor" && access.teamId === teamId);
}
''',
    '''function canManageTeam(access: AccessContext, teamId: string) {
  return access.role === "admin" || (access.role === "team-editor" && access.teamId === teamId);
}

function persistedCampaignGrantId(access: AccessContext) {
  // Organization identities deliberately bridge into Campaign authorization without
  // manufacturing a legacy campaign_access_grants row. Persisting that synthetic
  // identity into created_by_grant_id would violate the table's real FK.
  return access.grantId.startsWith("organization:") ? null : access.grantId;
}
''',
)
replace_once(
    field_groups,
    '''          access.grantId,
          requestId,
          payloadHash,
''',
    '''          persistedCampaignGrantId(access),
          requestId,
          payloadHash,
''',
)
replace_once(
    field_groups,
    '''    if (route.kind === "reveal" && request.method === "GET") {
      return await revealCredentials(db, route.campaignId, route.groupId, access, env.FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY);
    }
''',
    '''    if (route.kind === "reveal" && request.method === "POST") {
      return await revealCredentials(db, route.campaignId, route.groupId, access, env.FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY);
    }
''',
)

recovery = Path("worker/fieldGroupCredentialRecovery.ts")
replace_once(
    recovery,
    '''    `field-group-credential:v1:${context.campaignId}:${context.groupId}:${context.credentialId}:${context.kind}`,
''',
    '''    `flyer-map:field-group-credential:v1:${context.campaignId}:${context.groupId}:${context.credentialId}:${context.kind}`,
''',
)

tests = Path("tests/fieldGroups.test.ts")
replace_once(
    tests,
    '''    if (query.includes("FROM campaign_sessions s")) {
      const campaignId = this.values[2] as string | null;
''',
    '''    if (query.includes("FROM campaign_sessions s")) {
      if (this.db.organizationMembershipId) return null;
      const campaignId = this.values[2] as string | null;
''',
)
replace_once(
    tests,
    '''    if (query.includes("SELECT id, name, color FROM teams")) {
''',
    '''    if (query.includes("FROM organization_account_sessions s") && query.includes("JOIN organization_memberships m")) {
      if (!this.db.organizationMembershipId) return null;
      return {
        membership_id: this.db.organizationMembershipId,
        campaign_id: "campaign_a",
        role_kind: "organizer",
        capabilities_json: "[]",
        template_capabilities_json: null,
      } as T;
    }

    if (query.includes("SELECT id, name, color FROM teams")) {
''',
)
replace_once(
    tests,
    '''  simulateMissingSchema = false;
  capturedValues: unknown[][] = [];
''',
    '''  simulateMissingSchema = false;
  organizationMembershipId: string | null = null;
  campaignGrantIds = new Set(["grant_admin", "grant_team-editor", "grant_viewer"]);
  capturedValues: unknown[][] = [];
''',
)
replace_once(
    tests,
    '''          participantCount,
          ,
          requestId,
''',
    '''          participantCount,
          createdByGrantId,
          requestId,
''',
)
replace_once(
    tests,
    '''          number | null,
          string,
          string,
          string,
          string,
          string,
          string,
        ];
        const team = this.teams.get(teamId)!;
''',
    '''          number | null,
          string | null,
          string,
          string,
          string,
          string,
          string,
        ];
        if (createdByGrantId !== null && !this.campaignGrantIds.has(createdByGrantId)) {
          throw new Error("D1_ERROR: FOREIGN KEY constraint failed: field_groups.created_by_grant_id");
        }
        const team = this.teams.get(teamId)!;
''',
)
anchor = '''test("create replay returns the original group without issuing secrets or duplicating state", async () => {
'''
insert = '''test("organization organizer room creation does not persist a synthetic campaign-grant foreign key", async () => {
  const db = new FieldGroupDb();
  db.organizationMembershipId = "membership_organizer";
  const response = await quietAudit(() =>
    handleFieldGroupApi(
      request(
        "/api/campaigns/campaign_a/field-groups",
        "POST",
        {
          label: "Organizer Room",
          teamId: "team_a",
          discoverable: false,
          requestId: "create-organizer-001",
        },
        { cookie: "__Host-vf_organization_session=organization-session" },
      ),
      { DB: db, FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY: TEST_RECOVERY_KEY },
    ),
  );
  assert.equal(response?.status, 201);
  const groupInsert = db.capturedValues.find((values) => values[0]?.toString().startsWith("field_group_"));
  assert.ok(groupInsert);
  assert.equal(groupInsert[7], null);
});

test("same-current credential reveal accepts POST and rejects legacy GET", async () => {
  const db = new FieldGroupDb();
  const created = await quietAudit(() =>
    handleFieldGroupApi(
      request("/api/campaigns/campaign_a/field-groups", "POST", {
        label: "Reveal Contract",
        teamId: "team_a",
        requestId: "create-reveal-contract-001",
      }),
      { DB: db, FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY: TEST_RECOVERY_KEY },
    ),
  );
  assert.equal(created?.status, 201);
  const groupId = (await created?.json()).group.id as string;
  const path = `/api/campaigns/campaign_a/field-groups/${groupId}/credentials/current`;

  const post = await handleFieldGroupApi(
    request(path, "POST"),
    { DB: db, FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY: TEST_RECOVERY_KEY },
  );
  assert.equal(post?.status, 409);
  assert.equal((await post?.json()).error.code, "credential_recovery_unavailable");

  const get = await handleFieldGroupApi(
    request(path, "GET"),
    { DB: db, FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY: TEST_RECOVERY_KEY },
  );
  assert.equal(get?.status, 405);
  assert.equal((await get?.json()).error.code, "method_not_allowed");
});

'''
text = tests.read_text(encoding="utf-8")
if text.count(anchor) != 1:
    raise SystemExit(f"{tests}: expected one insertion anchor, found {text.count(anchor)}")
tests.write_text(text.replace(anchor, insert + anchor, 1), encoding="utf-8")

recovery_test = Path("tests/fieldGroupCredentialRecovery.test.ts")
text = recovery_test.read_text(encoding="utf-8")
if "flyer-map:field-group-credential:v1" in text:
    raise SystemExit("unexpected AAD implementation text in test")
# Keep round-trip/tamper tests behavioral. The exact namespace is guarded by the
# source transform above and by staging's same-current reveal matrix.
