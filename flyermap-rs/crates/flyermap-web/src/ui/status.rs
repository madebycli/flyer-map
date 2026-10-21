//! How a status looks and is called (port of `src/v5/app/labels.ts` and the status colours of `src/v5/map/fieldMap.ts`). One place, so the map
//! and every screen say and paint the same.
use super::icon::IconName;
use crate::platform::Theme;
use flyermap_core::Status;

/// Handing out or collecting: the words for "done" differ.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Kind {
    #[default]
    Distribution,
    Collection,
}

/// The order of buttons and counters on screen (done first, open last).
pub const ORDER: [Status; 4] = [Status::Completed, Status::Later, Status::NotDeliverable, Status::Open];

pub fn label(kind: Kind, status: Status) -> &'static str {
    match (status, kind) {
        (Status::Open, _) => "Offen",
        (Status::Completed, Kind::Distribution) => "Ausgeteilt",
        (Status::Completed, Kind::Collection) => "Abgeholt",
        (Status::Later, _) => "Später",
        (Status::NotDeliverable, _) => "Nicht möglich",
    }
}

pub fn icon(status: Status) -> IconName {
    match status {
        Status::Open => IconName::Open,
        Status::Completed => IconName::Check,
        Status::Later => IconName::Later,
        Status::NotDeliverable => IconName::Blocked,
    }
}

/// Calm, desaturated and still four distinct states; the light theme uses deeper variants for contrast.
pub fn color(theme: Theme, status: Status) -> &'static str {
    match (theme, status) {
        (Theme::Dark, Status::Open) => "#8aa0b4",
        (Theme::Dark, Status::Completed) => "#5fc79f",
        (Theme::Dark, Status::Later) => "#d6b062",
        (Theme::Dark, Status::NotDeliverable) => "#c9808c",
        (Theme::Light, Status::Open) => "#6c7f92",
        (Theme::Light, Status::Completed) => "#2c9873",
        (Theme::Light, Status::Later) => "#b4872b",
        (Theme::Light, Status::NotDeliverable) => "#b05b6b",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_status_is_in_the_order_once() {
        for s in Status::ALL {
            assert_eq!(ORDER.iter().filter(|o| **o == s).count(), 1);
        }
        assert_eq!(label(Kind::Collection, Status::Completed), "Abgeholt");
        assert_eq!(label(Kind::Distribution, Status::NotDeliverable), "Nicht möglich");
    }
}
