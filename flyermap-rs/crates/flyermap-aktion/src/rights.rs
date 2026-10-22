//! The only place where the Akteur asks for rights. Every question goes to `flyermap_identity::decide` with the `Resource` the thing really is (its world
//! and Gruppe as stored, never as the device claims): there is no second rule set here, only the translation from "this command on that thing" to a question.
use crate::{
    caller::Caller,
    config::Limits,
    fail::R,
    queries::areas::{self, AreaRow, Facts},
    sql::Sql,
};
use flyermap_identity::{decide, Action, AktionId, Decision, Denial, OrgId, Resource};
use flyermap_protocol::{Art, Gebiet, GebietId, GruppeId, Reason, Why};

/// What one command runs with.
pub(crate) struct Ctx<'a> {
    pub org: &'a OrgId,
    pub aktion: &'a AktionId,
    pub caller: &'a Caller,
    pub now: u64,
    pub limits: &'a Limits,
}

pub(crate) fn why(denial: Denial) -> Why {
    match denial {
        Denial::NoGrant => Why::NoGrant,
        Denial::Expired => Why::Expired,
        Denial::OutOfScope => Why::OutOfScope,
        Denial::WrongArt => Why::WrongArt,
        // these two come from handing out roles, which is not a question the Akteur asks
        Denial::MissingCapability | Denial::RoleScopeMismatch | Denial::CannotHandOut => Why::MissingCapability,
    }
}

impl Ctx<'_> {
    pub fn aktion_resource(&self) -> Resource {
        Resource::aktion(self.org, self.aktion)
    }

    pub fn gruppe_resource(&self, id: &GruppeId) -> Resource {
        Resource::gruppe(self.org, self.aktion, id)
    }

    /// A Gebiet of the given world and Gruppe (the Gruppe only counts for Austeilen).
    pub fn area_resource(&self, id: &GebietId, art: Art, gruppe: Option<&GruppeId>) -> Resource {
        Resource::gebiet(self.org, self.aktion, id, art, gruppe)
    }

    pub fn gebiet_resource(&self, g: &Gebiet) -> Resource {
        self.area_resource(&g.id, g.art, g.gruppe.as_ref())
    }

    pub fn facts_resource(&self, f: &Facts) -> Resource {
        self.area_resource(&f.id, f.art, f.gruppe.as_ref())
    }

    pub fn decide(&self, action: Action, resource: &Resource) -> Decision {
        decide(&self.caller.access, self.now, action, resource)
    }

    /// The question every command starts with: may the caller come into this Aktion at all?
    pub fn enter(&self) -> Result<(), Reason> {
        self.require(Action::Enter, &self.aktion_resource())
    }

    pub fn require(&self, action: Action, resource: &Resource) -> Result<(), Reason> {
        match self.decide(action, resource) {
            Decision::Allow => Ok(()),
            Decision::Deny(denial) => Err(Reason::Forbidden { why: why(denial) }),
        }
    }

    pub fn may_outline(&self, g: &Gebiet) -> bool {
        self.decide(Action::Outline, &self.gebiet_resource(g)).is_allowed()
    }
}

/// The Gebiet, if it exists and the caller may know of it (may see its outline). Whoever may not gets the same answer as for a Gebiet that is not there,
/// so that ids cannot be probed.
pub(crate) fn visible_gebiet<S: Sql>(sql: &mut S, cx: &Ctx, id: &GebietId) -> R<AreaRow> {
    crate::validate::id(id.as_str())?;
    match areas::get(sql, id)? {
        Some(row) if cx.may_outline(&row.gebiet) => Ok(row),
        _ => Err(Reason::NotFound.into()),
    }
}
