use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Role {
    /// Organiser: everything.
    Admin,
    /// A Gruppe's editor: reads and writes the Gebiete of the own Gruppe.
    TeamEditor,
    /// Reads everything, writes nothing.
    Viewer,
    /// An Abhol-Helfer: works in collection Gebiete of the Run they joined.
    CollectionCollector,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Admin => "admin",
            Role::TeamEditor => "team-editor",
            Role::Viewer => "viewer",
            Role::CollectionCollector => "collection-collector",
        }
    }
    pub fn parse(text: &str) -> Option<Role> {
        [Role::Admin, Role::TeamEditor, Role::Viewer, Role::CollectionCollector].into_iter().find(|r| r.as_str() == text)
    }
}
