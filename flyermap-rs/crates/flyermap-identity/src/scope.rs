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
