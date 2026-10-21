use crate::{app::Options, http::response::Response};
use serde_json::json;

/// The deployment's basemap, without a campaign (the admin pages place the map focus with it). Style URLs reach every client anyway: no secrets in them.
pub fn basemap(options: &Options) -> Response {
    let basemap = options.basemap.as_ref().filter(|b| b.dark.is_some() || b.light.is_some());
    Response::json_with(200, &json!({ "basemap": basemap }), "public, max-age=300")
}
