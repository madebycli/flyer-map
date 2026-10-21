//! The policy, one function per question. Judged against the rights matrix: anonymous nothing; viewer reads everything and writes nothing; admin everything;
//! team editor reads and writes only the Gebiete of the own Gruppe; a helper works in the collection Gebiete of the Run they joined.
use crate::{
    area::{AreaRef, CollectionStatus},
    caller::Caller,
    role::Role,
};

/// Roles that may write something at all; which Gebiete they may write in is decided per Gebiet ([`can_write_area`]).
pub fn writes_allowed(caller: &Caller) -> bool {
    matches!(
        caller.role,
        Role::Admin | Role::TeamEditor | Role::CollectionCollector
    )
}

/// Roles whose reads and writes are bound to Gebiete they are entitled to (admins and viewers see everything).
pub fn is_scoped(caller: &Caller) -> bool {
    matches!(caller.role, Role::TeamEditor | Role::CollectionCollector)
}

/// A guest of a room is bound to the room's Gebiet; everybody else is not bound to one.
pub fn in_room_area(caller: &Caller, area_id: &str) -> bool {
    caller.room_id.is_none() || caller.room_area_id.as_deref() == Some(area_id)
}

/// Reading: team members see their Gruppe's Gebiete, helpers the collection Gebiete (so they see who works where).
pub fn can_read_area(caller: &Caller, area: &AreaRef) -> bool {
    match area {
        AreaRef::Distribution { id, team_id } => {
            caller.role != Role::CollectionCollector
                && (!is_scoped(caller) || caller.team_id.as_deref() == Some(team_id))
                && in_room_area(caller, id)
        }
        AreaRef::Collection { status, .. } => {
            if *status == CollectionStatus::Archived && caller.role != Role::Admin {
                return false;
            }
            matches!(
                caller.role,
                Role::Admin | Role::Viewer | Role::CollectionCollector
            )
        }
    }
}

/// Writing. `collector_works_here` says whether this helper is an active member of the active Run that holds the Gebiet; the Worker looks it up
/// (it needs the database), so the rule itself stays pure.
pub fn can_write_area(caller: &Caller, area: &AreaRef, collector_works_here: bool) -> bool {
    if !writes_allowed(caller) {
        return false;
    }
    match area {
        AreaRef::Distribution { id, team_id } => {
            caller.role != Role::CollectionCollector
                && (!is_scoped(caller) || caller.team_id.as_deref() == Some(team_id))
                && in_room_area(caller, id)
        }
        AreaRef::Collection { status, run_id, .. } => {
            if *status == CollectionStatus::Archived {
                return false;
            }
            if caller.role == Role::Admin {
                return true;
            }
            let held = run_id.is_some()
                && matches!(
                    status,
                    CollectionStatus::Claimed | CollectionStatus::InProgress
                );
            caller.role == Role::CollectionCollector
                && caller.collector_id.is_some()
                && held
                && collector_works_here
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn team_area(id: &str, team: &str) -> AreaRef {
        AreaRef::Distribution {
            id: id.into(),
            team_id: team.into(),
        }
    }
    fn coll(status: CollectionStatus, run: Option<&str>) -> AreaRef {
        AreaRef::Collection {
            id: "c1".into(),
            status,
            run_id: run.map(String::from),
        }
    }
    fn who(role: Role, team: Option<&str>) -> Caller {
        let c = Caller::new("g", role);
        team.map_or(c.clone(), |t| c.in_team(t))
    }

    #[test]
    fn the_rights_matrix_for_distribution_gebiete() {
        let n = team_area("area_n", "team_n");
        let o = team_area("area_o", "team_o");
        let admin = who(Role::Admin, None);
        let viewer = who(Role::Viewer, None);
        let editor = who(Role::TeamEditor, Some("team_n"));
        for (caller, read_n, read_o, write_n, write_o) in [
            (&admin, true, true, true, true),
            (&viewer, true, true, false, false),
            (&editor, true, false, true, false),
        ] {
            assert_eq!(
                can_read_area(caller, &n),
                read_n,
                "{:?} reads n",
                caller.role
            );
            assert_eq!(
                can_read_area(caller, &o),
                read_o,
                "{:?} reads o",
                caller.role
            );
            assert_eq!(
                can_write_area(caller, &n, false),
                write_n,
                "{:?} writes n",
                caller.role
            );
            assert_eq!(
                can_write_area(caller, &o, false),
                write_o,
                "{:?} writes o",
                caller.role
            );
        }
    }

    #[test]
    fn a_room_guest_is_bound_to_the_rooms_gebiet() {
        let guest = who(Role::TeamEditor, Some("team_n")).as_room_guest("r1", "area_n");
        assert!(can_write_area(
            &guest,
            &team_area("area_n", "team_n"),
            false
        ));
        assert!(!can_write_area(
            &guest,
            &team_area("area_n2", "team_n"),
            false
        ));
        assert!(!can_read_area(&guest, &team_area("area_n2", "team_n")));
    }

    #[test]
    fn helpers_only_see_collection_gebiete_and_write_where_their_run_holds_one() {
        let helper = Caller::new("g", Role::CollectionCollector).as_collector("col1");
        assert!(!can_read_area(&helper, &team_area("a", "t")));
        assert!(can_read_area(&helper, &coll(CollectionStatus::Open, None)));
        assert!(!can_read_area(
            &helper,
            &coll(CollectionStatus::Archived, None)
        ));
        assert!(can_read_area(
            &who(Role::Admin, None),
            &coll(CollectionStatus::Archived, None)
        ));
        let held = coll(CollectionStatus::InProgress, Some("run1"));
        assert!(can_write_area(&helper, &held, true));
        assert!(
            !can_write_area(&helper, &held, false),
            "not a member of the run"
        );
        assert!(
            !can_write_area(&helper, &coll(CollectionStatus::Open, None), true),
            "nobody holds it"
        );
        assert!(!can_write_area(
            &helper,
            &coll(CollectionStatus::Archived, Some("run1")),
            true
        ));
        assert!(can_write_area(
            &who(Role::Admin, None),
            &coll(CollectionStatus::Open, None),
            false
        ));
        assert!(!can_write_area(
            &who(Role::Admin, None),
            &coll(CollectionStatus::Archived, None),
            false
        ));
        assert!(!can_write_area(&who(Role::Viewer, None), &held, true));
    }

    #[test]
    fn scope_and_write_permission_by_role() {
        assert!(
            writes_allowed(&who(Role::Admin, None)) && !writes_allowed(&who(Role::Viewer, None))
        );
        assert!(is_scoped(&who(Role::TeamEditor, None)) && !is_scoped(&who(Role::Viewer, None)));
    }
}
