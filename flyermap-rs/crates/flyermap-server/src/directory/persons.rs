use flyermap_host::{
    db::{decode_one, stmt, Db, DbError, Stmt},
    params,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Person {
    pub id: String,
    pub kind: String,
    pub handle: Option<String>,
    pub display_name: String,
    pub created_at: u64,
    pub disabled_at: Option<u64>,
}

const COLUMNS: &str = "id, kind, handle, display_name, created_at, disabled_at";

/// Sign-in names are compared in lower case without surrounding spaces.
pub fn clean_handle(handle: &str) -> Option<String> {
    let h = handle.trim().to_lowercase();
    let ok = (3..=40).contains(&h.chars().count()) && h.chars().all(|c| c.is_alphanumeric() || matches!(c, '.' | '_' | '-' | '@' | '+'));
    ok.then_some(h)
}

/// Names shown to others: no control characters or angle brackets, at most 60 UTF-16 units.
pub fn clean_name(name: &str, fallback: &str) -> String {
    let kept: String = name.chars().filter(|c| !c.is_control() && !matches!(c, '<' | '>')).collect();
    let mut units = 0;
    let cut: String = kept
        .trim()
        .chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= 60
        })
        .collect();
    if cut.is_empty() {
        fallback.to_string()
    } else {
        cut
    }
}

pub async fn get<D: Db>(db: &D, id: &str) -> Result<Option<Person>, DbError> {
    decode_one(db.first(&stmt(format!("SELECT {COLUMNS} FROM persons WHERE id = ?"), params![id])).await?)
}

pub async fn by_handle<D: Db>(db: &D, handle: &str) -> Result<Option<Person>, DbError> {
    decode_one(db.first(&stmt(format!("SELECT {COLUMNS} FROM persons WHERE handle = ?"), params![handle])).await?)
}

pub fn insert_stmt(person: &Person) -> Stmt {
    stmt(
        "INSERT INTO persons (id, kind, handle, display_name, created_at) VALUES (?, ?, ?, ?, ?)",
        params![person.id.as_str(), person.kind.as_str(), person.handle.clone(), person.display_name.as_str(), person.created_at],
    )
}

pub fn is_unique_violation(e: &DbError) -> bool {
    e.message.to_lowercase().contains("unique")
}

/// `Ok(false)` when the sign-in name is taken.
pub async fn insert<D: Db>(db: &D, person: &Person) -> Result<bool, DbError> {
    let result = db.batch(&[insert_stmt(person)]).await;
    match result {
        Ok(_) => Ok(true),
        Err(e) if e.message.to_lowercase().contains("unique") => Ok(false),
        Err(e) => Err(e),
    }
}

pub async fn rename<D: Db>(db: &D, id: &str, name: &str) -> Result<(), DbError> {
    db.batch(&[stmt("UPDATE persons SET display_name = ? WHERE id = ?", params![name, id])]).await.map(|_| ())
}

pub async fn disable<D: Db>(db: &D, id: &str, at: u64) -> Result<(), DbError> {
    db.batch(&[stmt("UPDATE persons SET disabled_at = COALESCE(disabled_at, ?) WHERE id = ?", params![at, id])]).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_cleaned() {
        assert_eq!(clean_handle("  Anna.Muster "), Some("anna.muster".into()));
        for bad in ["ab", "a b c", "<script>", "x".repeat(41).as_str(), ""] {
            assert_eq!(clean_handle(bad), None, "{bad}");
        }
        assert_eq!(clean_name("  <b>Anna</b>\u{7}  ", "Gast"), "bAnna/b");
        assert_eq!(clean_name("   ", "Gast"), "Gast");
        assert_eq!(clean_name(&"😀".repeat(40), "Gast").chars().count(), 30);
    }
}
