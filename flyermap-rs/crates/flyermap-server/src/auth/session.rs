//! Opening a session for a person, whichever way they proved who they are.
use super::caller::cookie;
use crate::{
    directory::sessions::{self, Session},
    env::Env,
    error::Done,
};
use flyermap_host::db::Db;
use flyermap_identity::token;

/// The new session and the `Set-Cookie` value that carries its token.
pub struct Opened {
    pub session: Session,
    pub set_cookie: String,
}

pub async fn open<D: Db>(db: &D, env: &Env, person_id: &str, via: &str, label: &str) -> Done<Opened> {
    let now = env.now();
    let ttl_ms = env.config.session_days * 86_400_000;
    let secret = token::new_token(&(env.random)());
    let session = Session {
        id: env.id("s"),
        person_id: person_id.to_string(),
        label: crate::directory::persons::clean_name(label, "Gerät"),
        via: via.to_string(),
        created_at: now,
        last_seen_at: now,
        expires_at: now + ttl_ms,
        revoked_at: None,
    };
    sessions::insert(db, &session, &token::hash_token(&secret)).await?;
    Ok(Opened { session, set_cookie: cookie(&secret, ttl_ms / 1000) })
}
