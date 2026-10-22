//! Everything the server takes from its surroundings, so that a request can be run natively in a test as well as in the Worker.
use crate::{config::Config, kdf::Kdf};
use flyermap_host::{
    platform::{Limiter, Vars},
    rand::{base64url, uuid_v4},
};

pub struct Env {
    /// Milliseconds since the epoch.
    pub now: Box<dyn Fn() -> u64>,
    /// 32 fresh random bytes per call (the platform's CSPRNG; in tests a counter).
    pub random: Box<dyn Fn() -> [u8; 32]>,
    /// Where log lines go.
    pub log: Box<dyn Fn(&str)>,
    /// A request id when the client sent none.
    pub new_id: Box<dyn Fn() -> String>,
    pub limit: Limiter,
    pub kdf: Box<dyn Kdf>,
    pub config: Config,
}

impl Env {
    pub fn new(
        now: Box<dyn Fn() -> u64>,
        random: Box<dyn Fn() -> [u8; 32]>,
        log: Box<dyn Fn(&str)>,
        new_id: Box<dyn Fn() -> String>,
        limit: Limiter,
        kdf: Box<dyn Kdf>,
        vars: &Vars,
    ) -> Env {
        Env { now, random, log, new_id, limit, kdf, config: Config::from_vars(vars) }
    }

    pub fn now(&self) -> u64 {
        (self.now)()
    }

    /// `N` random bytes (several draws when N is more than 32).
    pub fn bytes<const N: usize>(&self) -> [u8; N] {
        let mut out = [0u8; N];
        for chunk in out.chunks_mut(32) {
            chunk.copy_from_slice(&(self.random)()[..chunk.len()]);
        }
        out
    }

    /// An opaque id with a readable prefix: `p_0c1d…`.
    pub fn id(&self, prefix: &str) -> String {
        format!("{prefix}_{}", uuid_v4(&(self.random)()))
    }

    /// 43 characters of base64url; for challenges and the like.
    pub fn secret(&self) -> String {
        base64url(&(self.random)())
    }
}
