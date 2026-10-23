//! What the edge tells the Akteur about a request: who asks and what they may do. A Durable Object can only be reached through the edge Worker's binding,
//! so the Akteur takes the link as given; it still asks `decide` about everything, and a link that does not name its own Aktion is refused.
//!
//! Only the grants that can matter in this Aktion travel (those of its Organisation that cover it): the Akteur learns nothing of the person's other
//! Organisationen, and the header stays small however many grants the person has elsewhere.
use flyermap_aktion::Caller;
use flyermap_identity::{b64, AccessSet};
use serde::{Deserialize, Serialize};

/// The header the edge puts the link in. The edge sets it on a request it builds itself; nothing of the client's request is passed on.
pub const HEADER: &str = "x-fm-link";
/// A link larger than this (as text) is not one.
const MAX_LEN: usize = 48 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Link {
    pub org: String,
    pub aktion: String,
    /// The person or guest, as an opaque label: what the log calls `by`.
    pub principal: String,
    /// The session the request came with: ending it closes its live connections.
    pub session: String,
    pub access: AccessSet,
}

impl Link {
    pub fn new(org: &str, aktion: &str, principal: &str, session: &str, access: &AccessSet) -> Link {
        let grants = access.grants.iter().filter(|g| g.scope.org().0 == org && g.scope.aktion().is_none_or(|a| a.0 == aktion)).cloned().collect();
        Link { org: org.into(), aktion: aktion.into(), principal: principal.into(), session: session.into(), access: AccessSet::new(grants) }
    }

    pub fn caller(&self) -> Caller {
        Caller::new(&self.principal, self.access.clone())
    }

    /// For the header: base64url of the JSON.
    pub fn encode(&self) -> String {
        b64::encode(&serde_json::to_vec(self).unwrap_or_default())
    }

    /// `None` for anything that is not a link. The Aktion it names is not checked: a Durable Object does not know its own name, and the Akteur refuses a
    /// storage that belongs to another Aktion when it opens.
    pub fn decode_unbound(text: &str) -> Option<Link> {
        if text.len() > MAX_LEN {
            return None;
        }
        let link: Link = serde_json::from_slice(&b64::decode(text)?).ok()?;
        (!link.org.is_empty() && !link.aktion.is_empty() && !link.principal.is_empty()).then_some(link)
    }

    /// Like [`Link::decode_unbound`], and `None` when the link speaks of another Aktion than `aktion`.
    pub fn decode(text: &str, aktion: &str) -> Option<Link> {
        Link::decode_unbound(text).filter(|link| link.aktion == aktion)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flyermap_identity::{AktionId, Grant, OrgId, Role, Scope};

    fn org_grant(org: &str) -> Grant {
        Grant::new(Role::Admin, Scope::Organisation { org: OrgId::new(org) })
    }
    fn aktion_grant(org: &str, aktion: &str) -> Grant {
        Grant::new(Role::Member, Scope::Aktion { org: OrgId::new(org), aktion: AktionId::new(aktion) })
    }

    #[test]
    fn only_the_grants_that_can_matter_here_travel() {
        let all = AccessSet::new(vec![org_grant("o1"), org_grant("o2"), aktion_grant("o1", "a1"), aktion_grant("o1", "a2"), aktion_grant("o2", "a1")]);
        let link = Link::new("o1", "a1", "p", "s", &all);
        assert_eq!(link.access.grants, vec![org_grant("o1"), aktion_grant("o1", "a1")], "other Organisationen and other Aktionen stay at the edge");
    }

    #[test]
    fn a_link_survives_the_header_and_is_for_one_aktion_only() {
        let link = Link::new("o1", "a1", "per_1", "ses_1", &AccessSet::new(vec![org_grant("o1").until(5_000)]));
        assert_eq!(Link::decode(&link.encode(), "a1"), Some(link.clone()));
        assert_eq!(Link::decode(&link.encode(), "a2"), None, "a link made for another Aktion is no link here");
        assert_eq!(link.caller().principal, "per_1");
    }

    #[test]
    fn what_is_not_a_link_is_none() {
        for bad in [
            "",
            "%%%",
            "e30",
            &b64::encode(b"{}"),
            &b64::encode(br#"{"org":"o","aktion":"a1","principal":"","session":"s","access":{"grants":[]}}"#),
            &"A".repeat(MAX_LEN + 1),
        ] {
            assert_eq!(Link::decode(bad, "a1"), None, "{bad:.20}");
        }
    }
}
