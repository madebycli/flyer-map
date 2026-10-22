//! Reading a JSON object body with the same refusals everywhere: wrong type (415), too large (413), not JSON (400), not an object (400).
use super::fail;
use crate::http::{request::Request, response::Response};
use flyermap_wire::ErrorCode;
use serde_json::{Map, Value};

pub fn read_json(request: &Request, max_chars: usize) -> Result<Map<String, Value>, Response> {
    let refuse = |code, message: &str| fail(code, message).unwrap_or_else(|_| crate::http::error_response(&flyermap_wire::ApiError::new(ErrorCode::Internal)));
    if !request.header("content-type").unwrap_or("").contains("application/json") {
        return Err(refuse(ErrorCode::UnsupportedMediaType, "JSON erwartet."));
    }
    let text = request.body_text();
    if text.encode_utf16().count() > max_chars {
        return Err(refuse(ErrorCode::TooLarge, "Anfrage zu groß."));
    }
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(map)) => Ok(map),
        Ok(_) => Err(refuse(ErrorCode::InvalidJson, "JSON-Objekt erwartet.")),
        Err(_) => Err(refuse(ErrorCode::InvalidJson, "Ungültiges JSON.")),
    }
}

/// An integer in `min..=max` (JSON numbers like `3.0` count as integers, as `Number.isInteger` does).
pub fn int_in(value: Option<&Value>, min: i64, max: i64) -> Option<i64> {
    let v = value?.as_f64()?;
    (v.fract() == 0.0 && v >= min as f64 && v <= max as f64).then_some(v as i64)
}
