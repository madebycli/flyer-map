//! Helpers shared by the test files: a world with an Akteur over in-memory SQLite, the callers of the cast, and small shapes.
#![allow(dead_code)]
pub mod mirror;
pub mod who;
pub mod world;

use flyermap_core::clock::{encode_clock, ClockState};
use flyermap_protocol::{Art, Body, GebietId, GebietIn, GruppeId, GruppeIn, Key, MarkIn, OpId, Ring, Status};

/// The server's time at the start of a test (ms).
pub const T0: u64 = 1_800_000_000_000;

pub fn op(wall: u64, node: &str) -> OpId {
    encode_clock(&ClockState { wall, counter: 0, node: node.to_string() })
}

pub fn gid(id: &str) -> GebietId {
    GebietId::new(id)
}

pub fn gr(id: &str) -> GruppeId {
    GruppeId::new(id)
}

pub fn key(text: &str) -> Key {
    Key::new(text)
}

/// A closed square, `size` degrees wide (0.001 is about 70 by 110 metres).
pub fn square(x: f64, y: f64, size: f64) -> Ring {
    vec![[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]
}

pub fn mark(key: &str, status: Status, op: OpId) -> MarkIn {
    MarkIn { key: Key::new(key), status, op }
}

pub fn marks(gebiet: &str, list: Vec<MarkIn>) -> Body {
    Body::Marks { gebiet: gid(gebiet), marks: list }
}

pub fn gruppe_in(id: &str, name: &str) -> Body {
    Body::Gruppe { gruppe: GruppeIn { id: gr(id), name: name.to_string(), color: 3, base_rev: 0 } }
}

pub fn austeilen(id: &str, gruppe: Option<&str>, ring: Ring) -> Body {
    Body::Gebiet { gebiet: GebietIn { id: gid(id), art: Art::Austeilen, gruppe: gruppe.map(gr), parent: None, name: id.to_string(), ring, base_rev: 0 } }
}

pub fn abholen(id: &str, parent: Option<&str>, ring: Ring) -> Body {
    Body::Gebiet { gebiet: GebietIn { id: gid(id), art: Art::Abholen, gruppe: None, parent: parent.map(gid), name: id.to_string(), ring, base_rev: 0 } }
}
