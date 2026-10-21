use crate::{
    db::{decode_one, stmt, Db, DbError},
    params,
};
use flyermap_wire::meta::{CampaignRef, TimeWindow};
use serde::Deserialize;

pub async fn campaign<D: Db>(db: &D, campaign_id: &str) -> Result<Option<CampaignRef>, DbError> {
    #[derive(Deserialize)]
    struct Row {
        id: String,
        name: String,
    }
    Ok(decode_one::<Row>(
        db.first(&stmt(
            "SELECT id, name FROM campaigns WHERE id = ?",
            params![campaign_id],
        ))
        .await?,
    )?
    .map(|r| CampaignRef {
        id: r.id,
        name: r.name,
    }))
}

/// The time window of the Aktion; `None` when none is set (or the migration is not there yet).
pub async fn window<D: Db>(db: &D, campaign_id: &str) -> Result<Option<TimeWindow>, DbError> {
    #[derive(Deserialize)]
    struct Row {
        window_starts_at: Option<String>,
        window_ends_at: Option<String>,
    }
    let row = match db
        .first(&stmt(
            "SELECT window_starts_at, window_ends_at FROM campaigns WHERE id = ?",
            params![campaign_id],
        ))
        .await
    {
        Ok(row) => row,
        Err(_) => return Ok(None),
    };
    Ok(decode_one::<Row>(row)?
        .filter(|r| {
            [&r.window_starts_at, &r.window_ends_at]
                .iter()
                .any(|v| v.as_deref().is_some_and(|s| !s.is_empty()))
        })
        .map(|r| TimeWindow {
            starts_at: r.window_starts_at,
            ends_at: r.window_ends_at,
        }))
}
