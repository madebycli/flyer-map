use crate::{AktionId, GebietId, GruppeId, OrgId, Scope};
use serde::{Deserialize, Serialize};

/// The two kinds of Gebiete. They are separate worlds (Plan 057).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Art {
    Austeilen,
    Abholen,
}

/// What a right is asked about: where in the tree the thing lives.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Resource {
    pub org: OrgId,
    pub aktion: Option<AktionId>,
    /// The Gruppe it belongs to (Austeilen-Gebiete, Läufe, the Gruppe itself).
    pub gruppe: Option<GruppeId>,
    pub gebiet: Option<GebietId>,
    /// For Gebiete and what hangs on them (marks, notes): which world.
    pub art: Option<Art>,
}

impl Resource {
    /// The place a scope stands for (what managing people at that scope is asked about).
    pub fn of_scope(scope: &Scope) -> Resource {
        match scope {
            Scope::Organisation { org } => Resource::organisation(org),
            Scope::Aktion { org, aktion } => Resource::aktion(org, aktion),
            Scope::Gruppe { org, aktion, gruppe } => Resource::gruppe(org, aktion, gruppe),
            Scope::Gebiet { org, aktion, gebiet } => Resource { gebiet: Some(gebiet.clone()), ..Resource::aktion(org, aktion) },
        }
    }

    pub fn organisation(org: &OrgId) -> Resource {
        Resource { org: org.clone(), aktion: None, gruppe: None, gebiet: None, art: None }
    }

    pub fn aktion(org: &OrgId, aktion: &AktionId) -> Resource {
        Resource { aktion: Some(aktion.clone()), ..Resource::organisation(org) }
    }

    pub fn gruppe(org: &OrgId, aktion: &AktionId, gruppe: &GruppeId) -> Resource {
        Resource { gruppe: Some(gruppe.clone()), ..Resource::aktion(org, aktion) }
    }

    /// A Gebiet of the given world; `gruppe` is its Gruppe for Austeilen (none for Abholen).
    pub fn gebiet(org: &OrgId, aktion: &AktionId, gebiet: &GebietId, art: Art, gruppe: Option<&GruppeId>) -> Resource {
        Resource { gebiet: Some(gebiet.clone()), art: Some(art), gruppe: gruppe.cloned(), ..Resource::aktion(org, aktion) }
    }
}
