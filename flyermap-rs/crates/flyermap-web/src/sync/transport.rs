//! The sync loop's requests: push edits (`POST /ops`), pull the shared state page by page (`GET /state`), pull notes (`GET /notes`).
use crate::platform::{http, HttpError};
use flyermap_core::note::Note;
use flyermap_sync::NetError;
use flyermap_wire::{PushRequest, PushResponse, StatePage, WireOp};
use serde::Deserialize;

const PULL_LIMIT: u32 = 1000;
const NOTES_LIMIT: u32 = 500;

pub fn net_error(error: &HttpError) -> NetError {
    NetError::new(&error.message, &error.diag_code())
}

pub async fn push(base: &str, ops: Vec<WireOp>) -> Result<PushResponse, NetError> {
    http::post_json(&format!("{base}/ops"), &PushRequest { ops }).await.map_err(|e| net_error(&e))
}

pub async fn pull(base: &str, since: u64) -> Result<StatePage, NetError> {
    http::get_json(&format!("{base}/state?since={since}&limit={PULL_LIMIT}")).await.map_err(|e| net_error(&e))
}

#[derive(Deserialize)]
pub struct NotesPage {
    pub notes: Vec<Note>,
    pub cursor: u64,
    pub more: bool,
}

pub async fn pull_notes(base: &str, since: u64) -> Result<NotesPage, NetError> {
    http::get_json(&format!("{base}/notes?since={since}&limit={NOTES_LIMIT}")).await.map_err(|e| net_error(&e))
}
