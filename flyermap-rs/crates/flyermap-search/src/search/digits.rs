//! A lone house number ("12"): read on the street the person is on. Houses with that number on the street last used and on the streets
//! nearest to the map centre come first; the same number elsewhere follows, nearest first.
use super::{context::Ctx, members::*, rank::*, Run};
use crate::{
    entry::Kind,
    index::{Data, Index},
};
use rustc_hash::FxHashMap;

/// By how much each street (label) counts more: the streets last used, the streets nearest to the centre.
fn street_boosts(index: &Index, ctx: &Ctx) -> FxHashMap<u32, f32> {
    let mut boosts: FxHashMap<u32, f32> = FxHashMap::default();
    let mut used = 0;
    for &s in &ctx.recent_order {
        let slot = index.slot(s);
        if matches!(slot.data, Data::Street { .. } | Data::House { .. }) && !boosts.contains_key(&slot.label) {
            boosts.insert(slot.label, STREET_RECENT[used]);
            used += 1;
            if used == STREET_RECENT.len() {
                break;
            }
        }
    }
    if !ctx.has_centre() {
        return boosts;
    }
    let mut near: Vec<(f64, u32)> = Vec::new();
    for (at, label) in index.labels.iter().enumerate() {
        let Some(label) = label.as_ref().filter(|l| !l.houses.is_empty()) else {
            continue;
        };
        let reach = label.members.iter().filter_map(|&m| index.slot(m).pos).filter_map(|p| ctx.distance(p)).fold(f64::INFINITY, f64::min);
        if reach <= STREET_NEAR_REACH {
            near.push((reach, at as u32));
        }
    }
    near.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
    for (&(_, label), boost) in near.iter().zip(STREET_NEAR) {
        let entry = boosts.entry(label).or_insert(0.0);
        *entry = entry.max(boost);
    }
    boosts
}

/// Houses by number only: every token is a number, the first one is looked for.
pub(crate) fn houses_by_number(index: &Index, ctx: &Ctx, run: &Run, run_no: u8, out: &mut Vec<Cand>) {
    let Some(number) = run.parse.tokens.first().and_then(|t| t.number.as_ref()) else {
        return;
    };
    if !ctx.kinds.contains(Kind::House) {
        return;
    }
    let boosts = street_boosts(index, ctx);
    for (at, label) in index.labels.iter().enumerate() {
        let Some(label) = label.as_ref().filter(|l| !l.houses.is_empty()) else {
            continue;
        };
        let boost = 1.0 + boosts.get(&(at as u32)).copied().unwrap_or(0.0);
        for &(_, s) in &label.houses {
            let slot = index.slot(s);
            let Data::House { no, .. } = &slot.data else {
                continue;
            };
            let n = number.score(no);
            if n == 0 {
                continue;
            }
            let score = n as f32 * ctx.factor(s, slot) * boost;
            let digits = if n == 1000 { WHOLE_NUMBER } else { number.typed_digits() };
            out.push(Cand { slot: s, score: score.round() as u32, run: run_no, digits });
        }
    }
}
