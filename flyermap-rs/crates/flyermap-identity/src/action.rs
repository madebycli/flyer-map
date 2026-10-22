use crate::Capability;

/// What someone wants to do. Every action needs one capability; the resource decides where it must hold.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    /// See the Aktion exists and its name, plus the outlines of the Gebiete of the world one works in.
    Enter,
    /// See the outline of a Gebiet (not its marks).
    Outline,
    Read,
    Mark,
    Annotate,
    DrawArea,
    ManageGroup,
    StartRun,
    Collect,
    ManageAktion,
    ManagePeople,
    ManageSecurity,
}

impl Action {
    /// The capability that must be held at the resource. `Enter` and `Outline` are answered from any grant in the Aktion.
    pub fn capability(self) -> Option<Capability> {
        Some(match self {
            Action::Enter | Action::Outline => return None,
            Action::Read => Capability::Read,
            Action::Mark => Capability::Mark,
            Action::Annotate => Capability::Annotate,
            Action::DrawArea => Capability::DrawArea,
            Action::ManageGroup => Capability::ManageGroup,
            Action::StartRun => Capability::StartRun,
            Action::Collect => Capability::Collect,
            Action::ManageAktion => Capability::ManageAktion,
            Action::ManagePeople => Capability::ManagePeople,
            Action::ManageSecurity => Capability::ManageSecurity,
        })
    }
}
