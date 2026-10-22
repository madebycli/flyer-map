//! The keys of the keyboard on the page: which press means what. Pure, so every rule is a native test; the app carries them out (`app::shortcuts`). While the
//! person types in a field the letters are letters; only Ctrl/Cmd+K reaches past a field.
use super::nav::Tool;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shortcut {
    /// Put the cursor in the search.
    FocusSearch,
    /// Close the sheet that is open, else put the tool down.
    Back,
    /// Start marking, or put it down.
    ToggleMark,
    /// Marking mode by position: Strecke, Stempeln, Wischen, Lasso.
    Mode(usize),
    Undo,
    Help,
}

/// What is on the screen, as far as the keys care.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Screen {
    pub tool: Tool,
    pub sheet_open: bool,
}

pub fn shortcut(key: &str, command: bool, alt: bool, typing: bool, screen: Screen) -> Option<Shortcut> {
    if alt {
        return None;
    }
    if command {
        return match key.to_lowercase().as_str() {
            "k" => Some(Shortcut::FocusSearch),
            "z" if !typing && screen.tool == Tool::Mark => Some(Shortcut::Undo),
            _ => None,
        };
    }
    if typing {
        return None;
    }
    match key {
        "/" => Some(Shortcut::FocusSearch),
        "?" => Some(Shortcut::Help),
        "Escape" if screen.sheet_open || screen.tool != Tool::Idle => Some(Shortcut::Back),
        "m" | "M" if screen.tool != Tool::Draw => Some(Shortcut::ToggleMark),
        "u" | "U" if screen.tool == Tool::Mark => Some(Shortcut::Undo),
        "1" | "2" | "3" | "4" if screen.tool == Tool::Mark => key.parse::<usize>().ok().map(|n| Shortcut::Mode(n - 1)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const IDLE: Screen = Screen { tool: Tool::Idle, sheet_open: false };
    const MARKING: Screen = Screen { tool: Tool::Mark, sheet_open: false };

    fn plain(key: &str, screen: Screen) -> Option<Shortcut> {
        shortcut(key, false, false, false, screen)
    }

    #[test]
    fn slash_and_ctrl_k_go_to_the_search() {
        assert_eq!(plain("/", IDLE), Some(Shortcut::FocusSearch));
        assert_eq!(shortcut("k", true, false, false, IDLE), Some(Shortcut::FocusSearch));
        assert_eq!(shortcut("K", true, false, true, IDLE), Some(Shortcut::FocusSearch), "Ctrl+K reaches past a text field");
    }

    #[test]
    fn typing_in_a_field_keeps_the_letters() {
        for key in ["/", "m", "u", "1", "?", "Escape"] {
            assert_eq!(shortcut(key, false, false, true, MARKING), None, "{key}");
        }
    }

    #[test]
    fn escape_goes_back_one_step_only_when_there_is_one() {
        assert_eq!(plain("Escape", IDLE), None);
        assert_eq!(plain("Escape", Screen { sheet_open: true, ..IDLE }), Some(Shortcut::Back));
        assert_eq!(plain("Escape", MARKING), Some(Shortcut::Back));
    }

    #[test]
    fn marking_keys_work_only_while_marking() {
        assert_eq!(plain("m", IDLE), Some(Shortcut::ToggleMark));
        assert_eq!(plain("m", MARKING), Some(Shortcut::ToggleMark));
        assert_eq!(plain("m", Screen { tool: Tool::Draw, sheet_open: false }), None, "while drawing, M does not start marking");
        assert_eq!(plain("3", MARKING), Some(Shortcut::Mode(2)));
        assert_eq!(plain("3", IDLE), None);
        assert_eq!(plain("u", MARKING), Some(Shortcut::Undo));
        assert_eq!(shortcut("z", true, false, false, MARKING), Some(Shortcut::Undo));
        assert_eq!(shortcut("z", true, false, false, IDLE), None);
    }

    #[test]
    fn alt_and_unknown_keys_do_nothing() {
        assert_eq!(shortcut("m", false, true, false, IDLE), None);
        assert_eq!(plain("x", IDLE), None);
        assert_eq!(plain("?", IDLE), Some(Shortcut::Help));
    }
}
