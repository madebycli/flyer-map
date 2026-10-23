//! What the drawing tool remembers: the kind of drawing, which Gebiet it is aimed at, and the points tapped so far. Pure: one reducer, native tests. A point
//! that lies on the border of a Gebiet is snapped to it when it is tapped (`flyermap_area::snap`), so a drawing that starts or ends on a border does so exactly.
use flyermap_area::{snap, BorderPoint, LngLat, Ring};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Kind {
    /// An outline of its own: tap its corners.
    #[default]
    Free,
    /// A new Gebiet that takes the border of a neighbour: from its border, around, back to the same border.
    Connect,
    /// The same stroke, but the neighbour grows by the piece.
    Extend,
    /// Cut a main area (Abholen) in two.
    Split,
}

impl Kind {
    pub const ALL: [Kind; 4] = [Kind::Free, Kind::Connect, Kind::Extend, Kind::Split];

    pub fn label(self) -> &'static str {
        match self {
            Kind::Free => "Neu",
            Kind::Connect => "Anschließen",
            Kind::Extend => "Erweitern",
            Kind::Split => "Teilen",
        }
    }

    /// `data-kind` of the browser flows.
    pub fn key(self) -> &'static str {
        match self {
            Kind::Free => "free",
            Kind::Connect => "connect",
            Kind::Extend => "extend",
            Kind::Split => "split",
        }
    }

    /// Connecting, extending and splitting start and end on a border.
    pub fn on_border(self) -> bool {
        !matches!(self, Kind::Free)
    }
}

/// How far from a border a tap still counts for it: a finger's width, in metres at the zoom the map is at.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Reach {
    pub border_m: f64,
    pub corner_m: f64,
}

const BORDER_PX: f64 = 22.0;
const CORNER_PX: f64 = 12.0;

/// Metres one pixel stands for at `zoom` and `lat` (web mercator, 512 px tiles as MapLibre draws them).
pub fn metres_per_pixel(zoom: f64, lat: f64) -> f64 {
    40_075_016.686 * lat.to_radians().cos() / (512.0 * 2f64.powf(zoom))
}

impl Reach {
    pub fn at(zoom: f64, lat: f64) -> Reach {
        let m = metres_per_pixel(zoom, lat);
        Reach { border_m: BORDER_PX * m, corner_m: CORNER_PX * m }
    }
}

