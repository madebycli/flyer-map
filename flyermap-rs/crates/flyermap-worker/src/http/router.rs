//! Which route a path is. Same shapes and the same refusals as `v5Route` in the TypeScript Worker.
use super::request::decode_path_segment;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CampaignRes {
    State,
    Ops,
    Meta,
    Notes,
    Window,
    Rooms,
    Progress,
    Stats,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AreaRes {
    Pack,
    Prune,
    Forget,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Route {
    Basemap,
    PublicRoom { room_id: String, join: bool },
    Campaign { campaign_id: String, res: CampaignRes },
    Room { campaign_id: String, room_id: String, finish: bool },
    Area { campaign_id: String, area_id: String, res: AreaRes },
}

/// `^[A-Za-z0-9._:-]{1,160}$`
pub fn is_id(text: &str) -> bool {
    (1..=160).contains(&text.len()) && text.chars().all(|c| c.is_ascii_alphanumeric() || "._:-".contains(c))
}

fn id(segment: &str) -> Option<String> {
    decode_path_segment(segment).filter(|s| is_id(s))
}

/// `None` for every path that is not one of ours (the caller answers 404 for `/api/v5/...`).
pub fn route(path: &str) -> Option<Route> {
    if path == "/api/v5/basemap" {
        return Some(Route::Basemap);
    }
    if let Some(rest) = path.strip_prefix("/api/v5/rooms/") {
        let (room, join) = match rest.strip_suffix("/join") {
            Some(room) => (room, true),
            None => (rest, false),
        };
        return (!room.is_empty() && !room.contains('/')).then(|| id(room)).flatten().map(|room_id| Route::PublicRoom { room_id, join });
    }
    let rest = path.strip_prefix("/api/v5/campaigns/")?;
    let (campaign, tail) = rest.split_once('/')?;
    let campaign_id = id(campaign)?;
    let parts: Vec<&str> = tail.split('/').collect();
    let res = |r| Some(Route::Campaign { campaign_id: campaign_id.clone(), res: r });
    match parts.as_slice() {
        ["state"] => res(CampaignRes::State),
        ["ops"] => res(CampaignRes::Ops),
        ["meta"] => res(CampaignRes::Meta),
        ["notes"] => res(CampaignRes::Notes),
        ["window"] => res(CampaignRes::Window),
        ["rooms"] => res(CampaignRes::Rooms),
        ["progress"] => res(CampaignRes::Progress),
        ["areas", "stats"] => res(CampaignRes::Stats),
        ["rooms", room] if !room.is_empty() => Some(Route::Room { campaign_id: campaign_id.clone(), room_id: id(room)?, finish: false }),
        ["rooms", room, "finish"] if !room.is_empty() => Some(Route::Room { campaign_id: campaign_id.clone(), room_id: id(room)?, finish: true }),
        ["areas", area, kind] if !area.is_empty() => {
            let res = match *kind {
                "pack" => AreaRes::Pack,
                "prune" => AreaRes::Prune,
                "forget" => AreaRes::Forget,
                _ => return None,
            };
            Some(Route::Area { campaign_id: campaign_id.clone(), area_id: id(area)?, res })
        }
        _ => None,
    }
}

impl Route {
    /// The route with its ids replaced, for logs and metrics (the same shape the client uses).
    pub fn template(&self) -> String {
        match self {
            Route::Basemap => "/api/v5/basemap".into(),
            Route::PublicRoom { join, .. } => {
                format!("/api/v5/rooms/:r{}", if *join { "/join" } else { "" })
            }
            Route::Campaign { res, .. } => format!(
                "/api/v5/campaigns/:c/{}",
                match res {
                    CampaignRes::State => "state",
                    CampaignRes::Ops => "ops",
                    CampaignRes::Meta => "meta",
                    CampaignRes::Notes => "notes",
                    CampaignRes::Window => "window",
                    CampaignRes::Rooms => "rooms",
                    CampaignRes::Progress => "progress",
                    CampaignRes::Stats => "areas/stats",
                }
            ),
            Route::Room { finish, .. } => format!("/api/v5/campaigns/:c/rooms/:r{}", if *finish { "/finish" } else { "" }),
            Route::Area { res, .. } => format!(
                "/api/v5/campaigns/:c/areas/:a/{}",
                match res {
                    AreaRes::Pack => "pack",
                    AreaRes::Prune => "prune",
                    AreaRes::Forget => "forget",
                }
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_and_refusals() {
        assert_eq!(route("/api/v5/basemap"), Some(Route::Basemap));
        assert_eq!(route("/api/v5/campaigns/c1/state"), Some(Route::Campaign { campaign_id: "c1".into(), res: CampaignRes::State }));
        assert_eq!(route("/api/v5/campaigns/c1/areas/stats"), Some(Route::Campaign { campaign_id: "c1".into(), res: CampaignRes::Stats }));
        assert_eq!(route("/api/v5/campaigns/c1/areas/a%3A1/pack"), Some(Route::Area { campaign_id: "c1".into(), area_id: "a:1".into(), res: AreaRes::Pack }));
        assert_eq!(route("/api/v5/campaigns/c1/rooms/r1/finish"), Some(Route::Room { campaign_id: "c1".into(), room_id: "r1".into(), finish: true }));
        assert_eq!(route("/api/v5/rooms/r1/join"), Some(Route::PublicRoom { room_id: "r1".into(), join: true }));
        for bad in [
            "/api/v5/campaigns/bad%20id!/state",
            "/api/v5/campaigns/c1/nope",
            "/api/v5/campaigns/c1/areas/a/eat",
            "/api/v5/campaigns/%E0%A4%A/state",
            "/api/v5/nonsense",
        ] {
            assert_eq!(route(bad), None, "{bad}");
        }
    }
}
