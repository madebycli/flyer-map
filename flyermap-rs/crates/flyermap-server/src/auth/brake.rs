//! The brake against guessing, in front of every secret that can be tried: sign-in names, invitation codes, recovery codes. Keys are hashed
//! so the table does not hold addresses or names.
use crate::{
    directory::throttle,
    env::Env,
    error::{fail, Code, Done},
};
use flyermap_host::{db::Db, http::request::Request};
use flyermap_identity::token::hash_token;

/// A key for the caller's address (as far as the platform tells it).
pub fn address_key(request: &Request, what: &str) -> String {
    let address = request.header("cf-connecting-ip").or_else(|| request.header("x-forwarded-for")).unwrap_or("-");
    key(what, address)
}

pub fn key(what: &str, subject: &str) -> String {
    format!("{what}:{}", &hash_token(&format!("{what}|{subject}"))[..32])
}

/// Refuses while any of the keys is locked.
pub async fn check<D: Db>(db: &D, env: &Env, keys: &[String]) -> Done<()> {
    let now = env.now();
    for k in keys {
        if throttle::locked_until(db, k, now).await?.is_some() {
            return Err(fail(Code::RateLimited, "too many attempts"));
        }
    }
    Ok(())
}

pub async fn failed<D: Db>(db: &D, env: &Env, keys: &[String]) -> Done<()> {
    for k in keys {
        throttle::failed(db, k, env.now()).await?;
    }
    Ok(())
}

pub async fn succeeded<D: Db>(db: &D, keys: &[String]) -> Done<()> {
    for k in keys {
        throttle::clear(db, k).await?;
    }
    Ok(())
}
