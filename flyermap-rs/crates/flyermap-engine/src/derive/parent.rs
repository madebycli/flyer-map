//! Which street a house belongs to, and the street that takes a house on a path along when it is marked.
use super::*;

fn class_penalty(cls: RoadClass) -> f64 {
    match cls {
        RoadClass::Street => 0.0,
        RoadClass::Access => 8.0,
        RoadClass::Connector => 25.0,
    }
}

pub(super) fn assign_parent(
    mut house: House,
    frame: &Frame,
    grid: &mut Grid,
    indexed: &[Indexed],
    segments: &[Segment],
    scratch: &mut Vec<u32>,
    diag: &mut Diagnostics,
) -> House {
    let [cx, cy] = frame.to_xy(house.center);
    let reach = MAX_NAMED_PARENT_DISTANCE;
    let wanted = normalize_name(house.street.as_deref());
    grid.search([cx - reach, cy - reach, cx + reach, cy + reach], scratch);
    let mut best: Option<(f64, usize, f64, bool)> = None; // score, segment index, measure, name matches
                                                          // Special rule for garden paths: the best segment that carries the house's own street name. A path (footway, path, steps) that merely lies nearer
                                                          // never takes the house away from it; the dashed paths between gardens and the woodland tracks are only where somebody walks, not the street the house is on.
    let mut best_named: Option<(f64, usize, f64, bool)> = None;
    for &gid in scratch.iter() {
        let entry = &indexed[gid as usize];
        let seg = &segments[entry.seg];
        let named = !wanted.is_empty() && entry.norm == wanted;
        let limit = if named { MAX_NAMED_PARENT_DISTANCE } else { MAX_PARENT_DISTANCE };
        // The box distance never exceeds the true distance, so skipping beyond `limit` changes no outcome, only the work.
        let b = grid.bbox(gid);
        if (b[0] - cx).max(0.0).max(cx - b[2]).hypot((b[1] - cy).max(0.0).max(cy - b[3])) > limit {
            continue;
        }
        let projection = project_to_polyline(&entry.xy, [cx, cy]);
        if projection.distance > limit {
            continue;
        }
        let score = projection.distance + class_penalty(seg.cls) - if named { 30.0 } else { 0.0 };
        let better = match best {
            None => true,
            Some((bs, bi, _, _)) => score < bs - SCORE_EPS || ((score - bs).abs() <= SCORE_EPS && seg.id < segments[bi].id),
        };
        if better {
            best = Some((score, entry.seg, projection.measure, named));
        }
        if named {
            let better_named = match best_named {
                None => true,
                Some((bs, bi, _, _)) => score < bs - SCORE_EPS || ((score - bs).abs() <= SCORE_EPS && seg.id < segments[bi].id),
            };
            if better_named {
                best_named = Some((score, entry.seg, projection.measure, true));
            }
        }
    }
    if let (Some((_, bi, _, false)), Some(_)) = (best, best_named) {
        if segments[bi].cls == RoadClass::Connector {
            best = best_named;
            diag.kept_from_paths += 1;
        }
    }
    if let Some((_, si, measure, _)) = best {
        house.parent = Some(segments[si].id.clone());
        house.measure = Some((measure * 10.0 + 0.5).floor() / 10.0);
    }
    house
}

/// Step 5b: houses on a footway/path whose address names a street nearby: that street takes them along when it is marked.
pub(super) fn link_path_houses(houses: &mut [House], segments: &[Segment], frame: &Frame, seg_grid: &mut Grid, indexed: &[Indexed], diag: &mut Diagnostics) {
    let mut scratch: Vec<u32> = Vec::new();
    {
        let by_id: HashMap<&str, usize> = segments.iter().enumerate().map(|(i, s)| (s.id.as_str(), i)).collect();
        for house in houses.iter_mut() {
            let Some(p) = &house.parent else { continue };
            if segments[by_id[p.as_str()]].cls != RoadClass::Connector {
                continue;
            }
            let wanted = normalize_name(house.street.as_deref());
            if wanted.is_empty() {
                continue;
            }
            let [cx, cy] = frame.to_xy(house.center);
            let reach = MAX_STREET_LINK_DISTANCE;
            seg_grid.search([cx - reach, cy - reach, cx + reach, cy + reach], &mut scratch);
            let mut best: Option<(f64, usize)> = None;
            for &gid in scratch.iter() {
                let entry = &indexed[gid as usize];
                let seg = &segments[entry.seg];
                if entry.norm != wanted || seg.cls == RoadClass::Connector {
                    continue;
                }
                let d = project_to_polyline(&entry.xy, [cx, cy]).distance;
                if d > reach {
                    continue;
                }
                let better = match best {
                    None => true,
                    Some((bd, bi)) => d < bd - SCORE_EPS || ((d - bd).abs() <= SCORE_EPS && seg.id < segments[bi].id),
                };
                if better {
                    best = Some((d, entry.seg));
                }
            }
            if let Some((_, si)) = best {
                house.street_parent = Some(segments[si].id.clone());
                diag.linked_from_paths += 1;
            }
        }
    }
}
