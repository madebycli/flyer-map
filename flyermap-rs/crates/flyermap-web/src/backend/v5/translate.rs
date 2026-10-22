//! `/api/v5/.../meta` as the screens' [`World`] and the grants the screens ask `decide` with. The old server speaks in link roles
//! (admin, team-editor, viewer, collector); here each becomes the grants the new model would hold, so every screen reads rights one way.
use crate::{
    backend::Boot,
    model::{Aktion, Basemap, Gebiet, Gruppe, Lauf, Me, Teilnehmer, World},
};
use flyermap_identity::{AktionId, Art, GebietId, Grant, GruppeId, OrgId, Role, Scope};
use flyermap_rights::Role as LinkRole;
use flyermap_wire::meta::{Kind, Meta};

/// The old server has no organisations: all its Aktionen live in one.
pub const ORG: &str = "org-v5";
const NO_GROUP_COLOR: &str = "#6c7f92";

fn art_of(kind: Kind) -> Art {
    match kind {
        Kind::Distribution => Art::Austeilen,
        Kind::Collection => Art::Abholen,
    }
}

pub fn grants(meta: &Meta) -> Vec<Grant> {
    let (org, aktion) = (OrgId::new(ORG), AktionId::new(&meta.campaign.id));
    let at_aktion = |role| Grant::new(role, Scope::Aktion { org: org.clone(), aktion: aktion.clone() });
    let at_gebiet = |role, id: &str| Grant::new(role, Scope::Gebiet { org: org.clone(), aktion: aktion.clone(), gebiet: GebietId::new(id) });
    let writable = || meta.areas.iter().filter(|a| a.writable).map(|a| a.id.as_str());
    match meta.role {
        LinkRole::Admin => vec![at_aktion(Role::Admin)],
        LinkRole::Viewer => vec![at_aktion(Role::Viewer)],
        LinkRole::TeamEditor => match &meta.team_id {
            Some(team) => {
                vec![Grant::new(Role::Member, Scope::Gruppe { org: org.clone(), aktion: aktion.clone(), gruppe: GruppeId::new(team) }), at_aktion(Role::Viewer)]
            }
            None => writable().map(|id| at_gebiet(Role::Member, id)).collect(),
        },
        LinkRole::CollectionCollector => std::iter::once(at_aktion(Role::Helper)).chain(writable().map(|id| at_gebiet(Role::Helper, id))).collect(),
    }
}

fn gebiet_of(meta: &Meta, a: &flyermap_wire::meta::Area) -> Gebiet {
    let team_color = meta.teams.iter().find(|t| t.id == a.team_id).map(|t| t.color.clone());
    let color = a.collection.as_ref().map(|c| c.color.clone()).or(team_color).unwrap_or_else(|| NO_GROUP_COLOR.into());
    Gebiet {
        id: a.id.clone(),
        name: a.name.clone(),
        gruppe: Some(a.team_id.clone()),
        art: art_of(meta.kind),
        ring: a.geometry.outer().to_vec(),
        writable: a.writable,
        pack_version: a.pack_version,
        color,
    }
}

/// The Läufe the meta itself names (Abholen: the runs of the collectors).
fn runs_of(meta: &Meta) -> Vec<Lauf> {
    meta.runs
        .iter()
        .map(|r| Lauf {
            id: r.id.clone(),
            gebiet: r.main_area_id.clone(),
            gruppe: None,
            headcount: r.members.len() as u32,
            members: r.members.iter().map(|m| Teilnehmer { id: m.collector_id.clone(), label: m.label.clone() }).collect(),
            started_at: None,
            houses_done: None,
        })
        .collect()
}

