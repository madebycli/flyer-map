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
}

impl Default for Options {
    fn default() -> Options {
        Options {
            basemap: None,
            now: Box::new(|| 0),
            log: Box::new(|_| {}),
            new_id: Box::new(|| "s-0".into()),
        }
    }
}

pub struct App<D: Db> {
    pub db: D,
    pub options: Options,
}

fn same_origin(request: &Request) -> bool {
    request
        .header("origin")
        .is_none_or(|o| o == request.origin())
}

/// Combinations the TypeScript Worker answers that are not here yet: they say so (501) instead of pretending (405).
fn not_moved_yet(route: &Route, method: &str) -> bool {
    match route {
        Route::Campaign { res, .. } => matches!(
            (res, method),
            (CampaignRes::Notes, "GET" | "POST")
                | (CampaignRes::Progress, "GET")
                | (CampaignRes::Stats, "PUT")
                | (CampaignRes::Window, "PUT")
                | (CampaignRes::Rooms, "GET" | "POST")
        ),
        Route::Room { finish: false, .. } => matches!(method, "PATCH" | "DELETE"),
        Route::Room { finish: true, .. } => method == "POST",
        Route::Area {
            res: AreaRes::Pack, ..
        } => matches!(method, "GET" | "POST"),
        Route::Area { .. } => method == "POST",
        Route::PublicRoom { join, .. } => (*join && method == "POST") || (!join && method == "GET"),
        Route::Basemap => false,
    }
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
        let code = response
            .body_json()
            .pointer("/error/code")
            .and_then(|c| c.as_str())
            .map(str::to_string);
        (self.options.log)(&log_line(
            &rid,
            &template,
            &request.method,
            response.status,
            ms,
            &DbStats::default(),
            code.as_deref(),
        ));
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
            Route::PublicRoom { .. } => {
                return if not_moved_yet(&route, method) {
                    fail(
                        ErrorCode::NotImplemented,
                        ErrorCode::NotImplemented.message(),
                    )
                } else {
                    fail(ErrorCode::MethodNotAllowed, "Methode nicht erlaubt.")
                };
            }
            Route::Campaign { campaign_id, .. }
            | Route::Room { campaign_id, .. }
            | Route::Area { campaign_id, .. } => campaign_id.clone(),
        };
        let Some(caller) = access::resolve(&self.db, request, &campaign_id, &iso(now)).await?
        else {
            return fail(ErrorCode::Unauthorized, "Kein Zugriff auf diese Aktion.");
        };
        if !matches!(method, "GET" | "HEAD") && !same_origin(request) {
            return fail(ErrorCode::CrossOrigin, "Anfrage von fremdem Ursprung.");
        }
        match (&route, method) {
            (
                Route::Campaign {
                    res: CampaignRes::Meta,
                    ..
                },
                "GET",
            ) => {
                handlers::meta::meta(&self.db, &caller, &campaign_id, request, &self.options).await
            }
            (
                Route::Campaign {
                    res: CampaignRes::State,
                    ..
                },
                "GET",
            ) => handlers::state::pull(&self.db, &caller, &campaign_id, request, now).await,
            (
                Route::Campaign {
                    res: CampaignRes::Ops,
                    ..
                },
                "POST",
            ) => handlers::ops::push(&self.db, &caller, &campaign_id, request, now).await,
            _ if not_moved_yet(&route, method) => fail(
                ErrorCode::NotImplemented,
                ErrorCode::NotImplemented.message(),
            ),
            _ => fail(ErrorCode::MethodNotAllowed, "Methode nicht erlaubt."),
        }
    }
}
