//! Steps 1 to 3: keep the ways that can be streets, find the junctions, cut the ways at them and into chunks of about ten metres.
use super::*;

pub(super) fn candidate_ways<'a>(raw: &'a RawOsm, diag: &mut Diagnostics) -> Vec<(&'a RawWay, RoadClass)> {
    let mut ways: Vec<(&RawWay, RoadClass)> = Vec::new();
    for way in &raw.ways {
        if way.coords.len() < 2 {
            bump(&mut diag.ways_excluded, "degenerate".into());
            continue;
        }
        match classify_road(&way.tags) {
            Ok(cls) => ways.push((way, cls)),
            Err(reason) => bump(&mut diag.ways_excluded, reason),
        }
    }
    ways.sort_by_key(|(w, _)| w.id);
    ways
}

pub(super) fn split_ways(ways: &[(&RawWay, RoadClass)]) -> Vec<Segment> {
    // 2. junctions: a vertex visited by >= 2 distinct (way, position) visits
    let mut visits: HashMap<String, u32> = HashMap::default();
    for (way, _) in ways.iter() {
        for i in 0..way.coords.len() {
            *visits.entry(vertex_key(way, i)).or_insert(0) += 1;
        }
    }

    // 3. split at endpoints and junctions, then into chunks
    let mut segments: Vec<Segment> = Vec::new();
    let mut used_ids: HashSet<String> = HashSet::default();
    for (way, cls) in ways.iter() {
        let mut start = 0usize;
        for i in 1..way.coords.len() {
            let last = i == way.coords.len() - 1;
            if !last && visits.get(&vertex_key(way, i)).copied().unwrap_or(0) < 2 {
                continue;
            }
            let coords = &way.coords[start..=i];
            let local = frame_for(coords.iter());
            let length = polyline_length(&local, coords);
            if length >= 0.5 {
                let start_key = match way.nodes.as_ref().and_then(|n| n.get(start)) {
                    Some(node) => format!("{}:{}", way.id, node),
                    None => format!("{}#{}", way.id, start),
                };
                let mut id = format!("s{start_key}");
                if used_ids.contains(&id) {
                    id = format!("{id}#{start}");
                }
                used_ids.insert(id.clone());
                let parts = ((length / CHUNK_METERS - 0.02).ceil().max(1.0)) as usize;
                let pieces = split_equal(&local, coords, parts);
                let from_key = vertex_key(way, start);
                let to_key = vertex_key(way, i);
                let name = non_empty(trimmed(&way.tags, "name"));
                let reference = non_empty(trimmed(&way.tags, "ref"));
                let highway = way.tags.get("highway").cloned().unwrap_or_default();
                for (k, piece) in pieces.into_iter().enumerate() {
                    segments.push(Segment {
                        id: if parts == 1 { id.clone() } else { format!("{id}~{k}") },
                        group: id.clone(),
                        chunk: k as u32,
                        chunks: parts as u32,
                        way_id: way.id,
                        name: name.clone(),
                        reference: reference.clone(),
                        highway: highway.clone(),
                        cls: *cls,
                        coords: piece,
                        length: length / parts as f64,
                        from: if k == 0 { from_key.clone() } else { format!("{id}@{k}") },
                        to: if k == parts - 1 { to_key.clone() } else { format!("{id}@{}", k + 1) },
                        house_count: 0,
                        visible: false,
                    });
                }
            }
            start = i;
        }
    }
    segments
}