pub fn boot(meta: &Meta) -> Boot {
    let world = World {
        aktion: Aktion { id: meta.campaign.id.clone(), name: meta.campaign.name.clone(), art: art_of(meta.kind) },
        me: Me { label: meta.me.label.clone().or_else(|| meta.collector_label.clone()), guest: meta.guest_room.is_some() },
        gruppen: meta.teams.iter().map(|t| Gruppe { id: t.id.clone(), name: t.name.clone(), color: t.color.clone() }).collect(),
        gebiete: meta.areas.iter().map(|a| gebiet_of(meta, a)).collect(),
        context: meta.context_areas.iter().map(|c| c.geometry.outer().to_vec()).collect(),
        laeufe: runs_of(meta),
        personen: Vec::new(),
        zugaenge: Vec::new(),
        basemap: meta.basemap.as_ref().map(|b| Basemap { dark: b.dark.clone(), light: b.light.clone() }).unwrap_or_default(),
    };
    Boot { world, grants: grants(meta), org: OrgId::new(ORG) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Rights;
    use flyermap_identity::Action;

    fn meta(role: &str, team: &str) -> Meta {
        let text = format!(
            r##"{{"campaign":{{"id":"c1","name":"Test"}},"kind":"distribution","window":null,"guestRoom":null,"role":"{role}","teamId":{team},"me":{{"label":"Nutzer"}},
            "collectorId":null,"collectorLabel":null,"runs":[],"mainArea":null,"mainAreaId":null,"pickupRights":{{"view":false,"create":false,"edit":false}},
            "canWrite":true,"canBuildPack":false,
            "teams":[{{"id":"t1","name":"Nord","color":"#2563eb","updatedAt":"x"}},{{"id":"t2","name":"Süd","color":"#ef4444","updatedAt":"x"}}],
            "areas":[
              {{"id":"a1","name":"Eins","teamId":"t1","geometry":{{"type":"Polygon","coordinates":[[[13,51],[13.1,51],[13.1,51.1],[13,51]]]}},"updatedAt":"x","packVersion":2,"packStale":false,"writable":true}},
              {{"id":"a2","name":"Zwei","teamId":"t2","geometry":{{"type":"Polygon","coordinates":[[[13.2,51],[13.3,51],[13.3,51.1],[13.2,51]]]}},"updatedAt":"x","packVersion":null,"packStale":false,"writable":false}}],
            "contextAreas":[],"basemap":null}}"##
        );
        serde_json::from_str(&text).unwrap()
    }

    fn rights(b: &Boot) -> Rights {
        Rights::new(b.grants.clone(), b.org.clone(), AktionId::new(&b.world.aktion.id), 1)
    }

    #[test]
    fn the_writable_flag_of_the_server_and_the_decision_of_the_mirror_agree() {
        for (role, team) in [("admin", "null"), ("team-editor", "\"t1\""), ("team-editor", "null"), ("viewer", "null")] {
            let b = boot(&meta(role, team));
            let r = rights(&b);
            for g in &b.world.gebiete {
                // the server flags what it lets this link write; a viewer link is never writable, whatever the flag of the area
                let server_says = match role {
                    "admin" => true,
                    "viewer" => false,
                    _ => g.writable,
                };
                assert_eq!(r.can_gebiet(Action::Mark, g), server_says, "{role} {team} in {}", g.id);
            }
        }
    }

    #[test]
    fn the_names_colours_and_art_come_across() {
        let b = boot(&meta("admin", "null"));
        assert_eq!((b.world.aktion.name.as_str(), b.world.aktion.art), ("Test", Art::Austeilen));
        assert_eq!(b.world.gebiet("a1").unwrap().color, "#2563eb");
        assert_eq!(b.world.gebiet("a2").unwrap().gruppe.as_deref(), Some("t2"));
        assert_eq!(b.world.gebiete[0].ring.len(), 4);
        assert_eq!(b.world.me.label.as_deref(), Some("Nutzer"));
        assert_eq!(rights(&b).role_label(), "Admin");
    }

    #[test]
    fn a_team_link_may_not_draw_or_manage() {
        let b = boot(&meta("team-editor", "\"t1\""));
        let r = rights(&b);
        assert!(!r.can_aktion(Action::ManagePeople) && !r.may_draw_somewhere(&b.world.gebiete));
        assert_eq!(r.role_label(), "Mitglied");
    }
}
