//! The navigation state. One sheet at a time (the sheet zone), one tool at a time (marking or drawing owns the map's taps), one note under the bar.
//! A page one level down has a parent: its back arrow returns there, its X closes everything.
use crate::model::Subject;

/// The sheets. A sheet is built when it opens and dropped when it closes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Panel {
    /// What a tap on the map or on a list opened: a Gebiet, a house, a street, a Gruppe, a person, a Lauf, an invitation.
    Subject(Subject),
    Overview,
    Settings,
    Palette,
    Help,
    /// The Studio as a sheet (on a phone); from 900 px it is the column.
    Studio,
}

impl Panel {
    pub fn parent(&self) -> Option<Panel> {
        match self {
            Panel::Palette => Some(Panel::Settings),
            _ => None,
        }
    }
}

/// Who owns the map's taps and strokes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Tool {
    /// A tap opens what is under it.
    #[default]
    Idle,
    /// Stamp, brush, route, lasso: the marking panel is up.
    Mark,
    /// Drawing a Gebiet: the drawing panel is up.
    Draw,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum StudioTab {
    #[default]
    Gebiete,
    Gruppen,
    Laeufe,
    Personen,
    Zugaenge,
}

impl StudioTab {
    pub const ALL: [StudioTab; 5] = [StudioTab::Gebiete, StudioTab::Gruppen, StudioTab::Laeufe, StudioTab::Personen, StudioTab::Zugaenge];

    pub fn as_str(self) -> &'static str {
        match self {
            StudioTab::Gebiete => "gebiete",
            StudioTab::Gruppen => "gruppen",
            StudioTab::Laeufe => "laeufe",
            StudioTab::Personen => "personen",
            StudioTab::Zugaenge => "zugaenge",
        }
    }
}

/// A short note under the bar; `id` tells a newer note from an older one with the same text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Notice {
    pub id: u32,
    pub text: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Shell {
    pub panel: Option<Panel>,
    pub tool: Tool,
    pub notice: Option<Notice>,
    pub studio_tab: StudioTab,
    next_notice: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Action {
    /// Open a sheet. A tool in use ends: sheets are for looking things up, the map is for working.
    Open(Panel),
    Back,
    Close,
    /// Start (or leave, with `Tool::Idle`) a tool. Starting one closes the sheet.
    SetTool(Tool),
    Notify(String),
    /// Dismiss the note with this id (a timer of an older note does not remove a newer one).
    Dismiss(u32),
    StudioTab(StudioTab),
}

impl Shell {
    pub fn reduce(&mut self, action: Action) {
        match action {
            Action::Open(panel) => {
                self.panel = Some(panel);
                self.tool = Tool::Idle;
            }
            Action::Back => self.panel = self.panel.as_ref().and_then(Panel::parent),
            Action::Close => self.panel = None,
            Action::SetTool(tool) => {
                self.tool = tool;
                if tool != Tool::Idle {
                    self.panel = None;
                }
            }
            Action::Notify(text) => {
                self.next_notice += 1;
                self.notice = Some(Notice { id: self.next_notice, text });
            }
            Action::Dismiss(id) => {
                if self.notice.as_ref().is_some_and(|n| n.id == id) {
                    self.notice = None;
                }
            }
            Action::StudioTab(tab) => self.studio_tab = tab,
        }
    }
}

/// `none` before the app is ready, `sheet` while a sheet covers the map, `tool` while a tool is up, `idle` otherwise (the `data-ui` of the frame).
pub fn ui_state(ready: bool, panel: Option<&Panel>, tool: Tool) -> &'static str {
    match (ready, panel, tool) {
        (false, ..) => "none",
        (true, Some(_), _) => "sheet",
        (true, None, Tool::Idle) => "idle",
        (true, None, _) => "tool",
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
    fn settings_palette_and_back_again() {
        let s = run([Action::Open(Panel::Settings), Action::Open(Panel::Palette)]);
        assert_eq!(s.panel, Some(Panel::Palette));
        assert_eq!(run([Action::Open(Panel::Palette), Action::Back]).panel, Some(Panel::Settings));
        assert_eq!(run([Action::Open(Panel::Palette), Action::Back, Action::Back]).panel, None, "back from a page without a parent closes");
        assert_eq!(run([Action::Open(Panel::Palette), Action::Close]).panel, None);
    }

    #[test]
    fn a_tool_and_a_sheet_never_share_the_screen() {
        let s = run([Action::SetTool(Tool::Mark), Action::Open(Panel::Overview)]);
        assert_eq!((s.panel.clone(), s.tool), (Some(Panel::Overview), Tool::Idle), "opening a sheet puts the tool down");
        let s = run([Action::Open(Panel::Overview), Action::SetTool(Tool::Draw)]);
        assert_eq!((s.panel, s.tool), (None, Tool::Draw), "starting a tool closes the sheet");
        let s = run([Action::SetTool(Tool::Mark), Action::SetTool(Tool::Idle)]);
        assert_eq!(s.tool, Tool::Idle);
    }

    #[test]
    fn an_old_timer_does_not_remove_a_newer_note() {
        let s = run([Action::Notify("a".into()), Action::Notify("b".into()), Action::Dismiss(1)]);
        assert_eq!(s.notice.as_ref().map(|n| n.text.as_str()), Some("b"));
        assert_eq!(run([Action::Notify("a".into()), Action::Dismiss(1)]).notice, None);
    }

    #[test]
    fn a_subject_sheet_replaces_the_one_before() {
        let s = run([Action::Open(Panel::Subject(Subject::Gebiet("a".into()))), Action::Open(Panel::Subject(Subject::Lauf("l".into())))]);
        assert_eq!(s.panel, Some(Panel::Subject(Subject::Lauf("l".into()))));
        assert_eq!(run([Action::StudioTab(StudioTab::Personen)]).studio_tab, StudioTab::Personen);
    }

    #[test]
    fn ui_state_follows_sheet_and_tool() {
        assert_eq!(ui_state(false, Some(&Panel::Help), Tool::Mark), "none");
        assert_eq!(ui_state(true, Some(&Panel::Help), Tool::Idle), "sheet");
        assert_eq!(ui_state(true, None, Tool::Mark), "tool");
        assert_eq!(ui_state(true, None, Tool::Idle), "idle");
    }
}
