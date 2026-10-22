//! The overview's numbers from the world and the progress the session keeps: the whole Aktion, every Gebiet, every Gruppe (the sum of its Gebiete).
use super::model::{AreaRow, OverviewData, TeamRow};
use crate::model::World;
use flyermap_core::{ProgressSnapshot, Status};
use std::collections::HashMap;

/// Nothing counted yet.
pub fn zero() -> ProgressSnapshot {
    ProgressSnapshot { houses: [0; 4], street_meters: [0.0; 4], total_houses: 0, total_street_meters: 0.0, house_ratio: 0.0 }
}

/// The sum of snapshots; the ratio is recomputed from the sums (the mean of ratios would be wrong).
pub fn combine<'a>(parts: impl IntoIterator<Item = &'a ProgressSnapshot>) -> ProgressSnapshot {
    let mut sum = zero();
    for p in parts {
        for i in 0..4 {
            sum.houses[i] += p.houses[i];
            sum.street_meters[i] += p.street_meters[i];
        }
    }
    sum.total_houses = sum.houses.iter().sum();
    sum.total_street_meters = sum.street_meters.iter().sum();
    let deliverable = sum.total_houses - sum.houses[Status::NotDeliverable.index()];
    sum.house_ratio = if deliverable > 0 { sum.houses[Status::Completed.index()] as f64 / deliverable as f64 } else { 0.0 };
    sum
}

/// The pill of the command bar: houses done of those that count (not-possible ones leave the total), whole percent.
pub fn pill(overall: &ProgressSnapshot, view_only: bool) -> crate::ui::PillState {
    crate::ui::PillState {
        done: overall.houses_with(Status::Completed),
        total: overall.total_houses - overall.houses_with(Status::NotDeliverable),
        percent: super::model::percent_of(overall),
        view_only,
    }
}

pub fn build(world: &World, by_gebiet: &HashMap<String, ProgressSnapshot>) -> OverviewData {
    let of = |id: &str| by_gebiet.get(id).cloned().unwrap_or_else(zero);
    let areas: Vec<AreaRow> = world.gebiete.iter().map(|g| AreaRow { id: g.id.clone(), name: g.name.clone(), snapshot: of(&g.id) }).collect();
    let teams = world
        .gruppen
        .iter()
        .map(|t| {
            let own: Vec<ProgressSnapshot> = world.gebiete.iter().filter(|g| g.gruppe.as_deref() == Some(t.id.as_str())).map(|g| of(&g.id)).collect();
            TeamRow { name: t.name.clone(), color: t.color.clone(), snapshot: combine(&own) }
        })
        .collect();
    OverviewData { overall: combine(areas.iter().map(|a| &a.snapshot)), areas, teams }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::mock::data::{world, Persona};

    fn snap(done: i64, open: i64, blocked: i64) -> ProgressSnapshot {
        let mut s = zero();
        s.houses = [open, done, 0, blocked];
        combine([&s])
    }

    #[test]
    fn a_gruppe_is_the_sum_of_its_gebiete_and_the_ratio_is_not_a_mean() {
        let w = world(Persona::Admin);
        let by = HashMap::from([("altstadt".to_string(), snap(10, 10, 0)), ("hafen".to_string(), snap(0, 30, 10))]);
        let o = build(&w, &by);
        let sued = o.teams.iter().find(|t| t.name == "Gruppe Süd").unwrap();
        assert_eq!((sued.snapshot.total_houses, sued.snapshot.houses_with(Status::Completed)), (60, 10));
        assert!((sued.snapshot.house_ratio - 10.0 / 50.0).abs() < 1e-9, "10 of 50 deliverable, not the mean of 50 % and 0 %");
        assert_eq!(o.overall.total_houses, 60);
        assert_eq!(o.areas.len(), 4);
        assert_eq!(o.teams.iter().find(|t| t.name == "Gruppe Nord").unwrap().snapshot.total_houses, 0, "a Gebiet nobody counted yet is zero");
    }
}
