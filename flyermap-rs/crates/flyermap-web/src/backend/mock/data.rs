//! The made-up Aktion of the mock backend: four Gebiete in a 2 × 2 block (so neighbours share borders), three Gruppen, two Läufe, a few people and
//! invitations. Everything here is invented; the names are first names and street names that exist everywhere.
use crate::model::{Aktion, Basemap, Gebiet, Gruppe, Lauf, Me, Person, Teilnehmer, World, Zugang, ZugangKind};
use flyermap_identity::{AktionId, Art, Grant, GruppeId, OrgId, Role, Scope};

pub const ORG: &str = "org-beispiel";
pub const AKTION: &str = "herbst-beispiel";

/// What the mock plays: the role of the device, or a device that still has to join.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Persona {
    #[default]
    Admin,
    Lead,
    Member,
    Viewer,
    /// No access yet: `boot` asks to join first (`redeem` lets the device in as a guest).
    Stranger,
}

impl Persona {
    pub fn parse(text: &str) -> Persona {
        match text {
            "lead" => Persona::Lead,
            "member" => Persona::Member,
            "viewer" => Persona::Viewer,
            "stranger" | "join" => Persona::Stranger,
            _ => Persona::Admin,
        }
    }
}

fn ring(w: f64, s: f64, e: f64, n: f64) -> Vec<[f64; 2]> {
    vec![[w, s], [e, s], [e, n], [w, n], [w, s]]
}

pub fn gruppen() -> Vec<Gruppe> {
    let g = |id: &str, name: &str, color: &str| Gruppe { id: id.into(), name: name.into(), color: color.into() };
    vec![g("nord", "Gruppe Nord", "#4f8fdc"), g("sued", "Gruppe Süd", "#d9a53a"), g("mitte", "Gruppe Mitte", "#9a78d9")]
}

pub fn gebiete(persona: Persona) -> Vec<Gebiet> {
    let g = |id: &str, name: &str, gruppe: &str, color: &str, r: Vec<[f64; 2]>, writable: bool| Gebiet {
        id: id.into(),
        name: name.into(),
        gruppe: Some(gruppe.into()),
        art: Art::Austeilen,
        ring: r,
        writable,
        pack_version: Some(1),
        color: color.into(),
    };
    // a Lead or Member of Gruppe Nord works in the north only; the Admin works everywhere; the others look
    let own = |gruppe: &str| match persona {
        Persona::Admin => true,
        Persona::Lead | Persona::Member => gruppe == "nord",
        Persona::Viewer | Persona::Stranger => false,
    };
    vec![
        g("nordstadt", "Nordstadt", "nord", "#4f8fdc", ring(13.000, 51.2030, 13.005, 51.2055), own("nord")),
        g("altstadt", "Altstadt", "sued", "#d9a53a", ring(13.000, 51.2000, 13.005, 51.2030), own("sued")),
        g("hafen", "Hafenviertel", "sued", "#d9a53a", ring(13.005, 51.2000, 13.010, 51.2030), own("sued")),
        g("muehlenfeld", "Mühlenfeld", "mitte", "#9a78d9", ring(13.005, 51.2030, 13.010, 51.2055), own("mitte")),
    ]
}

pub fn laeufe() -> Vec<Lauf> {
    let t = |id: &str, label: &str| Teilnehmer { id: id.into(), label: label.into() };
    vec![
        Lauf {
            id: "lauf-1".into(),
            gebiet: "nordstadt".into(),
            gruppe: Some("nord".into()),
            headcount: 3,
            members: vec![t("ben", "Ben"), t("chiara", "Chiara")],
            started_at: Some(1_800_000_000_000 - 40 * 60_000),
            houses_done: Some(21),
        },
        Lauf {
            id: "lauf-2".into(),
            gebiet: "hafen".into(),
            gruppe: Some("sued".into()),
            headcount: 2,
            members: vec![t("dario", "Dario")],
            started_at: Some(1_800_000_000_000 - 12 * 60_000),
            houses_done: Some(6),
        },
    ]
}

