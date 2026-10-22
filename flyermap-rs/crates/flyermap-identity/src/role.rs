//! Roles are named sets of capabilities; the rules ask for capabilities, never for roles.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Capability {
    /// Look at the map and the progress.
    Read,
    /// Set the status of houses and streets.
    Mark,
    /// Write notes on houses, streets and Gebiete.
    Annotate,
    /// Draw, change and delete Gebiete.
    DrawArea,
    /// Change a Gruppe: name, colour, members.
    ManageGroup,
    /// Open, change and finish Läufe.
    StartRun,
    /// Take over a Gebiet for Abholen.
    Collect,
    /// Rename, archive or delete the Aktion; map data.
    ManageAktion,
    /// Invite, change and remove people; manage their devices.
    ManagePeople,
    /// Security settings of the Organisation; audit log.
    ManageSecurity,
}

use Capability::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Role {
    /// Runs the Organisation.
    Owner,
    /// Runs one Aktion.
    Admin,
    /// Leads a Gruppe.
    Lead,
    /// Works in the Gebiete of a Gruppe.
    Member,
    /// Collects (Abholen) in a Gebiet taken over.
    Helper,
    /// Looks only.
    Viewer,
}

impl Role {
    pub const ALL: [Role; 6] = [Role::Owner, Role::Admin, Role::Lead, Role::Member, Role::Helper, Role::Viewer];

    pub fn capabilities(self) -> &'static [Capability] {
        match self {
            Role::Owner => &[Read, Mark, Annotate, DrawArea, ManageGroup, StartRun, Collect, ManageAktion, ManagePeople, ManageSecurity],
            Role::Admin => &[Read, Mark, Annotate, DrawArea, ManageGroup, StartRun, Collect, ManageAktion, ManagePeople],
            Role::Lead => &[Read, Mark, Annotate, DrawArea, ManageGroup, StartRun, ManagePeople],
            Role::Member => &[Read, Mark, Annotate],
            Role::Helper => &[Read, Mark, Annotate, Collect],
            Role::Viewer => &[Read],
        }
    }

    /// The capabilities at a scope of the given depth (0 Organisation, 1 Aktion, 2 Gruppe or Gebiet). Only the Helper differs by depth: invited
    /// into an Aktion a Helper may look and take a Gebiet over; the grant made by taking it over (at the Gebiet) is what allows marking there.
    pub fn capabilities_at(self, depth: u8) -> &'static [Capability] {
        match (self, depth) {
            (Role::Helper, 0 | 1) => &[Read, Collect],
            (Role::Helper, _) => &[Read, Mark, Annotate, Collect],
            _ => self.capabilities(),
        }
    }

    /// Which worlds the role works in. Helpers collect, groups distribute; admins, owners and viewers see both.
    pub fn works_in(self, art: crate::Art) -> bool {
        match self {
            Role::Owner | Role::Admin | Role::Viewer => true,
            Role::Lead | Role::Member => art == crate::Art::Austeilen,
            Role::Helper => art == crate::Art::Abholen,
        }
    }

    /// Does the role make sense at this scope? (An Owner is for the Organisation, a Lead for a Gruppe, and so on.)
    pub fn fits(self, scope: &crate::Scope) -> bool {
        use crate::Scope::*;
        match (self, scope) {
            (Role::Owner, Organisation { .. }) => true,
            (Role::Admin, Organisation { .. } | Aktion { .. }) => true,
            (Role::Lead, Gruppe { .. }) => true,
            (Role::Member, Gruppe { .. } | Gebiet { .. }) => true,
            (Role::Helper, Aktion { .. } | Gebiet { .. }) => true,
            (Role::Viewer, _) => true,
            _ => false,
        }
    }

    /// The roles this role may hand out (always at a scope it covers itself, see [`crate::may_grant`]). Nobody hands out more than they have.
    pub fn may_hand_out(self) -> &'static [Role] {
        match self {
            Role::Owner => &[Role::Owner, Role::Admin, Role::Lead, Role::Member, Role::Helper, Role::Viewer],
            Role::Admin => &[Role::Admin, Role::Lead, Role::Member, Role::Helper, Role::Viewer],
            Role::Lead => &[Role::Member, Role::Viewer],
            Role::Member | Role::Helper | Role::Viewer => &[],
        }
    }
}
