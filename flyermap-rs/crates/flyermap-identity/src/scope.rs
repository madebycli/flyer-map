use crate::{AktionId, GebietId, GruppeId, OrgId};
use serde::{Deserialize, Serialize};

/// Where a grant applies. Wider scopes cover narrower ones: Organisation ⊃ Aktion ⊃ Gruppe ⊃ Gebiet.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Scope {
    Organisation { org: OrgId },
    Aktion { org: OrgId, aktion: AktionId },
    Gruppe { org: OrgId, aktion: AktionId, gruppe: GruppeId },
    Gebiet { org: OrgId, aktion: AktionId, gebiet: GebietId },
}

impl Scope {
    pub fn org(&self) -> &OrgId {
        match self {
            Scope::Organisation { org } | Scope::Aktion { org, .. } | Scope::Gruppe { org, .. } | Scope::Gebiet { org, .. } => org,
        }
    }

    pub fn aktion(&self) -> Option<&AktionId> {
        match self {
            Scope::Organisation { .. } => None,
            Scope::Aktion { aktion, .. } | Scope::Gruppe { aktion, .. } | Scope::Gebiet { aktion, .. } => Some(aktion),
        }
    }

    /// 0 = Organisation, 1 = Aktion, 2 = Gruppe or Gebiet.
    pub fn depth(&self) -> u8 {
        match self {
            Scope::Organisation { .. } => 0,
            Scope::Aktion { .. } => 1,
            Scope::Gruppe { .. } | Scope::Gebiet { .. } => 2,
        }
    }
}

/// The columns a scope is stored in (the directory keeps one row shape for grants and invitations).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScopeColumns {
    pub kind: &'static str,
    pub org: String,
    pub aktion: Option<String>,
    pub gruppe: Option<String>,
    pub gebiet: Option<String>,
}

impl Scope {
    pub fn columns(&self) -> ScopeColumns {
        let s = |x: &str| Some(x.to_string());
        match self {
            Scope::Organisation { org } => ScopeColumns { kind: "organisation", org: org.0.clone(), aktion: None, gruppe: None, gebiet: None },
            Scope::Aktion { org, aktion } => ScopeColumns { kind: "aktion", org: org.0.clone(), aktion: s(&aktion.0), gruppe: None, gebiet: None },
            Scope::Gruppe { org, aktion, gruppe } => {
                ScopeColumns { kind: "gruppe", org: org.0.clone(), aktion: s(&aktion.0), gruppe: s(&gruppe.0), gebiet: None }
            }
            Scope::Gebiet { org, aktion, gebiet } => {
                ScopeColumns { kind: "gebiet", org: org.0.clone(), aktion: s(&aktion.0), gruppe: None, gebiet: s(&gebiet.0) }
            }
        }
    }

    /// `None` when the columns do not make a scope (a row that was edited by hand).
    pub fn from_columns(kind: &str, org: &str, aktion: Option<&str>, gruppe: Option<&str>, gebiet: Option<&str>) -> Option<Scope> {
        let (org, aktion) = (OrgId::new(org), aktion.map(AktionId::new));
        match kind {
            "organisation" => Some(Scope::Organisation { org }),
            "aktion" => Some(Scope::Aktion { org, aktion: aktion? }),
            "gruppe" => Some(Scope::Gruppe { org, aktion: aktion?, gruppe: GruppeId::new(gruppe?) }),
            "gebiet" => Some(Scope::Gebiet { org, aktion: aktion?, gebiet: GebietId::new(gebiet?) }),
            _ => None,
        }
    }
}