pub fn personen() -> Vec<Person> {
    let p = |id: &str, label: &str, role, gruppe: Option<&str>, seen: u64, guest| Person {
        id: id.into(),
        label: label.into(),
        role,
        gruppe: gruppe.map(str::to_string),
        last_seen: Some(1_800_000_000_000 - seen * 60_000),
        devices: 1,
        guest,
    };
    vec![
        p("anna", "Anna", Role::Admin, None, 0, false),
        p("ben", "Ben", Role::Lead, Some("nord"), 1, false),
        p("chiara", "Chiara", Role::Member, Some("nord"), 3, false),
        p("dario", "Dario", Role::Member, Some("sued"), 9, false),
        p("gast-7", "Gast 7", Role::Member, Some("sued"), 240, true),
    ]
}

pub fn zugaenge() -> Vec<Zugang> {
    vec![
        Zugang {
            id: "einladung-1".into(),
            kind: ZugangKind::Einladung,
            label: "Gruppe Nord, Samstag".into(),
            role: Role::Member,
            uses: 2,
            max_uses: Some(5),
            expires: Some(1_800_000_000_000 + 3 * 86_400_000),
            code: Some(INVITE_CODE.into()),
        },
        Zugang {
            id: "geraet-1".into(),
            kind: ZugangKind::Geraet,
            label: "Bens Telefon".into(),
            role: Role::Lead,
            uses: 0,
            max_uses: None,
            expires: None,
            code: None,
        },
    ]
}

/// The one invitation code the mock accepts (Crockford base32, ten characters).
pub const INVITE_CODE: &str = "7K2QX9M4TB";
/// An invented account of the mock for trying the sign-in screen (not a secret: the mock has no server behind it).
pub const ACCOUNT_NAME: &str = "anna";
pub const ACCOUNT_PASSWORD: &str = "beispiel";
/// The six digits the mock accepts as the second factor.
pub const TOTP_CODE: &str = "123456";

pub fn world(persona: Persona) -> World {
    World {
        aktion: Aktion { id: AKTION.into(), name: "Herbstaktion (Beispiel)".into(), art: Art::Austeilen },
        me: Me { label: Some(if persona == Persona::Stranger { "Gast".into() } else { "Anna".into() }), guest: persona == Persona::Stranger },
        gruppen: gruppen(),
        gebiete: gebiete(persona),
        context: Vec::new(),
        laeufe: laeufe(),
        personen: personen(),
        zugaenge: zugaenge(),
        basemap: Basemap::default(),
    }
}

/// The grants of the persona, as the server would hand them out.
pub fn grants(persona: Persona) -> Vec<Grant> {
    let (org, aktion) = (OrgId::new(ORG), AktionId::new(AKTION));
    let aktion_scope = Scope::Aktion { org: org.clone(), aktion: aktion.clone() };
    let nord = Scope::Gruppe { org, aktion, gruppe: GruppeId::new("nord") };
    match persona {
        Persona::Admin => vec![Grant::new(Role::Admin, aktion_scope)],
        Persona::Lead => vec![Grant::new(Role::Lead, nord)],
        Persona::Member => vec![Grant::new(Role::Member, nord)],
        Persona::Viewer => vec![Grant::new(Role::Viewer, aktion_scope)],
        Persona::Stranger => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Rights;
    use flyermap_identity::Action;

    fn rights(p: Persona) -> Rights {
        Rights::new(grants(p), OrgId::new(ORG), AktionId::new(AKTION), 1_800_000_000_000)
    }

    #[test]
    fn the_writable_flag_agrees_with_the_decision_for_every_persona() {
        for p in [Persona::Admin, Persona::Lead, Persona::Member, Persona::Viewer, Persona::Stranger] {
            let (w, r) = (world(p), rights(p));
            for g in &w.gebiete {
                assert_eq!(r.can_gebiet(Action::Mark, g), g.writable, "{p:?} in {}", g.id);
            }
        }
    }

    #[test]
    fn the_gebiete_share_borders_and_the_numbers_are_plausible() {
        let w = world(Persona::Admin);
        assert_eq!(w.gebiete.len(), 4);
        assert_eq!(w.gebiet("nordstadt").unwrap().ring[0][1], w.gebiet("altstadt").unwrap().ring[3][1], "north and old town meet on one line");
        assert!(w.laeufe.iter().all(|l| w.gebiet(&l.gebiet).is_some()));
        assert!(w.bounds().is_some());
    }
}
