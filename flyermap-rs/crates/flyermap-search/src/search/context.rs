//! The situation of the person, prepared once per query: what was used lately, where the map is, which Gebiet, which kinds are allowed.
use super::rank::*;
use crate::{
    entry::KindSet,
    id::Point,
    index::{Data, Index, Slot},
    query::Context,
};
use rustc_hash::FxHashMap;
use std::collections::hash_map::Entry;

pub(crate) struct Ctx {
    pub kinds: KindSet,
    pub limit: usize,
    centre: Option<(f64, f64, f64)>,
    /// The number of the current Gebiet as entries carry it (0 = none known).
    area: u32,
    /// The Gebiet entry itself.
    area_slot: Option<u32>,
    /// Recent entries that exist, most recent first.
    pub recent_order: Vec<u32>,
    recent: FxHashMap<u32, usize>,
    weights: [f32; RECENT_KEPT],
}

impl Ctx {
    pub fn new(index: &Index, c: &Context) -> Ctx {
        let mut recent = c.recent.clone();
        recent.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| a.id.cmp(&b.id)));
        let mut order = Vec::new();
        let mut ranks = FxHashMap::default();
        for r in &recent {
            if order.len() == RECENT_KEPT {
                break;
            }
            if let Some(&slot) = index.by_id.get(&r.id) {
                if let Entry::Vacant(e) = ranks.entry(slot) {
                    e.insert(order.len());
                    order.push(slot);
                }
            }
        }
        let mut weights = [0.0; RECENT_KEPT];
        let mut w = RECENT_MAX;
        for cell in &mut weights {
            *cell = w;
            w *= RECENT_DECAY;
        }
        let area_slot = c.area.as_ref().and_then(|id| index.by_id.get(id).copied());
        Ctx {
            kinds: c.kinds,
            limit: c.limit.min(MAX_LIMIT),
            centre: c.center.map(|p| (p.lng, p.lat, p.lat.to_radians().cos())),
            area: c.area.as_ref().map_or(0, |id| index.area_number_of(id)),
            area_slot,
            recent_order: order,
            recent: ranks,
            weights,
        }
    }

    /// Metres to the map centre, if both are known.
    pub fn distance(&self, p: Point) -> Option<f64> {
        let (lng, lat, k) = self.centre?;
        let (dx, dy) = ((p.lng - lng) * 111_320.0 * k, (p.lat - lat) * 110_574.0);
        Some((dx * dx + dy * dy).sqrt())
    }

    pub fn has_centre(&self) -> bool {
        self.centre.is_some()
    }

    /// How much the situation scales a score: 1.0 and up.
    pub fn factor(&self, number: u32, slot: &Slot) -> f32 {
        let mut f = 1.0;
        if let Some(&rank) = self.recent.get(&number) {
            f += self.weights[rank];
        }
        if let Some(d) = slot.pos.and_then(|p| self.distance(p)) {
            f += NEAR_MAX * NEAR_HALF / (NEAR_HALF + d as f32);
        }
        if (self.area != 0 && slot.area == self.area) || self.area_slot == Some(number) {
            f += AREA_BONUS;
        }
        f
    }

    /// Whether the entry may be a hit at all (kind allowed; commands only while allowed).
    pub fn admits(&self, slot: &Slot) -> bool {
        self.kinds.contains(slot.data.kind()) && !matches!(slot.data, Data::Command { allowed: false, .. })
    }
}
