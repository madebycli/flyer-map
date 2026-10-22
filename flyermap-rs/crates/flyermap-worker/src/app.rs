//! The Worker put together: route, find out who asks, call the handler, add the headers and the log line.
use crate::{
    access,
    db::Db,
    handlers::{self, fail},
    http::{
        observe::{log_line, request_id, server_timing, DbStats},
        request::Request,
        response::Response,
        router::{route, AreaRes, CampaignRes, Route},
    },
    time::iso,
};
use flyermap_wire::{meta::Basemap, ApiError, ErrorCode};

pub struct Options {
    pub basemap: Option<Basemap>,
    /// Milliseconds since the epoch.
    pub now: Box<dyn Fn() -> u64>,
    /// Where the request log lines go (the Cloudflare log in the Worker, nowhere in tests).
    pub log: Box<dyn Fn(&str)>,
    /// Makes a request id when the client sent none.
    pub new_id: Box<dyn Fn() -> String>,
    /// 32 fresh random bytes for secrets and ids.
    pub random: Box<dyn Fn() -> [u8; 32]>,
    /// Requests to other services (the map data source).
    pub fetch: crate::upstream::Fetch,
    /// A configured map data source (`OSM_OVERPASS_URL`): then it is the only one asked; otherwise the public mirrors in turn.
    pub overpass_url: Option<String>,
    /// The largest map data answer that is accepted (UTF-16 units, as the TypeScript Worker counts).
    pub max_pack_bytes: usize,
}

impl Options {
    /// A secret for a link or a session (43 characters, base64url).
    pub fn secret(&self) -> String {
        crate::rand::base64url(&(self.random)())
    }
    pub fn uuid(&self) -> String {
        crate::rand::uuid_v4(&(self.random)())
    }
}

impl Default for Options {
    fn default() -> Options {
        // A counter, not randomness: only for tests and tools. The Worker and every real host pass their CSPRNG.
        let counter = std::cell::Cell::new(0u64);
        let random = move || {
            counter.set(counter.get() + 1);
            let mut b = [0u8; 32];
            b[..8].copy_from_slice(&counter.get().to_le_bytes());
            b
        };
        Options {
            basemap: None,
            now: Box::new(|| 0),
            log: Box::new(|_| {}),
            new_id: Box::new(|| "s-0".into()),
            random: Box::new(random),
            fetch: crate::upstream::offline(),
            overpass_url: None,
            max_pack_bytes: 40_000_000,
        }
    }
}

pub struct App<D: Db> {
    pub db: D,
    pub options: Options,
}

fn same_origin(request: &Request) -> bool {
    request.header("origin").is_none_or(|o| o == request.origin())
}

impl<D: Db> App<D> {
    pub fn new(db: D, options: Options) -> App<D> {
        App { db, options }
    }

    /// `None` for anything outside `/api/v5/` (another part of the Worker answers it).
    pub async fn handle(&self, request: &Request) -> Option<Response> {
        let path = request.path();
        if !path.starts_with("/api/v5/") {
            return None;
        }
        let started = (self.options.now)();
        let rid = request_id(request.header("x-request-id"), || (self.options.new_id)());
        let template = route(path).map_or_else(|| "/api/v5/?".to_string(), |r| r.template());
        let mut response = match self.dispatch(request).await {
            Ok(response) => response,
            Err(_) => Response::error(&ApiError::new(ErrorCode::Internal)),
        };
        let ms = (self.options.now)().saturating_sub(started) as f64;
        let code = response.body_json().pointer("/error/code").and_then(|c| c.as_str()).map(str::to_string);
        (self.options.log)(&log_line(&rid, &template, &request.method, response.status, ms, &DbStats::default(), code.as_deref()));
        response.set_header("x-request-id", &rid);
        response.set_header("server-timing", &server_timing(ms, &DbStats::default()));
        Some(response)
    }

