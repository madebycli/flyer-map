//! A stand-in for the map until the MapLibre bridge exists (M5): streets as lines and houses as small squares in their status colours, drawn
//! once as one SVG string (no node per house in the reactive tree, like the real map's rule of constant layer counts).
use crate::{platform::Theme, ui::status};
use flyermap_core::Status;
use std::fmt::Write;

/// The drawing's coordinate box (`viewBox`), scaled to cover the screen.
pub const SIZE: f64 = 1000.0;

#[derive(Clone, Debug, PartialEq)]
pub struct StreetLine {
    pub from: (f64, f64),
    pub to: (f64, f64),
    pub status: Status,
}

#[derive(Clone, Debug, PartialEq)]
pub struct HouseDot {
    pub at: (f64, f64),
    pub status: Status,
}

/// The SVG of the drawing (without the outer `<svg>`), coloured for the theme.
pub fn svg_markup(streets: &[StreetLine], houses: &[HouseDot], theme: Theme) -> String {
    let mut out = String::with_capacity(64 * (streets.len() + houses.len()));
    let casing = if theme == Theme::Dark {
        "#2a3432"
    } else {
        "#cfd9d5"
    };
    for s in streets {
        let _ = write!(
            out,
            r#"<line x1="{:.0}" y1="{:.0}" x2="{:.0}" y2="{:.0}" stroke="{casing}" stroke-width="22" stroke-linecap="round"/>"#,
            s.from.0, s.from.1, s.to.0, s.to.1
        );
        let _ = write!(
            out,
            r#"<line x1="{:.0}" y1="{:.0}" x2="{:.0}" y2="{:.0}" stroke="{}" stroke-width="7" stroke-linecap="round"/>"#,
            s.from.0,
            s.from.1,
            s.to.0,
            s.to.1,
            status::color(theme, s.status)
        );
    }
    for h in houses {
        let _ = write!(
            out,
            r#"<rect x="{:.0}" y="{:.0}" width="20" height="16" rx="4" fill="{}"/>"#,
            h.at.0 - 10.0,
            h.at.1 - 8.0,
            status::color(theme, h.status)
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_shape_per_house_and_two_per_street_in_the_status_colour() {
        let streets = [StreetLine {
            from: (0.0, 0.0),
            to: (100.0, 0.0),
            status: Status::Completed,
        }];
        let houses = [
            HouseDot {
                at: (50.0, 20.0),
                status: Status::Later,
            },
            HouseDot {
                at: (70.0, 20.0),
                status: Status::Open,
            },
        ];
        let svg = svg_markup(&streets, &houses, Theme::Dark);
        assert_eq!(svg.matches("<line").count(), 2);
        assert_eq!(svg.matches("<rect").count(), 2);
        assert!(svg.contains(status::color(Theme::Dark, Status::Later)));
        assert!(svg.contains(r#"x="40" y="12""#));
    }
}
