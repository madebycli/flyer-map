//! The Aktion as the screens see it. Ids are opaque strings; the Backend decides what they look like.
use flyermap_identity::{Art, Role};

pub type LngLat = [f64; 2];

#[derive(Clone, Debug, PartialEq)]
pub struct Aktion {
    pub id: String,
    pub name: String,
    /// Austeilen or Abholen: the two are separate worlds, one Aktion is one of them.
    pub art: Art,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Gruppe {
    pub id: String,
    pub name: String,
    /// `#rrggbb`.
    pub color: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Gebiet {
    pub id: String,
    pub name: String,
    pub gruppe: Option<String>,
    pub art: Art,
    /// Closed ring, `[lng, lat]`.
    pub ring: Vec<LngLat>,
    /// What the server said for this person right now; the interface only mirrors it.
    pub writable: bool,
    pub pack_version: Option<u32>,
    pub color: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Teilnehmer {
    pub id: String,
    pub label: String,
}

/// A time-boxed shared effort in one Gebiet: who is out there right now.
#[derive(Clone, Debug, PartialEq)]
pub struct Lauf {
    pub id: String,
    pub gebiet: String,
    pub gruppe: Option<String>,
    /// How many people are out (counted by hand, there is no tracking).
    pub headcount: u32,
    /// The people who joined with a name, when the server tells.
    pub members: Vec<Teilnehmer>,
    pub started_at: Option<u64>,
    /// Houses done since the Lauf started.
    pub houses_done: Option<u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Person {
    pub id: String,
    pub label: String,
    pub role: Role,
    pub gruppe: Option<String>,
    pub last_seen: Option<u64>,
    pub devices: u32,
    /// A guest has one device and no account.
    pub guest: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ZugangKind {
    Einladung,
    Geraet,
}

/// An invitation (code, QR, link) or a device that is signed in.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Zugang {
    pub id: String,
    pub kind: ZugangKind,
    pub label: String,
    pub role: Role,
    pub uses: u32,
    pub max_uses: Option<u32>,
    pub expires: Option<u64>,
    /// Shown to the person who creates an invitation: the short code.
    pub code: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Me {
    pub label: Option<String>,
    pub guest: bool,
}

/// The deployment's basemap styles; `None` for a theme means the plain background.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Basemap {
    pub dark: Option<String>,
    pub light: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct World {
    pub aktion: Aktion,
    pub me: Me,
    pub gruppen: Vec<Gruppe>,
    pub gebiete: Vec<Gebiet>,
    /// Outlines of Gebiete the person does not work in (no names, no data).
    pub context: Vec<Vec<LngLat>>,
    pub laeufe: Vec<Lauf>,
    pub personen: Vec<Person>,
    pub zugaenge: Vec<Zugang>,
    pub basemap: Basemap,
}

impl World {
    /// Before the first answer of the backend.
    pub fn empty() -> World {
        World {
            aktion: Aktion { id: String::new(), name: String::new(), art: Art::Austeilen },
            me: Me::default(),
            gruppen: Vec::new(),
            gebiete: Vec::new(),
            context: Vec::new(),
            laeufe: Vec::new(),
            personen: Vec::new(),
            zugaenge: Vec::new(),
            basemap: Basemap::default(),
        }
    }

    pub fn gebiet(&self, id: &str) -> Option<&Gebiet> {
        self.gebiete.iter().find(|g| g.id == id)
    }

    pub fn gruppe(&self, id: &str) -> Option<&Gruppe> {
        self.gruppen.iter().find(|g| g.id == id)
    }

    pub fn lauf(&self, id: &str) -> Option<&Lauf> {
        self.laeufe.iter().find(|l| l.id == id)
    }

    pub fn person(&self, id: &str) -> Option<&Person> {
        self.personen.iter().find(|p| p.id == id)
    }

    /// The Läufe that run in a Gebiet.
    pub fn laeufe_in<'a>(&'a self, gebiet: &'a str) -> impl Iterator<Item = &'a Lauf> {
        self.laeufe.iter().filter(move |l| l.gebiet == gebiet)
    }

    /// West, south, east, north of every Gebiet; `None` without Gebiete.
    pub fn bounds(&self) -> Option<[f64; 4]> {
        let all: Vec<LngLat> = self.gebiete.iter().flat_map(|g| g.ring.iter().copied()).collect();
        ring_bounds(&all)
    }
}

/// West, south, east, north of one ring.
pub fn ring_bounds(ring: &[LngLat]) -> Option<[f64; 4]> {
    let mut b = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
    for p in ring {
        b = [b[0].min(p[0]), b[1].min(p[1]), b[2].max(p[0]), b[3].max(p[1])];
    }
    b.iter().all(|v| v.is_finite()).then_some(b)
}

/// The middle of a ring's bounding box (good enough to fly to).
pub fn ring_center(ring: &[LngLat]) -> Option<LngLat> {
    ring_bounds(ring).map(|b| [(b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_and_center_of_a_ring() {
        let ring = [[13.0, 51.0], [13.2, 51.0], [13.2, 51.1], [13.0, 51.1], [13.0, 51.0]];
        assert_eq!(ring_bounds(&ring), Some([13.0, 51.0, 13.2, 51.1]));
        let c = ring_center(&ring).unwrap();
        assert!((c[0] - 13.1).abs() < 1e-9 && (c[1] - 51.05).abs() < 1e-9);
        assert_eq!(ring_bounds(&[]), None);
    }
}
