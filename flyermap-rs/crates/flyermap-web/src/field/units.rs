//! What a start loads: the Gebiete with data for this person, each as one or more units (a big Gebiet is fetched and derived in parts, see
//! `flyermap_pack::plan`). Same rules as the boot of `src/v5/app/useCampaign.ts`.
use flyermap_rights::Role;
use flyermap_wire::meta::{Area, Meta};

#[derive(Clone, Debug, PartialEq)]
pub struct Unit {
    pub area: String,
    /// `None` for a Gebiet that is one pack; the part number otherwise (`?part=`).
    pub part: Option<usize>,
    pub ring: Vec<[f64; 2]>,
    pub cell: Option<[f64; 4]>,
    pub has_pack: bool,
}

/// A team link or a collector gets the streets and houses of the Gebiete they work in; the other Gebiete are outlines. Admins and readers see everything.
pub fn data_areas(meta: &Meta) -> Vec<&Area> {
    let works_in_some = matches!(meta.role, Role::TeamEditor | Role::CollectionCollector);
    meta.areas.iter().filter(|a| !works_in_some || a.writable).collect()
}

pub fn units(meta: &Meta) -> Vec<Unit> {
    let mut out = Vec::new();
    for area in data_areas(meta) {
        let ring: Vec<[f64; 2]> = area.geometry.outer().to_vec();
        let plan = flyermap_pack::plan(&ring);
        for part in plan.parts {
            out.push(Unit {
                area: area.id.clone(),
                part: (!plan.single).then_some(part.index),
                ring: ring.clone(),
                cell: part.cell,
                has_pack: area.pack_version.is_some(),
            });
        }
    }
    out
}

/// The address of a unit's pack.
pub fn pack_path(base: &str, unit: &Unit) -> String {
    let area = String::from(js_sys::encode_uri_component(&unit.area));
    match unit.part {
        Some(part) => format!("{base}/areas/{area}/pack?part={part}"),
        None => format!("{base}/areas/{area}/pack"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(role: &str) -> Meta {
        let text = format!(
            r#"{{"campaign":{{"id":"c","name":"T"}},"kind":"distribution","window":null,"guestRoom":null,"role":"{role}","teamId":"t1","me":{{"label":null}},
            "collectorId":null,"collectorLabel":null,"runs":[],"mainArea":null,"mainAreaId":null,"pickupRights":{{"view":false,"create":false,"edit":false}},
            "canWrite":true,"canBuildPack":false,"teams":[],"contextAreas":[],"basemap":null,"areas":[
            {{"id":"a","name":"A","teamId":"t1","geometry":{{"type":"Polygon","coordinates":[[[13,51],[13.01,51],[13.01,51.01],[13,51]]]}},"updatedAt":"x","packVersion":2,"packStale":false,"writable":true}},
            {{"id":"b","name":"B","teamId":"t2","geometry":{{"type":"Polygon","coordinates":[[[13.0,51.4],[13.07,51.4],[13.07,51.45],[13.0,51.45],[13.0,51.4]]]}},"updatedAt":"x","packVersion":null,"packStale":false,"writable":false}}]}}"#
        );
        serde_json::from_str(&text).unwrap()
    }

    #[test]
    fn a_team_link_loads_its_own_gebiete_and_a_reader_all() {
        assert_eq!(units(&meta("team-editor")).len(), 1);
        let all = units(&meta("viewer"));
        assert!(all.len() > 2, "the big Gebiet comes in parts");
        assert_eq!((all[0].part, all[0].has_pack), (None, true));
        assert!(all[1..].iter().all(|u| u.area == "b" && u.part.is_some() && u.cell.is_some() && !u.has_pack));
    }
}
