//! Identity and rights of Flyer Map 6 (Plan 061 §3).
//!
//! - [`Role`], [`Capability`], [`Scope`], [`Grant`], [`AccessSet`]: what a person or guest may do, where.
//! - [`decide`]: the one function every right goes through. The Worker loads the caller's grants once per request and asks; nothing else decides.
//! - [`may_grant`]: who may hand out which role where (no escalation).
//! - [`invite`], [`token`], [`totp`], [`passkey`], [`recovery`]: the ways in.
//!
//! Everything here is pure. Time comes in as milliseconds, randomness as bytes: the caller owns the clock and the entropy source.
mod access;
mod action;
pub mod b64;
mod grant;
mod ids;
pub mod invite;
pub mod passkey;
pub mod recovery;
mod resource;
mod role;
mod scope;
pub mod token;
pub mod totp;

pub use access::{arts_of, decide, may_enter, may_grant, AccessSet, Decision, Denial};
pub use action::Action;
pub use grant::Grant;
pub use ids::{AktionId, GebietId, GruppeId, OrgId};
pub use resource::{Art, Resource};
pub use role::{Capability, Role};
pub use scope::{Scope, ScopeColumns};
