//! Nothing typed yet: what was used last, then the commands that matter most.
use super::{context::Ctx, members::*, rank::*};
use crate::{
    entry::Kind,
    index::{Data, Index},
};

pub(crate) fn candidates(index: &Index, ctx: &Ctx) -> Vec<Cand> {
    let mut commands: Vec<(u8, u32)> = Vec::new();
    if ctx.kinds.contains(Kind::Command) {
        for label in index.labels.iter().flatten() {
            for &s in &label.members {
                if let Data::Command { allowed: true, priority, .. } = index.slot(s).data {
                    commands.push((priority, s));
                }
            }
        }
    }
    commands.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| index.slot(a.1).id.cmp(&index.slot(b.1).id)));
    commands.truncate(EMPTY_COMMANDS);
    let recent: Vec<u32> = ctx.recent_order.iter().copied().filter(|&s| ctx.admits(index.slot(s))).collect();
    let room = ctx.limit.saturating_sub(commands.len());
    let mut out = Vec::new();
    for (rank, &s) in recent.iter().take(room).enumerate() {
        out.push(Cand { slot: s, score: 1_000_000 - rank as u32, run: NO_RUN, digits: 0 });
    }
    for (n, &(priority, s)) in commands.iter().enumerate() {
        out.push(Cand { slot: s, score: 500_000 + priority as u32 * 100 - n as u32, run: NO_RUN, digits: 0 });
    }
    out
}
