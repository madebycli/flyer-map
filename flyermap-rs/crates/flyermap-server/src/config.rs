//! Deployment settings, read once from the variables.
use flyermap_host::platform::Vars;

#[derive(Clone, Debug)]
pub struct Config {
    /// The host name passkeys belong to.
    pub rp_id: String,
    /// Origins that may call the API with cookies and that passkeys may come from.
    pub origins: Vec<String>,
    /// PBKDF2-HMAC-SHA256 iterations for new passwords.
    pub kdf_iterations: u32,
    /// How long a session lasts without being used again.
    pub session_days: u64,
    /// Anyone may create an Organisation (otherwise only with the setup key).
    pub open_signup: bool,
    /// SHA-256 (hex) of the owner's setup key.
    pub setup_key_sha256: Option<String>,
    /// 32 bytes (base64url) that seal TOTP secrets.
    pub seal_key: Option<String>,
}

impl Config {
    pub fn from_vars(vars: &Vars) -> Config {
        let get = |name: &str| vars(name).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        Config {
            rp_id: get("RP_ID").unwrap_or_else(|| "localhost".into()),
            origins: get("ORIGINS").map(|o| o.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()).unwrap_or_default(),
            kdf_iterations: get("KDF_ITERATIONS").and_then(|v| v.parse().ok()).unwrap_or(310_000),
            session_days: get("SESSION_DAYS").and_then(|v| v.parse().ok()).unwrap_or(30),
            open_signup: get("OPEN_SIGNUP").as_deref() == Some("1"),
            setup_key_sha256: get("SETUP_KEY_SHA256"),
            seal_key: get("SEAL_KEY"),
        }
    }
}
