//! Clean-up never deletes a synced row: the other devices already hold its status and cursor, so a vanished row would stay on them for good. It
//! writes a tombstone instead (status `open`, which equals "no entry", under a newer id and sequence number), and the normal pull carries it to
//! everyone. The id sorts after the newest id it replaces, so last-writer-wins lets it win over exactly what it removes and lets any edit made
//! afterwards win over it.
use crate::{
    db::{stmt, Db, Param, Stmt},
    params,
};
use flyermap_core::clock::{decode_clock, encode_clock, ClockState};

const ACTOR: &str = "Aufräumen";
const MAX_COUNTER: u32 = 36u32.pow(4) - 1;

/// `node` is `srv` and six random hex digits.
pub fn tombstone_id(now: u64, newest: Option<&str>, node: String) -> String {
    let next = match newest.and_then(decode_clock) {
        Some(prior) if prior.wall >= now && prior.counter >= MAX_COUNTER => ClockState { wall: prior.wall + 1, counter: 0, node },
        Some(prior) if prior.wall >= now => ClockState { wall: prior.wall, counter: prior.counter + 1, node },
        _ => ClockState { wall: now, counter: 0, node },
    };
    encode_clock(&next).as_str().to_string()
}

#[derive(Clone, Copy)]
pub enum Table {
    State,
    Notes,
}

/// Rows matched by `where_sql` with `params`.
pub struct Scope {
    pub where_sql: String,
    pub params: Vec<Param>,
}

/// The statements that tombstone the rows of `table` matched by `scope`; the sequence numbers are allocated inside the same atomic batch. The
/// third statement is the update (its change count is the number of rows cleared).
pub fn statements(table: Table, campaign_id: &str, scope: &Scope, id: &str, grant_id: &str) -> Vec<Stmt> {
    let (name, counters, id_column, set) = match table {
        Table::State => ("v5_state", "v5_counters", "key", "status = 'open', op_id = ?, actor = ?, grant_id = ?"),
        Table::Notes => ("v5_notes", "v5_note_counters", "id", "flag = NULL, body = '', deleted = 1, rev = ?, actor = ?, grant_id = ?"),
    };
    let where_sql = &scope.where_sql;
    let eligible = format!("SELECT {id_column} AS k FROM {name} WHERE {where_sql}");
    let mut counted = scope.params.clone();
    counted.push(campaign_id.into());
    let mut update = scope.params.clone();
    update.extend(params![id, ACTOR, grant_id, campaign_id, campaign_id]);
    vec![
        stmt(format!("INSERT OR IGNORE INTO {counters} (campaign_id, seq) VALUES (?, 0)"), params![campaign_id]),
        stmt(format!("UPDATE {counters} SET seq = seq + (SELECT COUNT(*) FROM {name} WHERE {where_sql}) WHERE campaign_id = ?"), counted),
        stmt(
            format!(
                "WITH t AS MATERIALIZED (SELECT k, row_number() OVER (ORDER BY k) AS n, count(*) OVER () AS cnt FROM ({eligible}))
       UPDATE {name} SET {set}, seq = (SELECT seq FROM {counters} WHERE campaign_id = ?) - t.cnt + t.n
       FROM t WHERE {name}.campaign_id = ? AND {name}.{id_column} = t.k"
            ),
            update,
        ),
    ]
}

/// True while no Gebiet with this id exists, in the same statement that writes: a check made before the batch could be overtaken by a re-created
/// Gebiet.
pub async fn gone_guard<D: Db>(db: &D, campaign_id: &str, area_id: &str) -> Scope {
    let mut guard = Scope { where_sql: " AND NOT EXISTS (SELECT 1 FROM areas WHERE campaign_id = ? AND id = ?)".into(), params: params![campaign_id, area_id] };
    // Collection tables not migrated: there are no collection Gebiete to guard.
    if db.first(&stmt("SELECT 1 FROM collection_areas LIMIT 1", Vec::new())).await.is_ok() {
        guard.where_sql.push_str(" AND NOT EXISTS (SELECT 1 FROM collection_areas WHERE campaign_id = ? AND id = ?)");
        guard.params.extend(params![campaign_id, area_id]);
    }
    guard
}

#[cfg(test)]
mod tests {
    use super::tombstone_id;
    use flyermap_core::clock::{decode_clock, encode_clock, ClockState};

    fn id(wall: u64, counter: u32) -> String {
        encode_clock(&ClockState { wall, counter, node: "n".into() }).as_str().to_string()
    }

    #[test]
    fn a_tombstone_sorts_after_what_it_replaces() {
        let node = || "srvabcdef".to_string();
        assert_eq!(decode_clock(&tombstone_id(1000, None, node())).unwrap().wall, 1000);
        assert_eq!(decode_clock(&tombstone_id(1000, Some(&id(900, 5)), node())).unwrap().counter, 0);
        let later = id(2000, 5);
        let t = tombstone_id(1000, Some(&later), node());
        assert!(t > later && decode_clock(&t).unwrap().counter == 6);
        let full = id(2000, 36u32.pow(4) - 1);
        let t = tombstone_id(1000, Some(&full), node());
        assert!(t > full && decode_clock(&t).unwrap().wall == 2001);
    }
}
