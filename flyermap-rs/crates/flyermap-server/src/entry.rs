//! The Cloudflare entry: translate the platform's request into ours, ask the app, translate the answer back. Nothing here decides anything.
use crate::{kdf_web::WebKdf, App, Env};
use flyermap_host::{
    db::d1::D1Db,
    http::request::Request,
    platform::{env_limiter, env_vars},
};
use worker::{event, Context, Date, Env as CfEnv, Headers, Method, Response as CfResponse, Result};

#[event(fetch)]
async fn fetch(mut req: worker::Request, cf: CfEnv, _ctx: Context) -> Result<CfResponse> {
    let headers: Vec<(String, String)> = req.headers().entries().map(|(k, v)| (k.to_ascii_lowercase(), v)).collect();
    let method = req.method().to_string();
    let url = req.url()?.to_string();
    let body = if matches!(req.method(), Method::Get | Method::Head) { Vec::new() } else { req.bytes().await.unwrap_or_default() };
    let request = Request { method, url, headers, body };
    let env = Env::new(
        Box::new(|| Date::now().as_millis()),
        Box::new(|| {
            use wasm_bindgen::JsCast;
            let mut bytes = [0u8; 32];
            let scope: web_sys::WorkerGlobalScope = js_sys::global().unchecked_into();
            scope.crypto().and_then(|c| c.get_random_values_with_u8_array(&mut bytes)).expect("crypto.getRandomValues");
            bytes
        }),
        Box::new(|line| worker::console_log!("{line}")),
        Box::new(|| format!("s-{:x}", (js_sys::Math::random() * 1e12) as u64)),
        env_limiter(cf.clone()),
        Box::new(WebKdf),
        &env_vars(cf.clone()),
    );
    let app = App::new(D1Db(cf.d1("DB")?), env);
    match app.handle(&request).await {
        Some(response) => {
            let out = Headers::new();
            for (name, value) in &response.headers {
                out.append(name, value)?;
            }
            Ok(CfResponse::from_bytes(response.body)?.with_status(response.status).with_headers(out))
        }
        None => CfResponse::error("Not found", 404),
    }
}
