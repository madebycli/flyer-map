//! The engine's functions as typed async calls. JSON is only the edge towards the engine module; the app gets structs.
use super::{
    error::EngineError,
    network::{Found, Lassoed, LngLat, Network, Route},
    worker::{Arg, EngineWorker, Reply},
};
use flyermap_core::{Key, Status};
use js_sys::Uint8Array;
use serde::de::DeserializeOwned;

/// The engine of one Aktion: it holds every Gebiet's geometry and answers tiles, routes, lassos and searches.
pub struct Engine {
    worker: EngineWorker,
}

fn bytes_of(text: &str) -> Arg {
    Arg::Bytes(Uint8Array::from(text.as_bytes()))
}

fn result<T: DeserializeOwned>(reply: Reply) -> Result<T, EngineError> {
    let bytes = reply.bytes.map(|b| b.to_vec()).unwrap_or_default();
    if reply.n == 0 {
        return Err(EngineError::refused(&bytes));
    }
    serde_json::from_slice(&bytes).map_err(|_| EngineError::BadAnswer)
}

/// The engine's number for a status in the tiles (`st`): 1 completed, 2 later, 3 not-deliverable, 0 open.
pub fn status_code(status: Status) -> u8 {
    match status {
        Status::Open => 0,
        Status::Completed => 1,
        Status::Later => 2,
        Status::NotDeliverable => 3,
    }
}

impl Engine {
    pub fn start(url: &str) -> Option<Engine> {
        EngineWorker::start(url).map(|worker| Engine { worker })
    }

    /// A new, empty session.
    pub async fn reset(&self) -> Result<(), EngineError> {
        self.worker.call("session_reset", Vec::new(), false).await.map(|_| ())
    }

    /// Derive one Gebiet (or one part of a big one) from the unpacked pack; the bytes are handed over to the worker.
    pub async fn add_area(&self, raw: Uint8Array, ring: &[LngLat], cell: Option<[f64; 4]>) -> Result<Network, EngineError> {
        let ring = serde_json::to_string(ring).map_err(|_| EngineError::BadAnswer)?;
        let cell = cell.map(|c| serde_json::to_string(&c).unwrap_or_default()).unwrap_or_default();
        let args = vec![Arg::Bytes(raw), bytes_of(&ring), bytes_of(&cell), Arg::Num(0.0)];
        result(self.worker.call("session_add_area", args, true).await?)
    }

    /// The vector tile z/x/y (empty when there is nothing to draw).
    pub async fn tile(&self, z: u32, x: u32, y: u32) -> Result<Uint8Array, EngineError> {
        let reply = self.worker.call("session_tile", vec![Arg::Num(z.into()), Arg::Num(x.into()), Arg::Num(y.into())], false).await?;
        Ok(reply.bytes.unwrap_or_else(|| Uint8Array::new_with_length(0)))
    }

    /// The statuses the tiles cut from now on carry (so most of the colours come with the tiles, not through feature-state).
    pub async fn set_status(&self, entries: &[(Key, Status)]) -> Result<(), EngineError> {
        let list: Vec<(&str, u8)> = entries.iter().map(|(k, s)| (k.as_str(), status_code(*s))).collect();
        let json = serde_json::to_string(&list).map_err(|_| EngineError::BadAnswer)?;
        result::<serde_json::Value>(self.worker.call("session_set_status", vec![bytes_of(&json)], false).await?).map(|_| ())
    }

    /// The shortest way through the tapped street pieces, in order.
    pub async fn route(&self, anchors: &[String]) -> Result<Route, EngineError> {
        let json = serde_json::to_string(anchors).map_err(|_| EngineError::BadAnswer)?;
        result(self.worker.call("session_route", vec![bytes_of(&json)], false).await?)
    }

    /// Houses and street pieces inside a closed outline.
    pub async fn lasso(&self, ring: &[LngLat], houses_only: bool) -> Result<Lassoed, EngineError> {
        let json = serde_json::to_string(ring).map_err(|_| EngineError::BadAnswer)?;
        result(self.worker.call("session_lasso", vec![bytes_of(&json), Arg::Num(f64::from(u8::from(houses_only)))], false).await?)
    }

    /// Streets and addresses for the search field.
    pub async fn search(&self, query: &str, limit: u32) -> Result<Vec<Found>, EngineError> {
        result(self.worker.call("session_search", vec![bytes_of(query), Arg::Num(limit.into())], false).await?)
    }
}
