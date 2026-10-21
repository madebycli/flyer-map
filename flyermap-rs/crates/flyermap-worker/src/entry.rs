//! The Cloudflare entry: turn the platform's request into ours, ask the app, turn the answer back. Nothing here decides anything.
use crate::{config::basemap_from_env, db::d1::D1Db, App, Options, Request};
use worker::{event, Context, Date, Env, Headers, Method, Response as CfResponse, Result};

#[event(fetch)]
async fn fetch(mut req: worker::Request, env: Env, _ctx: Context) -> Result<CfResponse> {
    let headers: Vec<(String, String)> = req.headers().entries().map(|(k, v)| (k.to_ascii_lowercase(), v)).collect();
    let method = req.method().to_string();
    let url = req.url()?.to_string();
    let body = if matches!(req.method(), Method::Get | Method::Head) { Vec::new() } else { req.bytes().await.unwrap_or_default() };
    let request = Request { method, url, headers, body };
    let var = |name: &str| env.var(name).ok().map(|v| v.to_string());
    // A fixed clock only for contract replays on a local machine (RUNTIME_ENVIRONMENT=local-test); every deployed environment uses the real one.
    let fixed = (var("RUNTIME_ENVIRONMENT").as_deref() == Some("local-test")).then(|| var("TEST_FIXED_NOW_MS").and_then(|v| v.parse::<u64>().ok())).flatten();
    let options = Options {
        basemap: Some(basemap_from_env(var)),
        now: Box::new(move || fixed.unwrap_or_else(|| Date::now().as_millis())),
        log: Box::new(|line| worker::console_log!("{line}")),
        new_id: Box::new(|| format!("s-{:x}", (js_sys::Math::random() * 1e12) as u64)),
    };
    let app = App::new(D1Db(env.d1("DB")?), options);
    match app.handle(&request).await {
        Some(response) => {
            let out = Headers::new();
            for (name, value) in &response.headers {
                out.set(name, value)?;
            }
            Ok(CfResponse::from_bytes(response.body)?.with_status(response.status).with_headers(out))
        }
        // Not ours: the static app and the routes that have not moved yet are served by the assets binding.
        None => env.assets("ASSETS")?.fetch_request(req).await,
    }
}
