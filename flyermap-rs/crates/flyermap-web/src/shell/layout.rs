//! One map, two layouts. From 900 px wide the Studio is a column next to the map; below it the Studio is a sheet like everything else.

pub const WIDE_MIN_PX: f64 = 900.0;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Layout {
    /// A phone: full-screen map, sheets from below.
    #[default]
    Compact,
    /// A tablet or desktop: the Studio column and the map.
    Wide,
}

impl Layout {
    pub fn as_str(self) -> &'static str {
        match self {
            Layout::Compact => "compact",
            Layout::Wide => "wide",
        }
    }
}

pub fn layout_for(width: f64) -> Layout {
    if width >= WIDE_MIN_PX {
        Layout::Wide
    } else {
        Layout::Compact
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_studio_column_starts_at_900_px() {
        assert_eq!(layout_for(390.0), Layout::Compact);
        assert_eq!(layout_for(899.5), Layout::Compact);
        assert_eq!(layout_for(900.0), Layout::Wide);
        assert_eq!(layout_for(1280.0).as_str(), "wide");
    }
}
