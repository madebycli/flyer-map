//! What the points tapped so far make: not enough yet (what to do next), a Gebiet that is ready to be saved, or something that does not work (and what to
//! do about it). The geometry is `flyermap_area`'s (snapping, connected drawing, splitting, the checks); this joins it to the tool and says it in German. Pure.
use super::{
    hints::{area_text, explain, next_step, start_off_border},
    state::{Draw, Kind},
};
use flyermap_area::{area_m2, check, close, connect, open, split, LngLat, Mode, Ring};
use flyermap_identity::Art;

/// The Gebiete the drawing happens among, in one order (the area crate counts by position).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Areas {
    pub ids: Vec<String>,
    pub names: Vec<String>,
    pub rings: Vec<Ring>,
    pub art: Vec<Art>,
    /// What the person may change (the server still decides).
    pub changeable: Vec<bool>,
}

impl Areas {
    pub fn index_of(&self, id: &str) -> Option<usize> {
        self.ids.iter().position(|i| i == id)
    }
}

/// The kinds of drawing this person can use among these Gebiete: an outline of their own whenever they may draw at all, along a border only where a Gebiet may be
/// changed, cutting only a main area of an Aktion that collects.
pub fn kinds_for(areas: &Areas, may_draw_new: bool, collecting: bool) -> Vec<Kind> {
    let any = areas.changeable.iter().any(|c| *c);
    let any_main = areas.changeable.iter().zip(&areas.art).any(|(c, a)| *c && *a == Art::Abholen);
    Kind::ALL
        .into_iter()
        .filter(|k| match k {
            Kind::Free => may_draw_new,
            Kind::Connect => may_draw_new && any,
            Kind::Extend => any,
            Kind::Split => collecting && any_main,
        })
        .collect()
}