    async fn dispatch(&self, request: &Request) -> handlers::Outcome {
        let method = request.method.as_str();
        let now = (self.options.now)();
        let Some(route) = route(request.path()) else {
            return fail(ErrorCode::NotFound, "Unbekannte v5-Route.");
        };
        let campaign_id = match &route {
            Route::Basemap => {
                return if matches!(method, "GET" | "HEAD") {
                    Ok(handlers::basemap::basemap(&self.options))
                } else {
                    fail(ErrorCode::MethodNotAllowed, "Methode nicht erlaubt.")
                };
            }
            Route::PublicRoom { room_id, join } => {
                return match (join, method) {
                    (true, "POST") if !same_origin(request) => fail(ErrorCode::CrossOrigin, "Anfrage von fremdem Ursprung."),
                    (true, "POST") => handlers::rooms::join(&self.db, room_id, request, &self.options).await,
                    (false, "GET") => handlers::rooms::info(&self.db, room_id, request).await,
                    _ => fail(ErrorCode::MethodNotAllowed, "Methode nicht erlaubt."),
                };
            }
            Route::Campaign { campaign_id, .. } | Route::Room { campaign_id, .. } | Route::Area { campaign_id, .. } => campaign_id.clone(),
        };
        let Some(caller) = access::resolve(&self.db, request, &campaign_id, &iso(now)).await? else {
            return fail(ErrorCode::Unauthorized, "Kein Zugriff auf diese Aktion.");
        };
        if !matches!(method, "GET" | "HEAD") && !same_origin(request) {
            return fail(ErrorCode::CrossOrigin, "Anfrage von fremdem Ursprung.");
        }
        let (db, caller, id) = (&self.db, &caller, campaign_id.as_str());
        if let Route::Room { room_id, finish, .. } = &route {
            return match (finish, method) {
                (false, "PATCH") => handlers::rooms::update(db, caller, id, room_id, request, &self.options).await,
                (false, "DELETE") => handlers::rooms::delete(db, caller, id, room_id, now).await,
                (true, "POST") => handlers::rooms::finish(db, caller, id, room_id, request, now).await,
                _ => fail(ErrorCode::MethodNotAllowed, "Methode nicht erlaubt."),
            };
        }
        if let Route::Area { area_id, res, .. } = &route {
            return match (res, method) {
                (AreaRes::Prune, "POST") => handlers::cleanup::prune(db, caller, id, area_id, request, &self.options).await,
                (AreaRes::Forget, "POST") => handlers::cleanup::forget(db, caller, id, area_id, &self.options).await,
                (AreaRes::Pack, "GET") => handlers::packs::get(db, caller, id, area_id, request).await,
                (AreaRes::Pack, "POST") => handlers::packs::build(db, caller, id, area_id, request, &self.options).await,
                _ => fail(ErrorCode::MethodNotAllowed, "Methode nicht erlaubt."),
            };
        }
        let res = match &route {
            Route::Campaign { res, .. } => Some(*res),
            _ => None,
        };
        match (res, method) {
            (Some(CampaignRes::Meta), "GET") => handlers::meta::meta(db, caller, id, request, &self.options).await,
            (Some(CampaignRes::State), "GET") => handlers::state::pull(db, caller, id, request, now).await,
            (Some(CampaignRes::Ops), "POST") => handlers::ops::push(db, caller, id, request, now).await,
            (Some(CampaignRes::Notes), "GET") => handlers::notes::pull(db, caller, id, request, now).await,
            (Some(CampaignRes::Notes), "POST") => handlers::notes::push(db, caller, id, request, now).await,
            (Some(CampaignRes::Progress), "GET") => handlers::progress::get(db, caller, id, now).await,
            (Some(CampaignRes::Stats), "PUT") => handlers::progress::put_stats(db, caller, id, request, now).await,
            (Some(CampaignRes::Window), "PUT") => handlers::window::put(db, caller, id, request).await,
            (Some(CampaignRes::Rooms), "GET") => handlers::rooms::list(db, caller, id, now).await,
            (Some(CampaignRes::Rooms), "POST") => handlers::rooms::create(db, caller, id, request, &self.options).await,
            _ => fail(ErrorCode::MethodNotAllowed, "Methode nicht erlaubt."),
        }
    }
}
