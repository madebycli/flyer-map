//! Whitelist classification, identical to `src/v5/engine/classify.ts`.
use crate::model::{Evidence, RoadClass, Tags};

const STREETS: &[&str] = &[
    "residential", "living_street", "unclassified", "tertiary", "tertiary_link", "secondary", "secondary_link", "primary",
    "primary_link", "pedestrian", "road",
];
const PATH_LIKE: &[&str] = &["footway", "path", "steps"];
const RESTRICTED_ACCESS: &[&str] = &["no", "private", "forestry", "agricultural"];
const UNPAVED: &[&str] = &[
    "unpaved", "ground", "dirt", "earth", "grass", "gravel", "fine_gravel", "sand", "mud", "compacted", "woodchips", "pebblestone",
    "grass_paver", "clay", "soil", "rock",
];
const SERVICE_EXCLUDED: &[&str] = &["driveway", "parking_aisle", "drive-through", "emergency_access", "siding", "yard", "spur"];

fn tag<'a>(tags: &'a Tags, key: &str) -> &'a str {
    tags.get(key).map(String::as_str).unwrap_or("")
}

/// `Ok(class)` for a delivery candidate, `Err(reason)` for an excluded way.
pub fn classify_road(tags: &Tags) -> Result<RoadClass, String> {
    // JS: `if (!highway)` is true for a missing *and* an empty value.
    let highway = tag(tags, "highway");
    if highway.is_empty() {
        return Err("no_highway".into());
    }
    if tag(tags, "area") == "yes" {
        return Err("area".into());
    }
    if RESTRICTED_ACCESS.contains(&tag(tags, "access")) || RESTRICTED_ACCESS.contains(&tag(tags, "foot")) {
        if !["yes", "designated", "permissive"].contains(&tag(tags, "foot")) {
            return Err("restricted_access".into());
        }
    }
    if STREETS.contains(&highway) {
        return Ok(RoadClass::Street);
    }
    if highway == "service" {
        let service = tag(tags, "service");
        if SERVICE_EXCLUDED.contains(&service) {
            return Err(format!("service_{service}"));
        }
        return Ok(RoadClass::Access);
    }
    if PATH_LIKE.contains(&highway) {
        let footway = tag(tags, "footway");
        if highway == "footway" && ["sidewalk", "crossing", "traffic_island", "link"].contains(&footway) {
            return Err(format!("footway_{footway}"));
        }
        if UNPAVED.contains(&tag(tags, "surface")) {
            return Err("unpaved_path".into());
        }
        return Ok(RoadClass::Connector);
    }
    Err(format!("highway_{highway}"))
}

const NON_DWELLING: &[&str] = &[
    "garage", "garages", "carport", "shed", "roof", "greenhouse", "container", "parking", "transformer_tower", "toilets", "kiosk", "silo",
    "digester", "water_tower", "stable", "cowshed", "sty", "ruins", "construction", "bunker", "boathouse",
];
const AMBIGUOUS_OUTBUILDING: &[&str] = &["barn", "cabin", "hut", "service", "allotment_house"];
const RESIDENTIAL: &[&str] = &["house", "residential", "detached", "semidetached_house", "terrace", "apartments", "dormitory", "bungalow", "farm", "houseboat", "static_caravan"];

pub enum BuildingVerdict {
    Keep(Evidence),
    Drop(String),
}

pub fn classify_building(tags: &Tags, has_address: bool) -> BuildingVerdict {
    // JS: `tags.building ?? 'yes'` keeps an empty string.
    let kind = tags.get("building").map(String::as_str).unwrap_or("yes");
    if NON_DWELLING.contains(&kind) {
        return BuildingVerdict::Drop(format!("non_dwelling_{kind}"));
    }
    if has_address {
        return BuildingVerdict::Keep(Evidence::Address);
    }
    if RESIDENTIAL.contains(&kind) {
        return BuildingVerdict::Keep(Evidence::ResidentialType);
    }
    BuildingVerdict::Drop(if AMBIGUOUS_OUTBUILDING.contains(&kind) { format!("outbuilding_{kind}") } else { "no_address_no_residential_type".into() })
}
