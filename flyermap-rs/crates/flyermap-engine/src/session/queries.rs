//! Geometry questions: lasso, search, snapping a position to the nearest house or street.
use super::*;
use crate::query::{self, Lasso};

impl Session {
    /// Houses whose centre and visible street pieces whose middle lie inside the shape (ids); `houses_only` skips streets without a house.
    pub fn lasso(&self, ring: &[LngLat], houses_only: bool) -> (Vec<String>, Vec<String>) {
        let Some(shape) = Lasso::new(ring) else {
            return (Vec::new(), Vec::new());
        };
        let houses = self.houses.iter().filter(|h| shape.contains(h.center_ll)).map(|h| h.key[2..].to_string()).collect();
        let segments = self.segs.iter().filter(|s| (!houses_only || s.with_houses) && shape.contains(s.mid)).map(|s| s.key[2..].to_string()).collect();
        (houses, segments)
    }

    fn build_search(&self) -> Vec<Entry> {
        let g = &self.graph;
        // one entry per street name: the junction-to-junction street with the most houses (earliest on a tie) is where it points
        struct Street {
            id: u32,
            houses: u32,
            total: u32,
            seen: FxHashSet<u32>,
        }
        let mut order: Vec<&str> = Vec::new();
        let mut streets: FxHashMap<&str, Street> = FxHashMap::default();
        for i in 0..g.ids.len() {
            if !g.visible[i] {
                continue;
            }
            let Some(name) = g.name[i].as_deref() else {
                continue;
            };
            if name.is_empty() {
                continue;
            }
            let group = g.group[i];
            let houses = g.group_houses[group as usize];
            let street = streets.entry(name).or_insert_with(|| {
                order.push(name);
                Street { id: i as u32, houses: 0, total: 0, seen: FxHashSet::default() }
            });
            if street.seen.insert(group) {
                street.total += houses;
                if street.seen.len() == 1 || houses > street.houses {
                    street.houses = houses;
                    street.id = i as u32;
                }
            }
        }
        let mut entries = Vec::with_capacity(order.len() + self.houses.len());
        for name in order {
            let street = &streets[name];
            entries.push(Entry {
                street: true,
                id: g.ids[street.id as usize].clone(),
                label: name.to_string(),
                detail: format!("{} Häuser", street.total),
                norm: query::fold(name),
            });
        }
        for h in &self.houses {
            let (Some(street), Some(number)) = (h.street.as_deref(), h.number.as_deref()) else {
                continue;
            };
            if street.is_empty() || number.is_empty() {
                continue;
            }
            let label = format!("{street} {number}");
            entries.push(Entry { street: false, id: h.key[2..].to_string(), norm: query::fold(&label), label, detail: "Haus".to_string() });
        }
        entries
    }

    /// Street and address search: `(kind, id, label, detail)` of the best matches.
    pub fn search(&mut self, text: &str, limit: usize) -> Vec<(bool, String, String, String)> {
        if self.search_entries.is_none() {
            self.search_entries = Some(self.build_search());
        }
        let entries = self.search_entries.as_ref().unwrap();
        query::search(entries, text, limit)
            .into_iter()
            .map(|i| {
                let e = &entries[i];
                (e.street, e.id.clone(), e.label.clone(), e.detail.clone())
            })
            .collect()
    }

    /// The nearest house within `house_reach` metres, else the nearest street within `street_reach` (position, name).
    /// Returns (position, address, kind) with kind 0 = nothing, 1 = house, 2 = street.
    pub fn snap(&self, at: LngLat, house_reach: f64, street_reach: f64) -> (LngLat, Option<String>, u8) {
        let kx = 111_320.0 * (at[1] * std::f64::consts::PI / 180.0).cos();
        let m_lat = 110_574.0;
        let d2 = |p: LngLat| ((p[0] - at[0]) * kx).powi(2) + ((p[1] - at[1]) * m_lat).powi(2);
        let mut best_house: Option<(f64, usize)> = None;
        for (i, h) in self.houses.iter().enumerate() {
            if ((h.center_ll[0] - at[0]) * kx).abs() > house_reach || ((h.center_ll[1] - at[1]) * m_lat).abs() > house_reach {
                continue;
            }
            let d = d2(h.center_ll);
            if d <= house_reach * house_reach && best_house.is_none_or(|(bd, _)| d < bd) {
                best_house = Some((d, i));
            }
        }
        if let Some((_, i)) = best_house {
            let h = &self.houses[i];
            let label: Vec<&str> = [h.street.as_deref(), h.number.as_deref()].into_iter().flatten().filter(|s| !s.is_empty()).collect();
            return (h.center_ll, if label.is_empty() { None } else { Some(label.join(" ")) }, 1);
        }
        let mut best: Option<(f64, LngLat, Option<String>)> = None;
        for s in &self.segs {
            for w in s.lnglat.windows(2) {
                let (a, b) = (w[0], w[1]);
                let (ax, ay, bx, by) = ((a[0] - at[0]) * kx, (a[1] - at[1]) * m_lat, (b[0] - at[0]) * kx, (b[1] - at[1]) * m_lat);
                let (dx, dy) = (bx - ax, by - ay);
                let len2 = dx * dx + dy * dy;
                let t = if len2 == 0.0 { 0.0 } else { (-(ax * dx + ay * dy) / len2).clamp(0.0, 1.0) };
                let (px, py) = (ax + t * dx, ay + t * dy);
                let d = px * px + py * py;
                if d <= street_reach * street_reach && best.as_ref().is_none_or(|(bd, _, _)| d < *bd) {
                    best = Some((d, [at[0] + px / kx, at[1] + py / m_lat], s.name.clone()));
                }
            }
        }
        match best {
            Some((_, p, name)) => (p, name, 2),
            None => (at, None, 0),
        }
    }
}
