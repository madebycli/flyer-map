//! Requests to the app's own server (`/api/v5/...`): same origin, the session cookie goes along, JSON in and out, bytes for the map packs.
use super::http_error::HttpError;
use serde::{de::DeserializeOwned, Serialize};
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;

async fn send(method: &str, url: &str, body: Option<&str>) -> Result<web_sys::Response, HttpError> {
    let init = web_sys::RequestInit::new();
    init.set_method(method);
    init.set_credentials(web_sys::RequestCredentials::SameOrigin);
    if let Some(body) = body {
        let headers = web_sys::Headers::new().map_err(|_| HttpError::network())?;
        let _ = headers.set("content-type", "application/json");
        init.set_headers(&headers);
        init.set_body(&JsValue::from_str(body));
    }
    let window = web_sys::window().ok_or_else(HttpError::network)?;
    let answer = JsFuture::from(window.fetch_with_str_and_init(url, &init)).await.map_err(|_| HttpError::network())?;
    let response: web_sys::Response = answer.dyn_into().map_err(|_| HttpError::network())?;
    if response.ok() {
        return Ok(response);
    }
    let text = match response.text() {
        Ok(p) => JsFuture::from(p).await.ok().and_then(|v| v.as_string()).unwrap_or_default(),
        Err(_) => String::new(),
    };
    Err(HttpError::from_answer(response.status(), &text))
}

async fn text_of(response: web_sys::Response) -> Result<String, HttpError> {
    let promise = response.text().map_err(|_| HttpError::bad_answer())?;
    JsFuture::from(promise).await.ok().and_then(|v| v.as_string()).ok_or_else(HttpError::network)
}

pub async fn get_json<T: DeserializeOwned>(url: &str) -> Result<T, HttpError> {
    let text = text_of(send("GET", url, None).await?).await?;
    serde_json::from_str(&text).map_err(|_| HttpError::bad_answer())
}

/// The body of an answer as it is (the caller reads the parts it needs).
pub async fn get_text(url: &str) -> Result<String, HttpError> {
    text_of(send("GET", url, None).await?).await
}

pub async fn post_json<B: Serialize, T: DeserializeOwned>(url: &str, body: &B) -> Result<T, HttpError> {
    let body = serde_json::to_string(body).map_err(|_| HttpError::bad_answer())?;
    let text = text_of(send("POST", url, Some(&body)).await?).await?;
    serde_json::from_str(&text).map_err(|_| HttpError::bad_answer())
}

/// The raw bytes of an answer (a gzip map pack).
pub async fn get_bytes(url: &str) -> Result<js_sys::Uint8Array, HttpError> {
    let response = send("GET", url, None).await?;
    let promise = response.array_buffer().map_err(|_| HttpError::bad_answer())?;
    let buffer = JsFuture::from(promise).await.map_err(|_| HttpError::network())?;
    Ok(js_sys::Uint8Array::new(&buffer))
}

/// `/api/v5/campaigns/<id>` with the id escaped.
pub fn campaign_base(campaign: &str) -> String {
    format!("/api/v5/campaigns/{}", String::from(js_sys::encode_uri_component(campaign)))
}
