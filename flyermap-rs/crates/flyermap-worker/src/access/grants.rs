//! Sessions for a grant: the cookie a device keeps after opening a link, joining a room or signing in.
use super::{cookies::SESSION_COOKIE, hash::hash_secret};
use crate::{
    app::Options,
    db::{stmt, Db, DbError},
    params,
    time::iso,
};

pub const SESSION_SECONDS: u64 = 60 * 60 * 24 * 30;

/// `vf_session=…; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=…`
pub fn session_cookie(secret: &str, max_age_seconds: u64) -> String {
    let encoded: String = percent_encoding::utf8_percent_encode(secret, percent_encoding::NON_ALPHANUMERIC).to_string();
    let encoded = encoded
        .replace("%2D", "-")
        .replace("%5F", "_")
        .replace("%2E", ".")
        .replace("%21", "!")
        .replace("%7E", "~")
        .replace("%2A", "*")
        .replace("%27", "'")
        .replace("%28", "(")
        .replace("%29", ")");
    format!("{SESSION_COOKIE}={encoded}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age={max_age_seconds}")
}

/// A new session for a grant; returns the secret for the cookie.
pub async fn create_session<D: Db>(db: &D, options: &Options, grant_id: &str, campaign_id: &str, ttl_seconds: u64) -> Result<String, DbError> {
    let secret = options.secret();
    let now = (options.now)();
    let changes = db
        .batch(&[stmt(
            "INSERT INTO campaign_sessions
          (id, grant_id, campaign_id, session_hash, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)",
            params![format!("session_{}", options.uuid()), grant_id, campaign_id, hash_secret(&secret), iso(now), iso(now + ttl_seconds * 1000)],
        )])
        .await?;
    if changes.first() != Some(&1) {
        return Err(DbError { message: "session_create_failed".into() });
    }
    Ok(secret)
}

#[cfg(test)]
mod tests {
    #[test]
    fn cookie_like_encode_uri_component() {
        assert_eq!(super::session_cookie("a-b_c+d/e", 60), "vf_session=a-b_c%2Bd%2Fe; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=60");
    }
}
