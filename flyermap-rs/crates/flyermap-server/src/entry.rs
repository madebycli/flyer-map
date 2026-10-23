//! The Cloudflare entry: translate the platform's request into ours, ask the app, translate the answer back. Nothing here decides anything.
use crate::{
    akteur_host::{request_of, response_of, DoAkteure},
    kdf_web::WebKdf,
    App, Env,
};
use flyermap_host::{
    db::d1::D1Db,
    platform::{env_limiter, env_vars},
};
use worker::{event, Context, Date, Env as CfEnv, Response as CfResponse, Result};

#[event(fetch)]
async fn fetch(mut req: worker::Request, cf: CfEnv, _ctx: Context) -> Result<CfResponse> {
    let request = request_of(&mut req).await?;
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
    let app = App::new(D1Db(cf.d1("DB")?), env).with_akteure(DoAkteure { namespace: cf.durable_object("AKTION")? });
    #[cfg(feature = "probe")]
    if request.path() == "/__probe/atomic" {
        use crate::akteur::Akteure;
        let answer = app
            .akteure
            .call("probe", flyermap_host::http::request::Request::new("GET", "https://akteur.internal/probe"))
            .await
            .map_err(worker::Error::RustError)?;
        return response_of(answer);
    }
    // a live connection is handed to the Akteur's object as a whole: a socket does not fit a `Response`
    if let Some(live) = app.live_link(&request).await {
        return match live {
            Ok(link) => app.akteure.upgrade(&link, &req).await,
            Err(failure) => response_of(failure.response()),
        };
    }
    match app.handle(&request).await {
        Some(response) => response_of(response),
        None => CfResponse::error("Not found", 404),
    }
}
