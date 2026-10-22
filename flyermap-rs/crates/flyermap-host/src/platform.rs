//! What the Worker needs from the platform besides the database and outgoing requests, behind plain functions so that every handler runs
//! natively in tests: deployment variables and secrets, and the rate limiters.
use std::{future::Future, pin::Pin};

/// A deployment variable or secret by name (`None` when unset).
pub type Vars = Box<dyn Fn(&str) -> Option<String>>;

/// `limit(binding, key)`: may this key go on now? A missing limiter lets everything through (as an unbound limiter does in TypeScript).
pub type Limiter = Box<dyn Fn(&str, &str) -> Pin<Box<dyn Future<Output = bool>>>>;

pub fn no_vars() -> Vars {
    Box::new(|_| None)
}

pub fn unlimited() -> Limiter {
    Box::new(|_, _| Box::pin(async { true }))
}

/// Variables from a fixed list (tests and tools).
pub fn vars_from(pairs: Vec<(String, String)>) -> Vars {
    Box::new(move |name| pairs.iter().find(|(n, _)| n == name).map(|(_, v)| v.clone()))
}

#[cfg(target_arch = "wasm32")]
pub fn env_vars(env: worker::Env) -> Vars {
    Box::new(move |name| env.var(name).map(|v| v.to_string()).or_else(|_| env.secret(name).map(|s| s.to_string())).ok())
}

#[cfg(target_arch = "wasm32")]
pub fn env_limiter(env: worker::Env) -> Limiter {
    Box::new(move |binding, key| {
        let limiter = env.rate_limiter(binding).ok();
        let key = key.to_string();
        Box::pin(async move {
            match limiter {
                Some(l) => l.limit(key).await.map_or(true, |o| o.success),
                None => true,
            }
        })
    })
}
