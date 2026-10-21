//! Made-up data for the shell slice: three Gebiete of two Gruppen, a few streets with houses, deterministic statuses. The numbers go through
//! `flyermap_core::Progress` like the real ones will; the store, the engine and the server replace this module (M5).
use crate::{
    features::{
        map_stub::{HouseDot, StreetLine},
        overview::{AreaRow, OverviewData, TeamRow},
        search::Place,
    },
    ui::{HitKind, PillState},
};
use flyermap_core::{Key, Progress, Status};

pub const CAMPAIGN: &str = "Herbstaktion (Beispiel)";

struct Area {
    id: &'static str,
    name: &'static str,
    team: usize,
}

const TEAMS: [(&str, &str); 2] = [("Gruppe Nord", "#4f8fdc"), ("Gruppe Süd", "#d9a53a")];
const AREAS: [Area; 3] =
    [Area { id: "nord", name: "Nordstadt", team: 0 }, Area { id: "alt", name: "Altstadt", team: 1 }, Area { id: "hafen", name: "Hafenviertel", team: 1 }];

/// Name, Gebiet (index), from, to, number of houses.
type StreetDef = (&'static str, usize, (f64, f64), (f64, f64), usize);
const STREETS: [StreetDef; 8] = [
    ("Hauptstraße", 0, (80.0, 160.0), (920.0, 160.0), 16),
    ("Lindenweg", 0, (240.0, 60.0), (240.0, 420.0), 8),
    ("Am Markt", 0, (620.0, 60.0), (620.0, 420.0), 9),
    ("Kirchgasse", 1, (80.0, 520.0), (560.0, 520.0), 10),
    ("Schulstraße", 1, (420.0, 440.0), (420.0, 940.0), 12),
    ("Rosenweg", 1, (80.0, 760.0), (380.0, 760.0), 6),
    ("Hafenstraße", 2, (560.0, 640.0), (940.0, 640.0), 11),
    ("Kaiweg", 2, (760.0, 460.0), (760.0, 940.0), 10),
];

/// A fixed pattern that reads like a day of work: most done in the north, half in the old town, little at the harbour.
fn status_of(area: usize, street: usize, n: usize) -> Status {
    let done_until = [8, 5, 2][area];
    match (n * 7 + street * 3) % 10 {
        x if x < done_until => Status::Completed,
        8 => Status::Later,
        9 if area != 0 => Status::NotDeliverable,
        _ => Status::Open,
    }
}

pub struct World {
    pub streets: Vec<StreetLine>,
    pub houses: Vec<HouseDot>,
    pub places: Vec<Place>,
    pub overview: OverviewData,
    pub pill: PillState,
}

type HouseRec = (Key, usize, Status);

fn lay_out() -> (Vec<StreetLine>, Vec<HouseDot>, Vec<Place>, Vec<HouseRec>) {
    let (mut streets, mut houses, mut places, mut records) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for (si, (name, area, from, to, count)) in STREETS.iter().enumerate() {
        let area_name = AREAS[*area].name;
        let mut done = 0;
        places.push(Place { id: format!("s{si}"), kind: HitKind::Street, label: name.to_string(), area: area_name.into() });
        for n in 0..*count {
            let t = (n as f64 + 0.5) / *count as f64;
            let (dx, dy) = (to.0 - from.0, to.1 - from.1);
            let side = if n % 2 == 0 { 1.0 } else { -1.0 };
            // houses on both sides, 28 units off the middle of the street
            let (nx, ny) = if dx.abs() > dy.abs() { (0.0, 28.0 * side) } else { (28.0 * side, 0.0) };
            let status = status_of(*area, si, n);
            done += usize::from(status == Status::Completed);
            houses.push(HouseDot { at: (from.0 + dx * t + nx, from.1 + dy * t + ny), status });
            records.push((Key::house(&format!("{si}-{n}")), *area, status));
            places.push(Place { id: format!("h{si}-{n}"), kind: HitKind::House, label: format!("{name} {}", n + 1), area: area_name.into() });
        }
        let street_status = if done * 2 > *count { Status::Completed } else { Status::Open };
        streets.push(StreetLine { from: *from, to: *to, status: street_status });
    }
    (streets, houses, places, records)
}

fn progress_of<'a>(records: impl Iterator<Item = &'a HouseRec> + Clone) -> flyermap_core::ProgressSnapshot {
    let keys = records.clone().map(|(k, _, _)| k.clone());
    let current = records.map(|(k, _, s)| (k.clone(), *s));
    Progress::new(keys, [], current).snapshot()
}

pub fn world() -> World {
    let (streets, houses, places, records) = lay_out();
    let overall = progress_of(records.iter());
    let areas = AREAS
        .iter()
        .enumerate()
        .map(|(i, a)| AreaRow { id: a.id.into(), name: a.name.into(), snapshot: progress_of(records.iter().filter(move |r| r.1 == i)) })
        .collect();
    let teams = TEAMS
        .iter()
        .enumerate()
        .map(|(t, (name, color))| TeamRow {
            name: name.to_string(),
            color: color.to_string(),
            snapshot: progress_of(records.iter().filter(move |r| AREAS[r.1].team == t)),
        })
        .collect();
    let pill = PillState {
        done: overall.houses_with(Status::Completed),
        total: overall.total_houses - overall.houses_with(Status::NotDeliverable),
        percent: (overall.house_ratio * 100.0).round() as i64,
        ..PillState::default()
    };
    World { streets, houses, places, overview: OverviewData { overall, areas, teams }, pill }
}

/// The name of a Gebiet by id.
pub fn area_name(id: &str) -> Option<&'static str> {
    AREAS.iter().find(|a| a.id == id).map(|a| a.name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_numbers_add_up() {
        let w = world();
        let total: usize = STREETS.iter().map(|s| s.4).sum();
        assert_eq!(w.houses.len(), total);
        assert_eq!(w.overview.overall.total_houses as usize, total);
        let by_area: i64 = w.overview.areas.iter().map(|a| a.snapshot.total_houses).sum();
        assert_eq!(by_area as usize, total);
        assert!(w.pill.done > 0 && w.pill.done < w.pill.total && w.pill.percent > 0 && w.pill.percent < 100);
        assert_eq!(w.places.iter().filter(|p| p.kind == HitKind::Street).count(), STREETS.len());
    }
}
