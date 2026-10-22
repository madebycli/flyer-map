//! The caller of a request: the person behind the session token, and all their grants, loaded once.
use crate::{
    directory::{
        grants,
        persons::{self, Person},
        sessions::{self, Session},
    },
    env::Env,
    error::Done,
};
use flyermap_host::{db::Db, http::request::Request};
use flyermap_identity::{token, AccessSet};

pub const COOKIE: &str = "__Host-fm";

pub struct Caller {
    pub person: Person,
    pub session: Session,
    pub access: AccessSet,
}

/// The token from the cookie, or from `Authorization: Bearer` (apps and tools that are not a browser).
pub fn token_of(request: &Request) -> Option<String> {
    let from_cookie = request
        .header("cookie")
        .and_then(|c| c.split(';').filter_map(|p| p.trim().split_once('=')).find(|(name, _)| *name == COOKIE).map(|(_, v)| v.to_string()));
    from_cookie
        .or_else(|| request.header("authorization").and_then(|a| a.strip_prefix("Bearer ")).map(|t| t.trim().to_string()))
        .filter(|t| token::looks_like_token(t))
}

/// `__Host-fm=…; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=…`
pub fn cookie(token: &str, max_age_seconds: u64) -> String {
    format!("{COOKIE}={token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age={max_age_seconds}")
}

pub fn clearing_cookie() -> String {
    format!("{COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0")
}

/// All live grants of a person as the rights code takes them. Rows that are not grants (hand-edited) are skipped, never widened.
pub async fn access_of<D: Db>(db: &D, person_id: &str, now: u64) -> Done<AccessSet> {
    Ok(AccessSet::new(grants::live_rows(db, person_id, now).await?.iter().filter_map(|row| row.grant()).collect()))
}

/// `None` without a valid session (no token, unknown, revoked, expired, person disabled). Keeps the session alive while it is used.
pub async fn resolve<D: Db>(db: &D, env: &Env, request: &Request) -> Done<Option<Caller>> {
    let Some(token) = token_of(request) else { return Ok(None) };
    let now = env.now();
    let Some(session) = sessions::live_by_token(db, &token::hash_token(&token), now).await? else { return Ok(None) };
    let Some(person) = persons::get(db, &session.person_id).await? else { return Ok(None) };
    sessions::touch(db, &session.id, now, env.config.session_days * 86_400_000).await?;
    let access = access_of(db, &person.id, now).await?;
    Ok(Some(Caller { person, session, access }))
}