/// A drawing that can be saved.
#[derive(Clone, Debug, PartialEq)]
pub struct Ready {
    pub kind: Kind,
    /// The outline drawn: a new Gebiet, or the grown one (`Kind::Extend`, then `creates` is false).
    pub ring: Ring,
    pub creates: bool,
    /// Existing Gebiete that change with it, by position in [`Areas`]: the neighbour that got two corners, the grown one, the main area that keeps the larger piece.
    pub changed: Vec<(usize, Ring)>,
    /// How big the outline is: `ca. 2,4 ha`.
    pub size: String,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Verdict {
    /// Not finished: what to do next.
    Next(String),
    Ready(Ready),
    /// It does not work as drawn: why, and what to do.
    Bad(String),
}

fn ccw(ring: &[LngLat]) -> Ring {
    let pts = open(ring);
    let frame = flyermap_area::frame::Frame::around(&pts);
    let twice: f64 = (0..pts.len())
        .map(|i| {
            let (a, b) = (frame.xy(pts[i]), frame.xy(pts[(i + 1) % pts.len()]));
            a[0] * b[1] - b[0] * a[1]
        })
        .sum();
    let mut out = pts;
    if twice < 0.0 {
        out.reverse();
    }
    close(&out)
}

fn ready(kind: Kind, ring: Ring, creates: bool, changed: Vec<(usize, Ring)>) -> Verdict {
    let size = area_text(area_m2(&ring));
    Verdict::Ready(Ready { kind, ring, creates, changed, size })
}

fn along_border(draw: &Draw, areas: &Areas) -> Verdict {
    let hint = |n| next_step(draw.kind, n, draw.target.as_deref().and_then(|t| areas.index_of(t).map(|i| areas.names[i].as_str())));
    let n = draw.points.len();
    let Some(first) = draw.first_border() else { return if n == 0 { Verdict::Next(hint(0)) } else { Verdict::Bad(start_off_border()) } };
    let (Some(end), true) = (draw.last_border(), n >= 2) else { return Verdict::Next(hint(n)) };
    let path: Vec<LngLat> = draw.points[1..n - 1].iter().map(|p| p.at).collect();
    let result = match draw.kind {
        Kind::Connect | Kind::Extend => {
            let mode = if draw.kind == Kind::Connect { Mode::New } else { Mode::Extend };
            connect(&areas.rings, first, &path, end, mode).map(|o| match o.replaces {
                Some(i) => (false, o.ring.clone(), vec![(i, o.ring)]),
                None => (true, o.ring, o.touched),
            })
        }
        _ => match areas.rings.get(first.area) {
            Some(main) if areas.art.get(first.area) == Some(&Art::Abholen) => {
                split(main, first, &path, end).map(|(small, large)| (true, small, vec![(first.area, large)]))
            }
            Some(_) => return Verdict::Bad("Teilen geht nur bei einem Hauptgebiet zum Abholen.".into()),
            None => return Verdict::Bad(explain(&flyermap_area::DrawError::UnknownArea(first.area), draw.kind, &areas.names)),
        },
    };
    match result {
        Ok((creates, ring, changed)) => {
            if let Some((i, _)) = changed.iter().find(|(i, _)| !areas.changeable.get(*i).copied().unwrap_or(false)) {
                return Verdict::Bad(format!("Du darfst „{}“ nicht verändern.", areas.names.get(*i).map_or("dieses Gebiet", String::as_str)));
            }
            ready(draw.kind, ring, creates, changed)
        }
        Err(e) => Verdict::Bad(explain(&e, draw.kind, &areas.names)),
    }
}

fn free(draw: &Draw, areas: &Areas) -> Verdict {
    let n = draw.points.len();
    if n < 3 {
        return Verdict::Next(next_step(Kind::Free, n, None));
    }
    let ring = ccw(&draw.positions());
    match check(&ring, &areas.rings) {
        Ok(()) => ready(Kind::Free, ring, true, Vec::new()),
        Err(e) => Verdict::Bad(explain(&e, Kind::Free, &areas.names)),
    }
}

/// What the drawing is now.
pub fn evaluate(draw: &Draw, areas: &Areas) -> Verdict {
    if draw.kind == Kind::Free {
        free(draw, areas)
    } else {
        along_border(draw, areas)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drawing::state::{DrawAction, Reach};

    const REACH: Reach = Reach { border_m: 20.0, corner_m: 6.0 };

    fn square(x: f64, y: f64, size: f64) -> Ring {
        vec![[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]
    }

    fn areas(art: Art) -> Areas {
        Areas {
            ids: vec!["a".into(), "b".into()],
            names: vec!["Altstadt".into(), "Hafen".into()],
            rings: vec![square(13.0, 51.0, 0.004), square(13.01, 51.0, 0.004)],
            art: vec![art, art],
            changeable: vec![true, false],
        }
    }

    fn drawn(kind: Kind, taps: &[LngLat], areas: &Areas) -> Draw {
        let mut d = Draw::new(kind, None);
        for at in taps {
            d.reduce(DrawAction::Tap { at: *at, reach: REACH }, &areas.rings, None);
        }
        d
    }

    #[test]
    fn the_kinds_follow_what_the_person_may_do() {
        let a = areas(Art::Austeilen);
        assert_eq!(kinds_for(&a, true, false), [Kind::Free, Kind::Connect, Kind::Extend]);
        assert_eq!(kinds_for(&a, false, false), [Kind::Extend], "a helper of one Gebiet may grow it but not start another");
        let main = areas(Art::Abholen);
        assert_eq!(kinds_for(&main, true, true), Kind::ALL);
        let nothing = Areas { changeable: vec![false, false], ..areas(Art::Austeilen) };
        assert_eq!(kinds_for(&nothing, true, false), [Kind::Free]);
        assert!(kinds_for(&nothing, false, false).is_empty());
    }

    #[test]
    fn a_free_outline_needs_three_corners_and_then_it_is_ready_with_its_size() {
        let a = areas(Art::Austeilen);
        assert!(matches!(evaluate(&drawn(Kind::Free, &[], &a), &a), Verdict::Next(_)));
        assert!(matches!(evaluate(&drawn(Kind::Free, &[[13.02, 51.0], [13.022, 51.0]], &a), &a), Verdict::Next(t) if t.contains("eine Ecke")));
        let v = evaluate(&drawn(Kind::Free, &[[13.02, 51.0], [13.022, 51.0], [13.022, 51.002]], &a), &a);
        let Verdict::Ready(r) = v else { panic!("{v:?}") };
        assert!(r.creates && r.changed.is_empty() && r.size.starts_with("ca."), "{r:?}");
        assert_eq!(r.ring.first(), r.ring.last(), "closed");
    }

    #[test]
    fn a_clockwise_outline_is_stored_counter_clockwise() {
        let a = areas(Art::Austeilen);
        let Verdict::Ready(r) = evaluate(&drawn(Kind::Free, &[[13.02, 51.0], [13.02, 51.002], [13.022, 51.002], [13.022, 51.0]], &a), &a) else { panic!() };
        assert_eq!(r.ring, ccw(&r.ring));
    }

    #[test]
    fn a_free_outline_over_a_neighbour_says_which() {
        let a = areas(Art::Austeilen);
        let v = evaluate(&drawn(Kind::Free, &[[13.001, 51.001], [13.003, 51.001], [13.003, 51.003]], &a), &a);
        assert!(matches!(&v, Verdict::Bad(t) if t.contains("„Altstadt“")), "{v:?}");
        let crossing = evaluate(&drawn(Kind::Free, &[[13.02, 51.0], [13.024, 51.002], [13.024, 51.0], [13.02, 51.002]], &a), &a);
        assert!(matches!(&crossing, Verdict::Bad(t) if t.contains("kreuzt")), "{crossing:?}");
    }

    #[test]
    fn connecting_starts_on_a_border_goes_around_and_ends_on_it_again() {
        let a = areas(Art::Austeilen);
        // along the right edge of the first square (x = 13.004): out to the right and back
        let start_off = evaluate(&drawn(Kind::Connect, &[[13.007, 51.001]], &a), &a);
        assert!(matches!(start_off, Verdict::Bad(t) if t.contains("nicht auf einer Grenze")));
        let going = evaluate(&drawn(Kind::Connect, &[[13.004, 51.001], [13.006, 51.001]], &a), &a);
        assert!(matches!(&going, Verdict::Next(t) if t.contains("zum Schluss")), "{going:?}");
        let v = evaluate(&drawn(Kind::Connect, &[[13.004, 51.001], [13.0055, 51.001], [13.0055, 51.003], [13.004, 51.003]], &a), &a);
        let Verdict::Ready(r) = v else { panic!("{v:?}") };
        assert!(r.creates && r.changed.len() == 1 && r.changed[0].0 == 0, "the neighbour gets the two ends as corners: {r:?}");
    }

    #[test]
    fn extending_grows_the_gebiet_and_needs_the_right_to_change_it() {
        let a = areas(Art::Austeilen);
        let v = evaluate(&drawn(Kind::Extend, &[[13.004, 51.001], [13.0055, 51.001], [13.0055, 51.003], [13.004, 51.003]], &a), &a);
        let Verdict::Ready(r) = v else { panic!("{v:?}") };
        assert!(!r.creates && r.changed[0].0 == 0 && r.ring == r.changed[0].1);
        // the second square is one the person may not change
        let other = evaluate(&drawn(Kind::Extend, &[[13.014, 51.001], [13.0155, 51.001], [13.0155, 51.003], [13.014, 51.003]], &a), &a);
        assert!(matches!(&other, Verdict::Bad(t) if t.contains("nicht verändern")), "{other:?}");
    }

    #[test]
    fn splitting_cuts_a_main_area_and_only_a_main_area() {
        let a = areas(Art::Abholen);
        let cut = [[13.002, 51.0], [13.002, 51.002], [13.002, 51.004]];
        let v = evaluate(&drawn(Kind::Split, &[cut[0], cut[1], cut[2]], &a), &a);
        let Verdict::Ready(r) = v else { panic!("{v:?}") };
        assert!(r.creates && r.changed.len() == 1, "a new piece, and the main area keeps the other: {r:?}");
        let handing_out = areas(Art::Austeilen);
        assert!(
            matches!(evaluate(&drawn(Kind::Split, &cut, &handing_out), &handing_out), Verdict::Bad(t) if t.contains("hauptgebiet") || t.contains("Hauptgebiet"))
        );
    }
}
