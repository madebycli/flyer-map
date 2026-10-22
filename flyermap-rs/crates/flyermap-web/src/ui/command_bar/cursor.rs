//! Which result the keyboard is on. Pure: the arrow keys move it, Enter takes it (the first one when none was chosen), a new list starts it over.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    Down,
    Up,
    First,
    Last,
}

/// The active row after `step`, in a list of `len` rows. Down and Up wrap around; an empty list has no active row.
pub fn step(active: Option<usize>, len: usize, step: Step) -> Option<usize> {
    if len == 0 {
        return None;
    }
    Some(match (step, active) {
        (Step::First, _) | (Step::Down, None) => 0,
        (Step::Last, _) | (Step::Up, None) => len - 1,
        (Step::Down, Some(i)) => (i + 1) % len,
        (Step::Up, Some(i)) => (i + len - 1) % len,
    })
}

/// The row Enter takes: the active one, else the first.
pub fn enter(active: Option<usize>, len: usize) -> Option<usize> {
    match active {
        Some(i) if i < len => Some(i),
        _ if len > 0 => Some(0),
        _ => None,
    }
}

/// The key of the keyboard to the step it means, if any.
pub fn step_for(key: &str) -> Option<Step> {
    match key {
        "ArrowDown" => Some(Step::Down),
        "ArrowUp" => Some(Step::Up),
        "Home" => Some(Step::First),
        "End" => Some(Step::Last),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_arrows_walk_the_list_and_wrap() {
        assert_eq!(step(None, 3, Step::Down), Some(0));
        assert_eq!(step(Some(0), 3, Step::Down), Some(1));
        assert_eq!(step(Some(2), 3, Step::Down), Some(0), "past the end it starts again");
        assert_eq!(step(None, 3, Step::Up), Some(2));
        assert_eq!(step(Some(0), 3, Step::Up), Some(2));
        assert_eq!((step(Some(1), 3, Step::First), step(Some(1), 3, Step::Last)), (Some(0), Some(2)));
    }

    #[test]
    fn an_empty_list_has_nothing_to_be_on() {
        for s in [Step::Down, Step::Up, Step::First, Step::Last] {
            assert_eq!(step(Some(0), 0, s), None);
        }
        assert_eq!(enter(None, 0), None);
    }

    #[test]
    fn enter_takes_the_active_row_else_the_first() {
        assert_eq!(enter(Some(2), 4), Some(2));
        assert_eq!(enter(None, 4), Some(0));
        assert_eq!(enter(Some(9), 4), Some(0), "an index from an older, longer list does not count");
    }

    #[test]
    fn only_the_walking_keys_are_steps() {
        assert_eq!(step_for("ArrowDown"), Some(Step::Down));
        assert_eq!(step_for("End"), Some(Step::Last));
        assert_eq!(step_for("Enter"), None);
        assert_eq!(step_for("a"), None);
    }
}
