use crate::{caller::Caller, role::Role};
use serde::{Deserialize, Serialize};

/// What a caller may do with Sonder-Marker (pickup tasks).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PickupRights {
    pub view: bool,
    pub create: bool,
    pub edit: bool,
}

impl PickupRights {
    /// Admins can do everything, viewers can look, helpers have what their individual capabilities say (looked up by the Worker), everyone else nothing.
    pub fn of(caller: &Caller, helper_capabilities: Option<PickupRights>) -> PickupRights {
        match caller.role {
            Role::Admin => PickupRights {
                view: true,
                create: true,
                edit: true,
            },
            Role::Viewer => PickupRights {
                view: true,
                create: false,
                edit: false,
            },
            Role::CollectionCollector if caller.collector_id.is_some() => {
                helper_capabilities.unwrap_or_default()
            }
            _ => PickupRights::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rights_by_role() {
        let all = PickupRights {
            view: true,
            create: true,
            edit: true,
        };
        assert_eq!(PickupRights::of(&Caller::new("g", Role::Admin), None), all);
        assert_eq!(
            PickupRights::of(&Caller::new("g", Role::Viewer), None),
            PickupRights {
                view: true,
                create: false,
                edit: false
            }
        );
        assert_eq!(
            PickupRights::of(&Caller::new("g", Role::TeamEditor), Some(all)),
            PickupRights::default()
        );
        let helper = Caller::new("g", Role::CollectionCollector).as_collector("c");
        assert_eq!(PickupRights::of(&helper, Some(all)), all);
        assert_eq!(PickupRights::of(&helper, None), PickupRights::default());
        assert_eq!(
            PickupRights::of(&Caller::new("g", Role::CollectionCollector), Some(all)),
            PickupRights::default()
        );
    }
}
