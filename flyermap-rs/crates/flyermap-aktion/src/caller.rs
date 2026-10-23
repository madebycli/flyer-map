//! Who asks. The edge Worker has already worked out who the person is and loaded all their grants once for the request; the Akteur gets both and
//! trusts neither beyond `decide`: the principal is only a label for the log, the access set is the only source of rights.
use flyermap_identity::AccessSet;

#[derive(Clone, Debug, Default)]
pub struct Caller {
    /// An opaque label of the person or guest (never a name): what the log calls `by`, and who owns a taken-over Gebiet.
    pub principal: String,
    pub access: AccessSet,
}

impl Caller {
    pub fn new(principal: impl Into<String>, access: AccessSet) -> Caller {
        Caller { principal: principal.into(), access }
    }

    /// A label the log can keep: 1 to 64 characters, no control characters.
    pub fn is_valid(&self) -> bool {
        let n = self.principal.chars().count();
        (1..=flyermap_protocol::limits::MAX_ID).contains(&n) && !self.principal.chars().any(char::is_control)
    }
}
