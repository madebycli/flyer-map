//! Turning a password into something to store. PBKDF2-HMAC-SHA256 with a per-password salt; the stored text carries its own iteration count, so
//! the count can be raised later and old hashes still verify. In the Worker the work is done by the platform's WebCrypto (native speed); the
//! software version here serves tests and tools.
use crate::config::Config;
use flyermap_identity::{b64, token::constant_time_eq};
use std::{future::Future, pin::Pin};

pub type Derived<'a> = Pin<Box<dyn Future<Output = Vec<u8>> + 'a>>;

pub trait Kdf {
    fn derive<'a>(&'a self, password: &'a [u8], salt: &'a [u8], iterations: u32) -> Derived<'a>;
}

/// Pure-Rust PBKDF2 (tests, tools, native hosts).
pub struct SoftKdf;

impl Kdf for SoftKdf {
    fn derive<'a>(&'a self, password: &'a [u8], salt: &'a [u8], iterations: u32) -> Derived<'a> {
        Box::pin(async move {
            let mut out = vec![0u8; 32];
            pbkdf2::pbkdf2_hmac::<sha2::Sha256>(password, salt, iterations, &mut out);
            out
        })
    }
}

const PREFIX: &str = "pbkdf2-sha256";

/// `pbkdf2-sha256$<iterations>$<salt>$<hash>` for a new password.
pub async fn hash_password(kdf: &dyn Kdf, config: &Config, password: &str, salt: &[u8; 16]) -> String {
    let derived = kdf.derive(password.as_bytes(), salt, config.kdf_iterations).await;
    format!("{PREFIX}${}${}${}", config.kdf_iterations, b64::encode(salt), b64::encode(&derived))
}

/// Does the password fit the stored text? A text of an unknown form never verifies (but still costs one derivation, so timing says nothing).
pub async fn verify_password(kdf: &dyn Kdf, config: &Config, password: &str, stored: &str) -> bool {
    let parts: Vec<&str> = stored.split('$').collect();
    let parsed = match parts.as_slice() {
        [PREFIX, iterations, salt, hash] => {
            iterations.parse::<u32>().ok().filter(|i| (1..=10_000_000).contains(i)).zip(b64::decode(salt)).zip(b64::decode(hash))
        }
        _ => None,
    };
    match parsed {
        Some(((iterations, salt), hash)) => constant_time_eq(&kdf.derive(password.as_bytes(), &salt, iterations).await, &hash),
        None => {
            let _ = kdf.derive(password.as_bytes(), &[0; 16], config.kdf_iterations).await;
            false
        }
    }
}

/// For a handle that does not exist: the same work as a real check.
pub async fn waste_time(kdf: &dyn Kdf, config: &Config, password: &str) {
    let _ = kdf.derive(password.as_bytes(), &[0; 16], config.kdf_iterations).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> Config {
        Config::from_vars(&flyermap_host::platform::vars_from(vec![("KDF_ITERATIONS".into(), "1000".into())]))
    }

    #[test]
    fn hash_and_verify() {
        futures::executor::block_on(async {
            let (c, kdf) = (config(), SoftKdf);
            let stored = hash_password(&kdf, &c, "correct horse", &[3; 16]).await;
            assert!(stored.starts_with("pbkdf2-sha256$1000$"));
            assert!(verify_password(&kdf, &c, "correct horse", &stored).await);
            assert!(!verify_password(&kdf, &c, "correct horsf", &stored).await);
            assert!(!verify_password(&kdf, &c, "x", "garbage").await);
            assert!(!verify_password(&kdf, &c, "x", "pbkdf2-sha256$0$AA$AA").await);
            // a hash made with fewer iterations still verifies after the setting is raised
            let later = Config { kdf_iterations: 5000, ..c.clone() };
            assert!(verify_password(&kdf, &later, "correct horse", &stored).await);
        });
    }
}