/// One tapped point: where it is and, if it lies on a border, which one.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub at: LngLat,
    pub border: Option<BorderPoint>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Draw {
    pub kind: Kind,
    /// The Gebiet the drawing is aimed at (by id): started from its sheet. Its border is the only one that counts.
    pub target: Option<String>,
    /// The Gruppe the new Gebiet is meant for (started from its sheet); the save sheet offers it first.
    pub gruppe: Option<String>,
    pub points: Vec<Point>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum DrawAction {
    /// A tap at a position, with how far a border reaches at the zoom the map is at.
    Tap {
        at: LngLat,
        reach: Reach,
    },
    Undo,
    Clear,
    SetKind(Kind),
}

impl Draw {
    pub fn new(kind: Kind, target: Option<String>) -> Draw {
        Draw { kind, target, gruppe: None, points: Vec::new() }
    }

    pub fn is_empty(&self) -> bool {
        self.points.is_empty()
    }

    /// The tapped positions, for the line on the map.
    pub fn positions(&self) -> Vec<LngLat> {
        self.points.iter().map(|p| p.at).collect()
    }

    pub fn first_border(&self) -> Option<BorderPoint> {
        self.points.first().and_then(|p| p.border)
    }

    pub fn last_border(&self) -> Option<BorderPoint> {
        self.points.last().and_then(|p| p.border)
    }

    /// `areas` are the rings of the Gebiete; `target_index` the position of the target among them.
    pub fn reduce(&mut self, action: DrawAction, areas: &[Ring], target_index: Option<usize>) {
        match action {
            DrawAction::Tap { at, reach } => {
                let point = if self.kind.on_border() {
                    let s = snap(at, areas, reach.border_m, reach.corner_m);
                    // only the border of the target counts, when there is one
                    let border = s.border.filter(|b| target_index.is_none_or(|t| b.area == t));
                    Point { at: if border.is_some() { s.point } else { at }, border }
                } else {
                    Point { at, border: None }
                };
                self.points.push(point);
            }
            DrawAction::Undo => {
                self.points.pop();
            }
            DrawAction::Clear => self.points.clear(),
            DrawAction::SetKind(kind) => {
                if kind != self.kind {
                    self.kind = kind;
                    self.points.clear();
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square() -> Ring {
        vec![[13.0, 51.0], [13.002, 51.0], [13.002, 51.002], [13.0, 51.002], [13.0, 51.0]]
    }

    fn near() -> Reach {
        Reach { border_m: 20.0, corner_m: 8.0 }
    }

    #[test]
    fn a_free_drawing_keeps_the_points_where_they_were_tapped() {
        let mut d = Draw::new(Kind::Free, None);
        d.reduce(DrawAction::Tap { at: [13.0, 51.00001], reach: near() }, &[square()], None);
        assert_eq!(d.points[0], Point { at: [13.0, 51.00001], border: None }, "free points do not snap, even next to a border");
        d.reduce(DrawAction::Undo, &[square()], None);
        assert!(d.is_empty());
    }

    #[test]
    fn a_tap_on_a_border_snaps_to_it_when_connecting() {
        let mut d = Draw::new(Kind::Connect, None);
        // about 6 m below the bottom edge, in the middle: on the edge after snapping
        d.reduce(DrawAction::Tap { at: [13.001, 50.99995], reach: near() }, &[square()], None);
        let border = d.points[0].border.expect("snapped");
        assert_eq!((border.area, border.edge), (0, 0));
        assert_eq!(d.points[0].at[1], 51.0, "the point lies on the edge now");
        d.reduce(DrawAction::Tap { at: [13.001, 50.99], reach: near() }, &[square()], None);
        assert_eq!(d.points[1].border, None, "far away: a plain corner");
    }

    #[test]
    fn only_the_border_of_the_target_counts() {
        let other: Ring = vec![[13.01, 51.0], [13.012, 51.0], [13.012, 51.002], [13.01, 51.002], [13.01, 51.0]];
        let areas = [square(), other];
        let mut aimed_at_second = Draw::new(Kind::Extend, Some("b".into()));
        aimed_at_second.reduce(DrawAction::Tap { at: [13.001, 50.99995], reach: near() }, &areas, Some(1));
        assert_eq!(aimed_at_second.points[0].border, None, "the first square's border is not the target's");
        let mut free_choice = Draw::new(Kind::Extend, None);
        free_choice.reduce(DrawAction::Tap { at: [13.001, 50.99995], reach: near() }, &areas, None);
        assert!(free_choice.points[0].border.is_some());
    }

    #[test]
    fn another_kind_starts_over_and_the_same_kind_keeps_the_points() {
        let mut d = Draw::new(Kind::Free, None);
        d.reduce(DrawAction::Tap { at: [13.1, 51.1], reach: near() }, &[], None);
        d.reduce(DrawAction::SetKind(Kind::Free), &[], None);
        assert_eq!(d.points.len(), 1);
        d.reduce(DrawAction::SetKind(Kind::Connect), &[], None);
        assert!(d.is_empty());
        assert_eq!(d.kind, Kind::Connect);
    }

    #[test]
    fn the_reach_grows_when_the_map_is_zoomed_out() {
        let (near_m, far_m) = (Reach::at(18.0, 51.0), Reach::at(14.0, 51.0));
        assert!(far_m.border_m > near_m.border_m * 15.0);
        assert!((metres_per_pixel(17.0, 51.0) - 0.376).abs() < 0.01, "{}", metres_per_pixel(17.0, 51.0));
    }
}
