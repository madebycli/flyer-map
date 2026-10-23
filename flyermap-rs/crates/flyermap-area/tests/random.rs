//! Random Gebiete and strokes (fixed seed): whatever is accepted keeps the invariants.
use flyermap_area::{check, close, connect, open, split, within, BorderPoint, Mode, Ring};

/// Plane area in degrees² (one frame for every shape, so pieces add up exactly; `area_m2` centres its projection on each shape).
fn area_m2(ring: &Ring) -> f64 {
    // around (13, 51): on raw degrees the products are near 663 and cancel away the last nine digits
    let p: Vec<[f64; 2]> = open(ring).iter().map(|q| [q[0] - 13.0, q[1] - 51.0]).collect();
    (0..p.len()).map(|i| p[i][0] * p[(i + 1) % p.len()][1] - p[(i + 1) % p.len()][0] * p[i][1]).sum::<f64>().abs() / 2.0
}

struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (self.0 >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// A star-shaped Gebiet around (13.0, 51.0): corners at random radii, in angle order.
fn gebiet(r: &mut Lcg) -> Ring {
    let n = 4 + (r.next() * 9.0) as usize;
    let points: Vec<[f64; 2]> = (0..n)
        .map(|i| {
            let angle = (i as f64 + 0.2 + r.next() * 0.6) / n as f64 * std::f64::consts::TAU;
            let radius = 0.004 + r.next() * 0.004;
            [13.0 + radius * angle.cos() / 0.63, 51.0 + radius * angle.sin()]
        })
        .collect();
    close(&points)
}

fn border(r: &mut Lcg, n: usize) -> BorderPoint {
    BorderPoint { area: 0, edge: (r.next() * n as f64) as usize % n, t: if r.next() < 0.2 { 0.0 } else { 0.05 + r.next() * 0.9 } }
}

#[test]
fn accepted_drawings_keep_the_invariants() {
    let mut r = Lcg(59);
    let (mut connected, mut splits) = (0, 0);
    for _ in 0..3000 {
        let old = gebiet(&mut r);
        let n = open(&old).len();
        let (start, end) = (border(&mut r, n), border(&mut r, n));
        // a stroke well outside: two points far out in the direction of the two ends
        let out = |b: &BorderPoint, k: f64| {
            let p = b.position(&open(&old));
            [13.0 + (p[0] - 13.0) * k, 51.0 + (p[1] - 51.0) * k]
        };
        let path = [out(&start, 1.6), out(&end, 1.6)];
        if let Ok(new) = connect(std::slice::from_ref(&old), start, &path, end, Mode::New) {
            connected += 1;
            let grown = connect(std::slice::from_ref(&old), start, &path, end, Mode::Extend).unwrap();
            let (a, b, g) = (area_m2(&old), area_m2(&new.ring), area_m2(&grown.ring));
            assert!((a + b - g).abs() <= 1e-9 * g, "old + piece = grown: {a} + {b} vs {g}");
            assert_eq!(check(&new.ring, &[new.touched[0].1.clone()]), Ok(()), "the piece only touches the old Gebiet");
        }
        // a cut inside: through a point near the centre
        if let Ok((small, large)) = split(&old, start, &[[13.0 + (r.next() - 0.5) * 0.001, 51.0 + (r.next() - 0.5) * 0.001]], end) {
            splits += 1;
            assert!(
                (area_m2(&small) + area_m2(&large) - area_m2(&old)).abs() <= 1e-9 * area_m2(&old),
                "split: {start:?} {end:?}\n old {old:?}\n small {small:?}\n large {large:?}"
            );
            assert_eq!(check(&small, std::slice::from_ref(&large)), Ok(()));
            assert!(
                within(&small, &old) && within(&large, &old),
                "each piece of a split lies inside the whole\n old {old:?}\n small {small:?}\n large {large:?}"
            );
            assert!(!within(&old, &small), "the whole is not inside a piece");
        }
    }
    assert!(connected > 1000 && splits > 1000, "enough accepted cases to mean something: {connected} connected, {splits} splits");
}
