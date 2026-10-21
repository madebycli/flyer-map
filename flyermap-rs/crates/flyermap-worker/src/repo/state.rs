//! The shared state (`v5_state`): one row per key, the newest edit wins, a sequence number per Aktion for the cursor.
use crate::{
    db::{stmt, Param, Stmt},
    params,
};
use flyermap_rights::{is_scoped, Caller, Role, Write};

/// SQL that limits rows to the Gebiete a caller may read; admins and viewers get no limit.
pub fn readable_areas(caller: &Caller, campaign_id: &str) -> (&'static str, Vec<Param>) {
    if caller.role == Role::CollectionCollector {
        return (" AND area_id IN (SELECT id FROM collection_areas WHERE campaign_id = ? AND status <> 'archived')", params![campaign_id]);
    }
    if is_scoped(caller) {
        // a guest of a room sees and writes its one Gebiet and nothing else of the Gruppe
        if let Some(area) = caller.room_area_id.as_deref() {
            return (
                " AND area_id IN (SELECT id FROM areas WHERE campaign_id = ? AND team_id = ? AND id = ?)",
                params![campaign_id, caller.team_id.clone(), area],
            );
        }
        return (" AND area_id IN (SELECT id FROM areas WHERE campaign_id = ? AND team_id = ?)", params![campaign_id, caller.team_id.clone()]);
    }
    ("", Vec::new())
}

const ROWS_PER_STATEMENT: usize = 10; // 9 bound parameters per row; D1 allows 100 per statement.

/// The statements that write a batch atomically. Sequence numbers are taken inside the same batch as the upserts: reserving them in a separate step
/// would let a slower writer commit lower numbers after a faster one, and a client whose cursor already passed them would never see those rows.
pub fn write_statements(campaign_id: &str, rows: &[&Write], actor: &str, grant_id: &str, scoped: bool) -> Vec<Stmt> {
    let mut out = vec![
        stmt("INSERT OR IGNORE INTO v5_counters (campaign_id, seq) VALUES (?, 0)", params![campaign_id]),
        stmt("UPDATE v5_counters SET seq = seq + ? WHERE campaign_id = ?", params![rows.len(), campaign_id]),
    ];
    for (i, chunk) in rows.chunks(ROWS_PER_STATEMENT).enumerate() {
        let mut values = Vec::new();
        for (j, row) in chunk.iter().enumerate() {
            let back = rows.len() - (i * ROWS_PER_STATEMENT + j + 1);
            values.extend(params![campaign_id, row.key.as_str(), row.id.as_str(), row.status.as_str(), row.area.as_str(), actor, grant_id, campaign_id, back]);
        }
        let marks = vec!["(?,?,?,?,?,?,?,(SELECT seq FROM v5_counters WHERE campaign_id = ?) - ?)"; chunk.len()].join(",");
        let scope = if scoped { " AND v5_state.area_id = excluded.area_id" } else { "" };
        out.push(stmt(
            format!(
                "INSERT INTO v5_state (campaign_id, key, op_id, status, area_id, actor, grant_id, seq)
         VALUES {marks}
         ON CONFLICT(campaign_id, key) DO UPDATE SET op_id = excluded.op_id, status = excluded.status, area_id = excluded.area_id,
           actor = excluded.actor, grant_id = excluded.grant_id, seq = excluded.seq
         WHERE excluded.op_id > v5_state.op_id{scope}"
            ),
            values,
        ));
    }
    out
}
