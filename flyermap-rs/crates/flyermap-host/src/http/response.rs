use serde::Serialize;

#[derive(Clone, Debug, PartialEq)]
pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }

    pub fn set_header(&mut self, name: &str, value: &str) {
        self.headers.retain(|(n, _)| !n.eq_ignore_ascii_case(name));
        self.headers.push((name.to_ascii_lowercase(), value.to_string()));
    }

    /// A JSON answer that is never cached and never sniffed (every API answer except the public basemap).
    pub fn json<T: Serialize>(status: u16, body: &T) -> Response {
        let mut r = Response::json_with(status, body, "no-store");
        r.set_header("x-content-type-options", "nosniff");
        r
    }

    pub fn json_with<T: Serialize>(status: u16, body: &T, cache_control: &str) -> Response {
        Response {
            status,
            headers: vec![("content-type".into(), "application/json".into()), ("cache-control".into(), cache_control.into())],
            body: serde_json::to_vec(body).unwrap_or_else(|_| b"null".to_vec()),
        }
    }

    /// The usual error answer: `{"error":{"code":…,"message":…}}`, never cached.
    pub fn error(status: u16, code: &str, message: &str) -> Response {
        Response::json(status, &serde_json::json!({ "error": { "code": code, "message": message } }))
    }

    pub fn body_json(&self) -> serde_json::Value {
        serde_json::from_slice(&self.body).unwrap_or(serde_json::Value::Null)
    }
}
