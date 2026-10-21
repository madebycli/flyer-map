//! The state of the shell as plain data and one reducer: which sheet is open, the mode, the note under the bar, the dialog. Pure, so every
//! navigation rule is a native test; the app keeps it in one signal and renders from it.
use crate::ui::status::Kind;

/// The sheets of this slice. A page one level down has a parent: its back arrow returns there, its X closes everything.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Panel {
    Menu,
    Overview,
    Settings,
    Palette,
    Templates,
    Help,
}

impl Panel {
    pub fn parent(self) -> Option<Panel> {
        match self {
            Panel::Settings | Panel::Templates => Some(Panel::Menu),
            Panel::Palette => Some(Panel::Settings),
            Panel::Menu | Panel::Overview | Panel::Help => None,
        }
    }
}

/// A short note under the bar; `id` tells a newer note from an older one with the same text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Notice {
    pub id: u32,
    pub text: String,
}

/// The short modal cards of this slice.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dialog {
    /// "Verwaltung" opens the organiser pages, which stay in the React app for now.
    Admin,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Shell {
    pub panel: Option<Panel>,
    pub kind: Kind,
    pub notice: Option<Notice>,
    pub dialog: Option<Dialog>,
    next_notice: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Action {
    Open(Panel),
    Back,
    Close,
    SetKind(Kind),
    Notify(String),
    /// Dismiss the note with this id (a timer of an older note does not remove a newer one).
    Dismiss(u32),
    ShowDialog(Dialog),
    CloseDialog,
}

/// `none` before the app is ready, `sheet` while a sheet covers the map, `idle` otherwise (the `data-ui` of `.v5-root`).
pub fn ui_state(ready: bool, panel: Option<Panel>) -> &'static str {
    match (ready, panel) {
        (false, _) => "none",
        (true, Some(_)) => "sheet",
        (true, None) => "idle",
    }
}

impl Shell {
    pub fn reduce(&mut self, action: Action) {
        match action {
            Action::Open(panel) => {
                self.panel = Some(panel);
                self.dialog = None;
            }
            Action::Back => self.panel = self.panel.and_then(Panel::parent),
            Action::Close => self.panel = None,
            Action::SetKind(kind) => self.kind = kind,
            Action::Notify(text) => {
                self.next_notice += 1;
                self.notice = Some(Notice {
                    id: self.next_notice,
                    text,
                });
            }
            Action::Dismiss(id) => {
                if self.notice.as_ref().is_some_and(|n| n.id == id) {
                    self.notice = None;
                }
            }
            Action::ShowDialog(dialog) => self.dialog = Some(dialog),
            Action::CloseDialog => self.dialog = None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(actions: impl IntoIterator<Item = Action>) -> Shell {
        let mut shell = Shell::default();
        for a in actions {
            shell.reduce(a);
        }
        shell
    }

    #[test]
    fn menu_settings_palette_and_back_again() {
        let s = run([
            Action::Open(Panel::Menu),
            Action::Open(Panel::Settings),
            Action::Open(Panel::Palette),
        ]);
        assert_eq!(s.panel, Some(Panel::Palette));
        let s = run([Action::Open(Panel::Palette), Action::Back]);
        assert_eq!(s.panel, Some(Panel::Settings));
        let s = run([Action::Open(Panel::Palette), Action::Back, Action::Back]);
        assert_eq!(s.panel, Some(Panel::Menu));
        let s = run([
            Action::Open(Panel::Palette),
            Action::Back,
            Action::Back,
            Action::Back,
        ]);
        assert_eq!(s.panel, None, "back from the top closes");
    }

    #[test]
    fn closing_returns_to_the_map_from_any_depth() {
        assert_eq!(
            run([Action::Open(Panel::Palette), Action::Close]).panel,
            None
        );
        assert_eq!(
            run([Action::Open(Panel::Templates), Action::Back]).panel,
            Some(Panel::Menu)
        );
    }

    #[test]
    fn an_old_timer_does_not_remove_a_newer_note() {
        let s = run([
            Action::Notify("a".into()),
            Action::Notify("b".into()),
            Action::Dismiss(1),
        ]);
        assert_eq!(s.notice.as_ref().map(|n| n.text.as_str()), Some("b"));
        let s = run([Action::Notify("a".into()), Action::Dismiss(1)]);
        assert_eq!(s.notice, None);
    }

    #[test]
    fn opening_a_sheet_closes_the_dialog_and_the_mode_stays() {
        let s = run([
            Action::SetKind(Kind::Collection),
            Action::ShowDialog(Dialog::Admin),
            Action::Open(Panel::Menu),
        ]);
        assert_eq!((s.dialog, s.kind), (None, Kind::Collection));
    }

    #[test]
    fn ui_state_follows_the_sheet() {
        assert_eq!(ui_state(false, Some(Panel::Menu)), "none");
        assert_eq!(ui_state(true, Some(Panel::Menu)), "sheet");
        assert_eq!(ui_state(true, None), "idle");
    }
}
