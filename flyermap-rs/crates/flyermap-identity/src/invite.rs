//! Invitations: a short code (shown as text and as QR) that the app redeems once and binds to the device. The code is Crockford base32 without the
//! look-alike letters, 10 characters (50 bits); only its hash is stored, so a leaked database cannot be redeemed.
use crate::{token::hex, Grant, Role, Scope};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
pub const CODE_LEN: usize = 10;

/// A new code from `CODE_LEN` random bytes (each byte contributes its low five bits; 256 is a multiple of 32, so every letter is equally likely).
pub fn new_code(random: &[u8; CODE_LEN]) -> String {
    random.iter().map(|b| ALPHABET[(b & 31) as usize] as char).collect()
}

/// What people type or scan, brought to the stored form: upper case, no spaces or dashes, `O`→`0`, `I`/`L`→`1`. `None` when it cannot be a code.
pub fn normalize(input: &str) -> Option<String> {
    let code: String = input
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .map(|c| match c.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            other => other,
        })
        .collect();
    (code.len() == CODE_LEN && code.bytes().all(|b| ALPHABET.contains(&b))).then_some(code)
}

/// `ABCDE-FGHJK`, easier to read aloud and to type.
pub fn display(code: &str) -> String {
    match (code.get(..CODE_LEN / 2), code.get(CODE_LEN / 2..)) {
        (Some(a), Some(b)) => format!("{a}-{b}"),
        _ => code.to_string(),
    }
}

/// What the directory stores and looks up by.
pub fn hash_code(code: &str) -> String {
    hex(&Sha256::digest(format!("flyermap-invite:{code}").as_bytes()))
}

/// What the invitation offers. `grant_for` ends at `not_after` of the invitation or after `grant_ttl_ms` (guests of a Lauf), whichever is first.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Invite {
    pub role: Role,
    pub scope: Scope,
    /// `None` = unlimited.
    pub max_uses: Option<u32>,
    pub uses: u32,
    /// The invitation can be redeemed until then.
    pub not_after: Option<u64>,
    /// How long the grant made by redeeming lasts (a guest in a Lauf: some hours); `None` = until revoked.
    pub grant_ttl_ms: Option<u64>,
    pub revoked: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Problem {
    Revoked,
    Expired,
    UsedUp,
}

impl Invite {
    pub fn check(&self, now: u64) -> Result<(), Problem> {
        if self.revoked {
            Err(Problem::Revoked)
        } else if self.not_after.is_some_and(|end| now >= end) {
            Err(Problem::Expired)
        } else if self.max_uses.is_some_and(|max| self.uses >= max) {
            Err(Problem::UsedUp)
        } else {
            Ok(())
        }
    }

    /// The grant a redeemer gets; check first.
    pub fn grant_for(&self, now: u64) -> Grant {
        let mut grant = Grant::new(self.role, self.scope.clone());
        grant.not_after = match (self.grant_ttl_ms.map(|ttl| now + ttl), self.not_after) {
            (Some(by_ttl), Some(by_invite)) => Some(by_ttl.min(by_invite.max(now))),
            (Some(by_ttl), None) => Some(by_ttl),
            (None, _) => None,
        };
        grant
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AktionId, OrgId};

    fn invite() -> Invite {
        let scope = Scope::Aktion { org: OrgId::new("o"), aktion: AktionId::new("a") };
        Invite { role: Role::Helper, scope, max_uses: Some(2), uses: 0, not_after: Some(10_000), grant_ttl_ms: Some(3_000), revoked: false }
    }

    #[test]
    fn codes_are_typed_the_way_people_type_them() {
        let code = new_code(&[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        assert_eq!(code, "0123456789");
        assert_eq!(display(&code), "01234-56789");
        assert_eq!(normalize("01234-56789"), Some(code.clone()));
        assert_eq!(normalize(" oi234 56789 "), Some(code.clone()), "O and I are read as 0 and 1");
        assert_eq!(normalize("lOoOoOoOoO").as_deref(), Some("1000000000"), "L is read as 1, O as 0");
        assert_eq!(normalize("abcde-fghjk").unwrap(), "ABCDEFGHJK");
        for bad in ["", "0123", "0123456789A", "0123456U89", "01234_56789"] {
            assert_eq!(normalize(bad), None, "{bad}");
        }
        assert_ne!(hash_code("0123456789"), hash_code("0123456788"));
        let all: std::collections::HashSet<char> = (0..=255u8).map(|b| new_code(&[b; 10]).chars().next().unwrap()).collect();
        assert_eq!(all.len(), 32);
    }

    #[test]
    fn an_invitation_can_be_used_so_often_and_so_long() {
        let mut i = invite();
        assert_eq!(i.check(0), Ok(()));
        i.uses = 2;
        assert_eq!(i.check(0), Err(Problem::UsedUp));
        i.uses = 0;
        assert_eq!(i.check(10_000), Err(Problem::Expired));
        i.revoked = true;
        assert_eq!(i.check(0), Err(Problem::Revoked));
    }

    #[test]
    fn the_grant_ends_with_the_shorter_of_the_two() {
        let i = invite();
        assert_eq!(i.grant_for(1_000).not_after, Some(4_000));
        assert_eq!(i.grant_for(9_000).not_after, Some(10_000), "the invitation ends first");
        assert_eq!(Invite { grant_ttl_ms: None, ..i }.grant_for(1_000).not_after, None);
    }
}
