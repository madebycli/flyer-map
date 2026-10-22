//! The bridge to the old server: `/api/v5/campaigns/<id>/...` of the Rust Worker (Plan 059 M4), same origin, session cookie. Real data and real
//! rights until the v6 server exists. What the old server cannot do (people, invitations, drawing) answers [`BackendError::Unsupported`], and
//! the screens say so instead of offering a button that fails.
pub mod rooms;
pub mod translate;

use super::{Backend, BackendError, Boot, Fut, PackRef};
use crate::{
    model::Lauf,
    platform::{http, HttpError},
};
use flyermap_sync::NetError;
use flyermap_wire::{meta::Meta, PushRequest, PushResponse, StatePage, WireOp};

const PULL_LIMIT: u32 = 1000;

#[derive(Clone)]
pub struct V5Backend {
    base: String,
}

impl V5Backend {
    pub fn new(campaign: &str) -> V5Backend {
        V5Backend { base: http::campaign_base(campaign) }
    }
}

fn net(error: &HttpError) -> NetError {
    NetError::new(&error.message, &error.diag_code())
}

fn pack_url(base: &str, which: &PackRef) -> String {
    let area = String::from(js_sys::encode_uri_component(&which.gebiet));
    match which.part {
        Some(part) => format!("{base}/areas/{area}/pack?part={part}"),
        None => format!("{base}/areas/{area}/pack"),
    }
}

impl Backend for V5Backend {
    fn name(&self) -> &'static str {
        "v5"
    }

    fn boot(&self) -> Fut<Result<Boot, BackendError>> {
        let base = self.base.clone();
        Box::pin(async move {
            let meta: Meta = http::get_json(&format!("{base}/meta")).await?;
            let mut boot = translate::boot(&meta);
            // the Räume of the old server are the Läufe; a failing list must not stop the start
            if let Ok(text) = http::get_text(&format!("{base}/rooms")).await {
                boot.world.laeufe.extend(rooms::active(&text));
            }
            Ok(boot)
        })
    }

    fn pack(&self, which: &PackRef) -> Fut<Result<Option<Vec<u8>>, BackendError>> {
        let url = pack_url(&self.base, which);
        Box::pin(async move {
            match http::get_bytes(&url).await {
                Ok(bytes) => Ok(Some(bytes.to_vec())),
                Err(e) if e.status == 404 => Ok(None),
                Err(e) => Err(e.into()),
            }
        })
    }

    fn build_pack(&self, which: &PackRef) -> Fut<Result<(), BackendError>> {
        let url = pack_url(&self.base, which);
        Box::pin(async move { http::post_json::<_, serde_json::Value>(&url, &serde_json::json!({})).await.map(|_| ()).map_err(Into::into) })
    }

    fn push(&self, ops: Vec<WireOp>) -> Fut<Result<PushResponse, NetError>> {
        let url = format!("{}/ops", self.base);
        Box::pin(async move { http::post_json(&url, &PushRequest { ops }).await.map_err(|e| net(&e)) })
    }

    fn pull(&self, since: u64) -> Fut<Result<StatePage, NetError>> {
        let url = format!("{}/state?since={since}&limit={PULL_LIMIT}", self.base);
        Box::pin(async move { http::get_json(&url).await.map_err(|e| net(&e)) })
    }

    fn laeufe(&self) -> Fut<Result<Vec<Lauf>, BackendError>> {
        let url = format!("{}/rooms", self.base);
        Box::pin(async move {
            match http::get_text(&url).await {
                Ok(text) => Ok(rooms::active(&text)),
                Err(e) if e.status == 401 => Err(BackendError::Unauthorized),
                Err(_) => Ok(Vec::new()),
            }
        })
    }
}
