//! The cast of the Akteur tests: an Organisation with an Aktion, two Gruppen with a Gebiet each, and small shapes for commands and for reading frames.
use super::World;
use flyermap_core::clock::{encode_clock, ClockState};
use flyermap_protocol::{Art, Body, GebietId, GebietIn, GruppeId, GruppeIn, Key, MarkIn, ProtocolError, ServerFrame, ServerMsg, Status};
use serde_json::{json, Value};

pub fn ring(x: f64, y: f64) -> Vec<[f64; 2]> {
    vec![[x, y], [x + 0.005, y], [x + 0.005, y + 0.005], [x, y + 0.005], [x, y]]
}

pub fn gruppe(id: &str) -> Body {
    Body::Gruppe { gruppe: GruppeIn { id: GruppeId::new(id), name: id.to_string(), color: 3, base_rev: 0 } }
}

pub fn gebiet(id: &str, gruppe: &str, at: f64) -> Body {
    gebiet_rev(id, gruppe, at, 0)
}

/// A Gebiet as it is changed: `base_rev` is the revision the change was made on.
pub fn gebiet_rev(id: &str, gruppe: &str, at: f64, base_rev: u64) -> Body {
    Body::Gebiet {
        gebiet: GebietIn {
            id: GebietId::new(id),
            art: Art::Austeilen,
            gruppe: Some(GruppeId::new(gruppe)),
            parent: None,
            name: id.into(),
            ring: ring(13.0 + at, 51.0),
            base_rev,
        },
    }
}

pub fn marks(gebiet: &str, keys: &[&str], wall: u64) -> Body {
    let op = encode_clock(&ClockState { wall, counter: 0, node: "dev".into() });
    Body::Marks { gebiet: GebietId::new(gebiet), marks: keys.iter().map(|k| MarkIn { key: Key::new(*k), status: Status::Completed, op: op.clone() }).collect() }
}

pub struct Setup {
    pub w: World,
    pub owner: String,
    pub org: String,
    pub aktion: String,
}

/// An Organisation with an Aktion, Gruppen `nord` and `sued`, and a Gebiet in each (`n1`, `s1`).
pub fn setup() -> Setup {
    let w = World::new();
    let (owner, org) = w.organisation("anna");
    let aktion = w.aktion(&owner, &org);
    for body in [gruppe("nord"), gruppe("sued"), gebiet("n1", "nord", 0.0), gebiet("s1", "sued", 0.1)] {
        assert_eq!(w.command(&owner, &aktion, body)["t"], "accepted");
    }
    Setup { w, owner, org, aktion }
}

pub fn member_of(s: &Setup, gruppe: &str) -> String {
    s.w.guest(&s.owner, "member", json!({ "kind": "gruppe", "org": s.org, "aktion": s.aktion, "gruppe": gruppe }))
}

pub fn reason(verdict: &Value) -> &str {
    verdict["reason"]["code"].as_str().unwrap_or("")
}

pub fn entries(frames: &[ServerFrame]) -> Vec<Value> {
    frames
        .iter()
        .filter_map(|f| match &f.msg {
            ServerMsg::Entries { entries, .. } => Some(entries.iter().map(|e| serde_json::to_value(&e.change).unwrap()).collect::<Vec<_>>()),
            _ => None,
        })
        .flatten()
        .collect()
}

pub fn errors(frames: &[ServerFrame]) -> Vec<ProtocolError> {
    frames.iter().filter_map(|f| if let ServerMsg::Error { code } = &f.msg { Some(*code) } else { None }).collect()
}
