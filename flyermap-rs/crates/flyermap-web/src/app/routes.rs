//! Where a menu row leads in this slice: the sheets that exist open, the organiser pages ask first, the rest says it comes later.
use super::shell::{Action, Dialog, Panel};
use crate::features::menu::{not_yet_text, MenuTarget};

pub fn action_for(target: MenuTarget, label: &str) -> Action {
    match target {
        MenuTarget::Overview => Action::Open(Panel::Overview),
        MenuTarget::Settings => Action::Open(Panel::Settings),
        MenuTarget::Templates => Action::Open(Panel::Templates),
        MenuTarget::Help => Action::Open(Panel::Help),
        MenuTarget::Admin => Action::ShowDialog(Dialog::Admin),
        // the whole map is what the stand-in shows anyway
        MenuTarget::FitAll => Action::Close,
        MenuTarget::Team
        | MenuTarget::Runs
        | MenuTarget::Notes
        | MenuTarget::Areas
        | MenuTarget::Pickup
        | MenuTarget::NextOpen
        | MenuTarget::Setup
        | MenuTarget::Groups
        | MenuTarget::Access => Action::Notify(not_yet_text(label)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn existing_sheets_open_and_missing_ones_say_so() {
        assert_eq!(action_for(MenuTarget::Settings, "Einstellungen"), Action::Open(Panel::Settings));
        assert_eq!(action_for(MenuTarget::Admin, "Verwaltung"), Action::ShowDialog(Dialog::Admin));
        match action_for(MenuTarget::Notes, "Notizen") {
            Action::Notify(text) => assert!(text.contains("„Notizen“")),
            other => panic!("{other:?}"),
        }
    }
}
