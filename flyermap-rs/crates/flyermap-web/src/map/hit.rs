//! What a finger touches, in screen pixels (port of the hit tests of `src/v5/map/fieldMap.ts`): the drawn geometry comes from the bridge already
//! projected, so what is painted under the finger is what is marked. Pure, tested natively.
use serde::Deserialize;

pub type P2 = [f64; 2];

/// A rendered feature from `bridge::query`: its key, its layer, its kind (`p` point, `l` line, `a` area) and its parts in screen px.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Drawn {
    pub id: String,
    pub layer: String,
    pub t: String,
    pub g: Vec<Vec<P2>>,
}

pub fn parse(json: &str) -> Vec<Drawn> {
    serde_json::from_str(json).unwrap_or_default()
}

pub fn dist_point_seg(p: P2, a: P2, b: P2) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let len2 = dx * dx + dy * dy;
    let t = if len2 == 0.0 { 0.0 } else { (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2).clamp(0.0, 1.0) };
    (p[0] - (a[0] + t * dx)).hypot(p[1] - (a[1] + t * dy))
}

fn cross(o: P2, a: P2, b: P2) -> f64 {
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

/// Distance between the segments a–b and c–d: 0 when they cross.
pub fn dist_seg_seg(a: P2, b: P2, c: P2, d: P2) -> f64 {
    if cross(a, b, c) * cross(a, b, d) < 0.0 && cross(c, d, a) * cross(c, d, b) < 0.0 {
        return 0.0;
    }
    dist_point_seg(a, c, d).min(dist_point_seg(b, c, d)).min(dist_point_seg(c, a, b)).min(dist_point_seg(d, a, b))
}

fn line_hit(line: &[P2], a: P2, b: P2, r: f64) -> bool {
    match line {
        [] => false,
        [p] => dist_point_seg(*p, a, b) <= r,
        _ => line.windows(2).any(|w| dist_seg_seg(a, b, w[0], w[1]) <= r),
    }
}

pub fn in_ring(p: P2, ring: &[P2]) -> bool {
    let mut inside = false;
    let mut j = ring.len().wrapping_sub(1);
    for i in 0..ring.len() {
        let ([xi, yi], [xj, yj]) = (ring[i], ring[j]);
        if (yi > p[1]) != (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// The stroke a–b with radius r touches the feature: a point within r, a line within r, an outline crossed or within r, or a stroke inside it.
pub fn touches(f: &Drawn, a: P2, b: P2, r: f64) -> bool {
    match f.t.as_str() {
        "p" => f.g.iter().flatten().any(|p| dist_point_seg(*p, a, b) <= r),
        "l" => f.g.iter().any(|l| line_hit(l, a, b, r)),
        "a" => f.g.iter().any(|ring| in_ring(a, ring) || in_ring(b, ring) || line_hit(ring, a, b, r)),
        _ => false,
    }
}

/// The id (without `s:`) of the street piece nearest to `p` within `halo` px, among drawn lines.
pub fn nearest_line(drawn: &[Drawn], p: P2, halo: f64) -> Option<String> {
    let mut best: Option<(f64, &str)> = None;
    for f in drawn.iter().filter(|f| f.t == "l") {
        for line in &f.g {
            let d = match line.as_slice() {
                [single] => dist_point_seg(p, *single, *single),
                _ => line.windows(2).map(|w| dist_point_seg(p, w[0], w[1])).fold(f64::INFINITY, f64::min),
            };
            if d <= halo && best.is_none_or(|(bd, _)| d < bd) {
                best = Some((d, f.id.as_str()));
            }
        }
    }
    best.and_then(|(_, id)| id.strip_prefix("s:").map(str::to_string))
}

/// The id (without `h:`) of a house outline that contains `p`.
pub fn house_at(drawn: &[Drawn], p: P2) -> Option<String> {
    drawn.iter().filter(|f| f.t == "a").find(|f| f.g.iter().any(|ring| in_ring(p, ring))).and_then(|f| f.id.strip_prefix("h:").map(str::to_string))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(id: &str, pts: &[P2]) -> Drawn {
        Drawn { id: id.into(), layer: "v5-segments-line".into(), t: "l".into(), g: vec![pts.to_vec()] }
    }
    fn square(id: &str, x: f64, y: f64, s: f64) -> Drawn {
        Drawn { id: id.into(), layer: "v5-houses-fill".into(), t: "a".into(), g: vec![vec![[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] }
    }

    #[test]
    fn distances() {
        assert_eq!(dist_point_seg([0.0, 5.0], [-10.0, 0.0], [10.0, 0.0]), 5.0);
        assert_eq!(dist_point_seg([20.0, 0.0], [-10.0, 0.0], [10.0, 0.0]), 10.0);
        assert_eq!(dist_seg_seg([0.0, -5.0], [0.0, 5.0], [-5.0, 0.0], [5.0, 0.0]), 0.0, "crossing");
        assert_eq!(dist_seg_seg([0.0, 3.0], [0.0, 5.0], [-5.0, 0.0], [5.0, 0.0]), 3.0);
    }

    #[test]
    fn a_stroke_touches_what_it_passes() {
        let house = square("h:1", 10.0, 10.0, 10.0);
        assert!(touches(&house, [0.0, 15.0], [30.0, 15.0], 1.0), "crosses the outline");
        assert!(touches(&house, [12.0, 12.0], [13.0, 13.0], 0.5), "inside");
        assert!(!touches(&house, [0.0, 0.0], [0.0, 30.0], 5.0));
        assert!(touches(&house, [0.0, 0.0], [0.0, 30.0], 10.0), "within the radius");
        let dot = Drawn { id: "h:2".into(), layer: "v5-houses-dots".into(), t: "p".into(), g: vec![vec![[50.0, 50.0]]] };
        assert!(touches(&dot, [40.0, 50.0], [45.0, 50.0], 5.0));
    }

    #[test]
    fn the_nearest_street_within_the_halo_wins() {
        let drawn = [line("s:a", &[[0.0, 0.0], [100.0, 0.0]]), line("s:b", &[[0.0, 10.0], [100.0, 10.0]])];
        assert_eq!(nearest_line(&drawn, [50.0, 7.0], 14.0).as_deref(), Some("b"));
        assert_eq!(nearest_line(&drawn, [50.0, 2.0], 14.0).as_deref(), Some("a"));
        assert_eq!(nearest_line(&drawn, [50.0, 40.0], 14.0), None);
        assert_eq!(house_at(&[square("h:9", 0.0, 0.0, 4.0)], [2.0, 2.0]).as_deref(), Some("9"));
    }

    #[test]
    fn the_bridge_json_is_read() {
        let d = parse(r#"[{"id":"s:1#0","layer":"v5-segments-line","t":"l","g":[[[1,2],[3,4]]]}]"#);
        assert_eq!(d[0].g[0][1], [3.0, 4.0]);
        assert!(parse("not json").is_empty());
    }
}
