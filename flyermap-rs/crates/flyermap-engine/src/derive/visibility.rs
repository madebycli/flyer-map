//! Step 6: which segments are shown (streets always; lanes and paths only when real houses use them), and rounding to the OSM grid.
use super::*;

pub(super) fn finish(mut segments: Vec<Segment>, mut houses: Vec<House>, mut diag: Diagnostics) -> Network {
    // 6. visibility: streets always; access/connector only when real houses use them
    let index_of: HashMap<&str, usize> = segments.iter().enumerate().map(|(i, s)| (s.id.as_str(), i)).collect();
    let mut counts = vec![0u32; segments.len()];
    for h in &houses {
        match &h.parent {
            None => diag.orphan_houses += 1,
            Some(p) => counts[index_of[p.as_str()]] += 1,
        }
    }
    for (i, c) in counts.iter().enumerate() {
        segments[i].house_count = *c;
    }
    let mut group_houses: HashMap<String, u32> = HashMap::default();
    for s in &segments {
        *group_houses.entry(s.group.clone()).or_insert(0) += s.house_count;
    }
    for s in segments.iter_mut() {
        s.visible = s.cls == RoadClass::Street || group_houses.get(&s.group).copied().unwrap_or(0) > 0;
        if s.visible {
            diag.visible_segments += 1;
            if s.cls != RoadClass::Street {
                diag.promoted_by_houses += 1;
            }
        } else if s.cls == RoadClass::Connector {
            diag.hidden_connectors += 1;
        }
    }
    diag.houses_out = houses.len();
    houses.sort_by(|a, b| a.id.cmp(&b.id));
    let mut network = Network { segments, houses, diagnostics: diag };
    round_network(&mut network);
    network
}

/// OSM stores 1e-7° (about 1 cm); derived points are rounded to the same grid, exactly as the TypeScript engine does.
fn r7(v: f64) -> f64 {
    (v * 1e7 + 0.5).floor() / 1e7
}

fn round_network(network: &mut Network) {
    for s in network.segments.iter_mut() {
        for p in s.coords.iter_mut() {
            *p = [r7(p[0]), r7(p[1])];
        }
    }
    for h in network.houses.iter_mut() {
        for p in h.ring.iter_mut() {
            *p = [r7(p[0]), r7(p[1])];
        }
        h.center = [r7(h.center[0]), r7(h.center[1])];
    }
}
