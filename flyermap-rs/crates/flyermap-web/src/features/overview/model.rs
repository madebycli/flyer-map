//! What the overview shows, computed from `flyermap_core::Progress` snapshots: the whole Aktion, each Gebiet, each Gruppe.
use flyermap_core::{ProgressSnapshot, Status};

#[derive(Clone, Debug, PartialEq)]
pub struct AreaRow {
    pub id: String,
    pub name: String,
    pub snapshot: ProgressSnapshot,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TeamRow {
    pub name: String,
    pub color: String,
    pub snapshot: ProgressSnapshot,
}

#[derive(Clone, Debug, PartialEq)]
pub struct OverviewData {
    pub overall: ProgressSnapshot,
    pub areas: Vec<AreaRow>,
    pub teams: Vec<TeamRow>,
}

/// Progress counts houses: done / (all − not possible), whole percent. Nothing deliverable is 0 %.
pub fn percent_of(snapshot: &ProgressSnapshot) -> i64 {
    (snapshot.house_ratio * 100.0).round() as i64
}

/// Houses that count for the progress (all minus "not possible").
pub fn deliverable(snapshot: &ProgressSnapshot) -> i64 {
    snapshot.total_houses - snapshot.houses_with(Status::NotDeliverable)
}

/// A count as German text shows it (`toLocaleString('de')`): a dot every three digits.
pub fn de_number(n: i64) -> String {
    let digits = n.unsigned_abs().to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3 + 1);
    if n < 0 {
        out.push('-');
    }
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push('.');
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use flyermap_core::{Key, Progress};

    #[test]
    fn numbers_get_german_thousands_dots() {
        assert_eq!(de_number(0), "0");
        assert_eq!(de_number(999), "999");
        assert_eq!(de_number(1000), "1.000");
        assert_eq!(de_number(1234567), "1.234.567");
        assert_eq!(de_number(-4200), "-4.200");
    }

    #[test]
    fn not_possible_leaves_the_denominator() {
        let p = Progress::new(
            [
                Key::house("1"),
                Key::house("2"),
                Key::house("3"),
                Key::house("4"),
            ],
            [],
            [
                (Key::house("1"), Status::Completed),
                (Key::house("2"), Status::NotDeliverable),
            ],
        );
        let s = p.snapshot();
        assert_eq!(deliverable(&s), 3);
        assert_eq!(percent_of(&s), 33);
    }
}
