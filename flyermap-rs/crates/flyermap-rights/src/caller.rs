use crate::role::Role;
use serde::{Deserialize, Serialize};

/// Who is asking, as the Worker resolved it from the session or link: nothing here comes from the request body.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Caller {
    pub grant_id: String,
    pub role: Role,
    pub team_id: Option<String>,
    pub label: Option<String>,
    pub collector_id: Option<String>,
    /// A guest who joined an open room: bound to that room and to its Gebiet, and it ends with the room.
    pub room_id: Option<String>,
    pub room_area_id: Option<String>,
}

impl Caller {
    pub fn new(grant_id: &str, role: Role) -> Caller {
        Caller { grant_id: grant_id.to_string(), role, team_id: None, label: None, collector_id: None, room_id: None, room_area_id: None }
    }
    pub fn in_team(mut self, team_id: &str) -> Caller {
        self.team_id = Some(team_id.to_string());
        self
    }
    pub fn as_room_guest(mut self, room_id: &str, area_id: &str) -> Caller {
        self.room_id = Some(room_id.to_string());
        self.room_area_id = Some(area_id.to_string());
        self
    }
    pub fn as_collector(mut self, collector_id: &str) -> Caller {
        self.collector_id = Some(collector_id.to_string());
        self
    }
}
