import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import mainWorker from "../worker/indexOrganizer.ts";
import { isOrganizationAdminPath } from "../src/organization/organizationRoutes.ts";
import type { D1DatabaseLike, D1PreparedStatement, D1RunResult } from "../worker/campaignRepository.ts";

class Statement implements D1PreparedStatement {
  values: unknown[] = [];
  constructor(readonly query: string, private readonly sqlite: DatabaseSync) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>() { return (this.sqlite.prepare(this.query).get(...this.values) as T | undefined) ?? null; }
  async all<T>() { return { results: this.sqlite.prepare(this.query).all(...this.values) as T[] }; }
  run() { return this.sqlite.prepare(this.query).run(...this.values); }
}

class SharedD1 implements D1DatabaseLike {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    const migrations = new URL("../migrations/", import.meta.url);
    for (const name of readdirSync(migrations).filter(name => /^\d{4}_.+\.sql$/u.test(name)).sort()) {
      this.sqlite.exec(readFileSync(new URL(name, migrations), "utf8"));
    }
  }
  prepare(query: string) { return new Statement(query, this.sqlite); }
  async batch(statements: D1PreparedStatement[]) {
    this.sqlite.exec("BEGIN");
    try {
      const results = (statements as Statement[]).map<D1RunResult>(statement => {
        const result = statement.run();
        return { success: true, meta: { changes: Number(result.changes) } };
      });
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

async function hash(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function fixture() {
  const db = new SharedD1();
  const time = "2026-09-08T00:00:00.000Z";
  db.sqlite.prepare("INSERT INTO organizations(id,name,created_at,updated_at) VALUES('org_shared','Shared Organization',?,?)").run(time,time);
  db.sqlite.prepare("INSERT INTO organization_accounts(id,username,username_normalized,created_at,updated_at) VALUES('account_shared','master','master',?,?)").run(time,time);
  db.sqlite.prepare("INSERT INTO organization_memberships(id,organization_id,account_id,role_kind,capabilities_json,created_at,updated_at) VALUES('membership_shared','org_shared','account_shared','organizer','[]',?,?)").run(time,time);
  const sessions = { one: "session-origin-one", two: "session-origin-two" };
  for (const [origin, secret] of Object.entries(sessions)) {
    db.sqlite.prepare("INSERT INTO organization_account_sessions(id,account_id,session_hash,assurance,created_at,expires_at) VALUES(?, 'account_shared', ?, 'mfa', ?, ?)").run(`session_${origin}`,await hash(secret),time,"2030-01-01T00:00:00.000Z");
  }
  db.sqlite.prepare("INSERT INTO campaigns(id,name,status,revision,write_token,organization_id,admin_lifecycle_status,created_at,updated_at) VALUES('campaign_shared','Shared Campaign','active',1,'seed','org_shared','active',?,?)").run(time,time);
  db.sqlite.prepare("INSERT INTO teams(id,campaign_id,name,color,created_at,updated_at) VALUES('team_shared','campaign_shared','Team','#2563eb',?,?)").run(time,time);
  const area = JSON.stringify({type:"Polygon",coordinates:[[[13,51],[13.01,51],[13.01,51.01],[13,51.01],[13,51]]]});
  db.sqlite.prepare("INSERT INTO areas(id,campaign_id,team_id,name,geometry_json,created_at,updated_at) VALUES('area_shared','campaign_shared','team_shared','Area',?,?,?)").run(area,time,time);
  const road = JSON.stringify({type:"LineString",coordinates:[[13.001,51.005],[13.009,51.005]]});
  db.sqlite.prepare("INSERT INTO tasks(id,campaign_id,area_id,task_type,label,geometry_json,status,created_at,updated_at) VALUES('task_shared','campaign_shared','area_shared','street','Road',?,'open',?,?)").run(road,time,time);
  return { db, sessions, time };
}

const cookie = (secret: string) => `__Host-vf_organization_session=${secret}`;
const env = (DB: SharedD1) => ({ DB, ASSETS: { fetch: async () => new Response("<!doctype html><main>Organizer Login</main>",{headers:{"content-type":"text/html"}}) } }) as never;

function request(origin: string, path: string, secret?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (secret) headers.set("cookie",cookie(secret));
  return new Request(origin+path,{...init,headers});
}

async function snapshot(db:SharedD1,origin:string,secret:string) {
  const response=await mainWorker.fetch(request(origin,"/api/campaigns/campaign_shared/snapshot",secret),env(db));
  assert.equal(response.status,200,await response.clone().text());
  return response.json() as Promise<{campaign:{id:string};revision:number;tasks:Array<{id:string;status:string;updatedAt:string}>}>;
}

test("Main deployment serves Organizer login UI and recognizes auth routes instead of generic API fallthrough",async()=>{
  const {db}=await fixture();
  const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
  const entry=await readFile(new URL('../src/main.tsx',import.meta.url),'utf8');
  assert.equal(config.assets.not_found_handling,'single-page-application');
  assert.deepEqual(config.assets.run_worker_first,['/api/*','/']);
  assert.equal(isOrganizationAdminPath("/login"),true);
  assert.match(entry,/isOrganizationAdminPath\(window\.location\.pathname\)/u);
  const me=await mainWorker.fetch(request("https://one.flyer.test","/api/organization/me"),env(db));
  assert.equal(me.status,401);assert.equal(((await me.json()) as {error:{code:string}}).error.code,"authentication_required");
  const head=await mainWorker.fetch(request("https://one.flyer.test","/api/organization/me",undefined,{method:"HEAD"}),env(db));
  assert.equal(head.status,405);
  const password=await mainWorker.fetch(request("https://one.flyer.test","/api/organization/login/password",undefined,{method:"POST",headers:{origin:"https://one.flyer.test","content-type":"application/json"},body:JSON.stringify({username:"invalid",password:"invalid"})}),env(db));
  assert.notEqual(password.status,404);assert.notEqual(((await password.json()) as {error:{code:string}}).error.code,"api_route_not_found");
  const unknown=await mainWorker.fetch(request("https://one.flyer.test","/api/organization/does-not-exist"),env(db));
  assert.equal(unknown.status,404);assert.equal(((await unknown.json()) as {error:{code:string}}).error.code,"not_found");assert.match(unknown.headers.get("content-type")??"",/application\/json/u);
});

test("two origins with distinct sessions mutate one host-independent Campaign and Change Feed",async()=>{
  const {db,sessions,time}=await fixture();
  const one="https://one.flyer.test",two="https://two.flyer.test";
  const initialOne=await snapshot(db,one,sessions.one),initialTwo=await snapshot(db,two,sessions.two);
  assert.equal(initialOne.campaign.id,"campaign_shared");assert.deepEqual(initialTwo,initialOne);

  const mutate=async(origin:string,secret:string,id:string,status:"completed"|"later",baseRevision:number,expectedUpdatedAt:string,createdAt:string)=>mainWorker.fetch(request(origin,"/api/campaigns/campaign_shared/mutations",secret,{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({mutation:{id,campaignId:"campaign_shared",baseRevision,createdAt,type:"task.set-status",payload:{taskId:"task_shared",status,completedAt:status==="completed"?createdAt:null,expectedUpdatedAt}}})}),env(db));
  const fromOne=await mutate(one,sessions.one,"mutation_one","completed",1,time,"2026-09-08T00:01:00.000Z");
  assert.equal(fromOne.status,200,await fromOne.clone().text());
  const seenOnTwo=await snapshot(db,two,sessions.two);assert.equal(seenOnTwo.tasks[0].status,"completed");

  const foreignOrigin=await mutate(two,sessions.two,"mutation_foreign","later",seenOnTwo.revision,seenOnTwo.tasks[0].updatedAt,"2026-09-08T00:02:00.000Z");
  // A cookie for Origin B cannot authorize a write claiming Origin A.
  const forgedRequest=request(two,"/api/campaigns/campaign_shared/mutations",sessions.two,{method:"POST",headers:{origin:one,"content-type":"application/json"},body:"{}"});
  const forged=await mainWorker.fetch(forgedRequest,env(db));assert.equal(forged.status,403);
  assert.equal(foreignOrigin.status,200,await foreignOrigin.clone().text());
  const seenOnOne=await snapshot(db,one,sessions.one);assert.equal(seenOnOne.tasks[0].status,"later");
  assert.equal(seenOnOne.campaign.id,"campaign_shared");

  const checkpoints=await Promise.all([[one,sessions.one],[two,sessions.two]].map(async([origin,secret])=>{
    const response=await mainWorker.fetch(request(origin,"/api/campaigns/campaign_shared/rxdb/checkpoint",secret),env(db));
    assert.equal(response.status,200);return response.json();
  }));
  assert.deepEqual(checkpoints[0],checkpoints[1]);
  assert.equal(db.sqlite.prepare("SELECT count(DISTINCT campaign_id) n FROM campaign_sync_changes").get()!.n,1);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM campaigns WHERE id='campaign_shared'").get()!.n,1);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM organization_account_sessions WHERE account_id='account_shared'").get()!.n,2);
});
