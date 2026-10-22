//! How a person proves who they are: password, passkeys, TOTP, recovery codes.
use flyermap_host::{
    db::{decode, decode_one, stmt, Db, DbError, Stmt},
    params,
};
use serde::Deserialize;

// ---------- password ----------

pub async fn password_hash<D: Db>(db: &D, person_id: &str) -> Result<Option<String>, DbError> {
    #[derive(Deserialize)]
    struct H {
        hash: String,
    }
    Ok(decode_one::<H>(db.first(&stmt("SELECT hash FROM passwords WHERE person_id = ?", params![person_id])).await?)?.map(|h| h.hash))
}

pub fn set_password_stmt(person_id: &str, hash: &str, now: u64) -> Stmt {
    let sql = "INSERT INTO passwords (person_id, hash, changed_at) VALUES (?, ?, ?) ON CONFLICT(person_id) DO UPDATE SET hash = excluded.hash, changed_at = excluded.changed_at";
    stmt(sql, params![person_id, hash, now])
}

pub async fn set_password<D: Db>(db: &D, person_id: &str, hash: &str, now: u64) -> Result<(), DbError> {
    db.batch(&[set_password_stmt(person_id, hash, now)]).await.map(|_| ())
}

// ---------- passkeys ----------

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct PasskeyRow {
    pub id: String,
    pub person_id: String,
    pub credential_id: String,
    pub public_key: String,
    pub sign_count: u32,
    pub label: String,
    pub created_at: u64,
    pub last_used_at: Option<u64>,
}

const PASSKEY: &str = "id, person_id, credential_id, public_key, sign_count, label, created_at, last_used_at";

pub async fn passkey_by_credential<D: Db>(db: &D, credential_id: &str) -> Result<Option<PasskeyRow>, DbError> {
    decode_one(db.first(&stmt(format!("SELECT {PASSKEY} FROM passkeys WHERE credential_id = ?"), params![credential_id])).await?)
}

pub async fn passkeys_of<D: Db>(db: &D, person_id: &str) -> Result<Vec<PasskeyRow>, DbError> {
    decode(db.all(&stmt(format!("SELECT {PASSKEY} FROM passkeys WHERE person_id = ? ORDER BY created_at, id"), params![person_id])).await?)
}

/// `Ok(false)` when this credential is registered already.
pub async fn add_passkey<D: Db>(db: &D, row: &PasskeyRow) -> Result<bool, DbError> {
    let sql = "INSERT INTO passkeys (id, person_id, credential_id, public_key, sign_count, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)";
    let p = params![
        row.id.as_str(),
        row.person_id.as_str(),
        row.credential_id.as_str(),
        row.public_key.as_str(),
        row.sign_count,
        row.label.as_str(),
        row.created_at
    ];
    match db.batch(&[stmt(sql, p)]).await {
        Ok(_) => Ok(true),
        Err(e) if e.message.to_lowercase().contains("unique") => Ok(false),
        Err(e) => Err(e),
    }
}

pub async fn passkey_used<D: Db>(db: &D, id: &str, sign_count: u32, now: u64) -> Result<(), DbError> {
    db.batch(&[stmt("UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE id = ?", params![sign_count, now, id])]).await.map(|_| ())
}

pub async fn remove_passkey<D: Db>(db: &D, person_id: &str, id: &str) -> Result<bool, DbError> {
    Ok(db.batch(&[stmt("DELETE FROM passkeys WHERE id = ? AND person_id = ?", params![id, person_id])]).await?.first() == Some(&1))
}

// ---------- TOTP ----------

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct TotpRow {
    pub secret_sealed: String,
    pub confirmed_at: Option<u64>,
    pub last_step: Option<u64>,
}

pub async fn totp_of<D: Db>(db: &D, person_id: &str) -> Result<Option<TotpRow>, DbError> {
    decode_one(db.first(&stmt("SELECT secret_sealed, confirmed_at, last_step FROM totp WHERE person_id = ?", params![person_id])).await?)
}

/// A new, not yet confirmed secret replaces any unconfirmed one; a confirmed one is never replaced this way.
pub async fn start_totp<D: Db>(db: &D, person_id: &str, sealed: &str) -> Result<bool, DbError> {
    let sql = "INSERT INTO totp (person_id, secret_sealed) VALUES (?, ?) ON CONFLICT(person_id) DO UPDATE SET secret_sealed = excluded.secret_sealed WHERE totp.confirmed_at IS NULL";
    Ok(db.batch(&[stmt(sql, params![person_id, sealed])]).await?.first() == Some(&1))
}

pub async fn confirm_totp<D: Db>(db: &D, person_id: &str, step: u64, now: u64) -> Result<(), DbError> {
    db.batch(&[stmt("UPDATE totp SET confirmed_at = ?, last_step = ? WHERE person_id = ?", params![now, step, person_id])]).await.map(|_| ())
}

/// Remembers the step so that the code cannot be used again; `false` when another request used a step at or after it first.
pub async fn use_totp_step<D: Db>(db: &D, person_id: &str, step: u64) -> Result<bool, DbError> {
    let sql = "UPDATE totp SET last_step = ? WHERE person_id = ? AND (last_step IS NULL OR last_step < ?)";
    Ok(db.batch(&[stmt(sql, params![step, person_id, step])]).await?.first() == Some(&1))
}

pub async fn remove_totp<D: Db>(db: &D, person_id: &str) -> Result<(), DbError> {
    db.batch(&[stmt("DELETE FROM totp WHERE person_id = ?", params![person_id])]).await.map(|_| ())
}

// ---------- recovery codes ----------

/// Replaces all codes of the person with these hashes.
pub async fn replace_recovery_codes<D: Db>(db: &D, person_id: &str, hashes: &[String]) -> Result<(), DbError> {
    let mut batch = vec![stmt("DELETE FROM recovery_codes WHERE person_id = ?", params![person_id])];
    batch.extend(hashes.iter().map(|h| stmt("INSERT INTO recovery_codes (code_hash, person_id) VALUES (?, ?)", params![h.as_str(), person_id])));
    db.batch(&batch).await.map(|_| ())
}

/// Uses a code once: `true` when it belonged to the person and was still unused.
pub async fn use_recovery_code<D: Db>(db: &D, person_id: &str, hash: &str, now: u64) -> Result<bool, DbError> {
    let sql = "UPDATE recovery_codes SET used_at = ? WHERE code_hash = ? AND person_id = ? AND used_at IS NULL";
    Ok(db.batch(&[stmt(sql, params![now, hash, person_id])]).await?.first() == Some(&1))
}

pub async fn unused_recovery_codes<D: Db>(db: &D, person_id: &str) -> Result<u32, DbError> {
    #[derive(Deserialize)]
    struct N {
        n: u32,
    }
    Ok(decode_one::<N>(db.first(&stmt("SELECT COUNT(*) AS n FROM recovery_codes WHERE person_id = ? AND used_at IS NULL", params![person_id])).await?)?
        .map_or(0, |r| r.n))
}
