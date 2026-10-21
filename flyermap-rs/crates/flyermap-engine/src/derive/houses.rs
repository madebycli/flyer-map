//! Step 5: houses from buildings (with their address, or the address node inside or next to them) and from address nodes that belong to no building.
use super::*;

pub(super) fn derive_houses(raw: &RawOsm, frame: &Frame, seg_grid: &mut Grid, indexed: &[Indexed], segments: &[Segment], diag: &mut Diagnostics) -> Vec<House> {
    // 5. houses
    let mut address_nodes: Vec<&RawAddressNode> = raw.addresses.iter().collect();
    address_nodes.sort_by_key(|a| a.id);
    let mut node_grid = Grid::new(64.0);
    let mut node_xy: Vec<[f64; 2]> = Vec::with_capacity(address_nodes.len());
    let mut node_used: Vec<bool> = vec![false; address_nodes.len()];
    for node in &address_nodes {
        let p = frame.to_xy(node.point);
        node_grid.insert([p[0], p[1], p[0], p[1]]);
        node_xy.push(p);
    }

    let mut buildings: Vec<&RawBuilding> = raw.buildings.iter().collect();
    buildings.sort_by_key(|b| b.id);
    let mut houses: Vec<House> = Vec::new();
    let mut scratch: Vec<u32> = Vec::new();
    for building in &buildings {
        if building.ring.len() < 4 {
            bump(&mut diag.buildings_skipped, "degenerate_ring".into());
            continue;
        }
        let center = ring_centroid(&building.ring);
        let [cx, cy] = frame.to_xy(center);
        let mut number = non_empty(trimmed(&building.tags, "addr:housenumber"));
        let mut street = non_empty(trimmed(&building.tags, "addr:street"));
        if number.is_none() {
            node_grid.search([cx - 40.0, cy - 40.0, cx + 40.0, cy + 40.0], &mut scratch);
            let mut near: Vec<(f64, i64, usize)> = Vec::new();
            for &idx in &scratch {
                let i = idx as usize;
                let node = address_nodes[i];
                let d = (node_xy[i][0] - cx).hypot(node_xy[i][1] - cy);
                if point_in_ring(node.point, &building.ring) || d <= ADDRESS_NODE_SNAP {
                    near.push((d, node.id, i));
                }
            }
            near.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal).then(a.1.cmp(&b.1)));
            let hit = near.iter().find(|(_, _, i)| address_nodes[*i].tags.get("addr:housenumber").map(|v| !v.is_empty()).unwrap_or(false));
            if let Some(&(_, _, i)) = hit {
                node_used[i] = true;
                let node = address_nodes[i];
                number = Some(js_trim(&node.tags["addr:housenumber"]).to_string());
                // JS: `street ?? node street?.trim() ?? null` — a node street of "" stays "".
                if street.is_none() {
                    street = trimmed(&node.tags, "addr:street");
                }
            }
        }
        let evidence = match classify_building(&building.tags, number.is_some()) {
            BuildingVerdict::Keep(e) => e,
            BuildingVerdict::Drop(reason) => {
                bump(&mut diag.buildings_skipped, reason);
                continue;
            }
        };
        let house = House {
            id: format!("h{}", building.id),
            osm_id: building.id,
            source: Source::Building,
            number,
            street,
            ring: building.ring.clone(),
            center,
            parent: None,
            measure: None,
            street_parent: None,
            evidence,
        };
        houses.push(assign_parent(house, frame, seg_grid, indexed, segments, &mut scratch, diag));
    }

    // address nodes that belong to no building become small point-houses
    let mut building_grid = Grid::new(0.001);
    for b in &raw.buildings {
        let (mut min_x, mut min_y, mut max_x, mut max_y) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
        for p in &b.ring {
            if p[0] < min_x {
                min_x = p[0];
            }
            if p[0] > max_x {
                max_x = p[0];
            }
            if p[1] < min_y {
                min_y = p[1];
            }
            if p[1] > max_y {
                max_y = p[1];
            }
        }
        if !min_x.is_finite() {
            // an empty ring has an infinite box in JS too and never matches
            building_grid.insert([f64::MAX, f64::MAX, f64::MAX, f64::MAX]);
        } else {
            building_grid.insert([min_x, min_y, max_x, max_y]);
        }
    }
    for (i, node) in address_nodes.iter().enumerate() {
        let has_number = node.tags.get("addr:housenumber").map(|v| !v.is_empty()).unwrap_or(false);
        if node_used[i] || !has_number {
            continue;
        }
        let [nx, ny] = node.point;
        building_grid.search([nx, ny, nx, ny], &mut scratch);
        if scratch.iter().any(|&b| point_in_ring(node.point, &raw.buildings[b as usize].ring)) {
            continue;
        }
        let d = 0.00003;
        let house = House {
            id: format!("a{}", node.id),
            osm_id: node.id,
            source: Source::AddressNode,
            number: Some(js_trim(&node.tags["addr:housenumber"]).to_string()),
            street: trimmed(&node.tags, "addr:street"),
            ring: vec![[nx - d, ny - d], [nx + d, ny - d], [nx + d, ny + d], [nx - d, ny + d], [nx - d, ny - d]],
            center: node.point,
            parent: None,
            measure: None,
            street_parent: None,
            evidence: Evidence::AddressNode,
        };
        houses.push(assign_parent(house, frame, seg_grid, indexed, segments, &mut scratch, diag));
    }
    houses
}
