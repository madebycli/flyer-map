//! What a start loads: the Gebiete with map data for this person, each as one or more units (a big Gebiet is fetched and derived in parts, see
//! `flyermap_pack::plan`). The other Gebiete of the Aktion are outlines only. Same rule as the boot of the React app, asked of the rights mirror.
use crate::{
    backend::PackRef,
    model::{Rights, World},
};
use flyermap_identity::Action;

#[derive(Clone, Debug, PartialEq)]
pub struct Unit {
    pub gebiet: String,
    /// `None` for a Gebiet that is one pack; the part number otherwise.
    pub part: Option<usize>,
    pub ring: Vec<[f64; 2]>,
    pub cell: Option<[f64; 4]>,
}

impl Unit {
    pub fn pack_ref(&self) -> PackRef {
        PackRef { gebiet: self.gebiet.clone(), part: self.part }
    }
}

/// The Gebiete too large to derive at all (an outline that is a runaway); they stay outlines.
#[derive(Debug, Default, PartialEq)]
pub struct Plan {
    pub units: Vec<Unit>,
    pub too_large: Vec<String>,
}

pub fn plan(world: &World, rights: &Rights) -> Plan {
    let mut out = Plan::default();
    for g in world.gebiete.iter().filter(|g| rights.can_gebiet(Action::Read, g)) {
        let plan = flyermap_pack::plan(&g.ring);
        if plan.too_large {
            out.too_large.push(g.id.clone());
            continue;
        }
        for part in plan.parts {
            out.units.push(Unit { gebiet: g.id.clone(), part: (!plan.single).then_some(part.index), ring: g.ring.clone(), cell: part.cell });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::mock::data::{grants, world, Persona, AKTION, ORG};
    use flyermap_identity::{AktionId, OrgId};

    fn rights(p: Persona) -> Rights {
        Rights::new(grants(p), OrgId::new(ORG), AktionId::new(AKTION), 1_800_000_000_000)
    }

    #[test]
    fn an_admin_loads_everything_and_a_member_only_the_own_gruppe() {
        let admin = plan(&world(Persona::Admin), &rights(Persona::Admin));
        assert_eq!(admin.units.len(), 4);
        assert!(admin.units.iter().all(|u| u.part.is_none() && u.cell.is_none()), "small Gebiete are one pack each");
        let member = plan(&world(Persona::Member), &rights(Persona::Member));
        assert_eq!(member.units.iter().map(|u| u.gebiet.as_str()).collect::<Vec<_>>(), ["nordstadt"]);
        assert!(plan(&world(Persona::Viewer), &rights(Persona::Viewer)).units.len() == 4, "a viewer reads all");
    }

    #[test]
    fn a_big_gebiet_comes_in_parts() {
        let mut w = world(Persona::Admin);
        w.gebiete.truncate(1);
        w.gebiete[0].ring = vec![[13.0, 51.4], [13.07, 51.4], [13.07, 51.45], [13.0, 51.45], [13.0, 51.4]];
        let p = plan(&w, &rights(Persona::Admin));
        assert!(p.units.len() > 2 && p.units.iter().all(|u| u.part.is_some() && u.cell.is_some()));
        assert_eq!(p.units[0].pack_ref().part, Some(0));
    }
}
