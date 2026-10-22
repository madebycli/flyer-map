//! A request as the handlers see it, independent of the platform it came from.
use percent_encoding::percent_decode_str;

#[derive(Clone, Debug, Default)]
pub struct Request {
    pub method: String,
    /// The full URL (`https://host/path?query`).
    pub url: String,
    /// Header names in lower case.
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Request {
    pub fn new(method: &str, url: &str) -> Request {
        Request { method: method.to_string(), url: url.to_string(), ..Request::default() }
    }

    pub fn with_header(mut self, name: &str, value: &str) -> Request {
        self.headers.push((name.to_ascii_lowercase(), value.to_string()));
        self
    }

    pub fn with_body(mut self, body: impl Into<Vec<u8>>) -> Request {
        self.body = body.into();
        self
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        let name = name.to_ascii_lowercase();
        self.headers.iter().find(|(n, _)| *n == name).map(|(_, v)| v.as_str())
    }

    fn after_scheme(&self) -> &str {
        self.url.split_once("://").map_or(self.url.as_str(), |(_, rest)| rest)
    }

    /// `scheme://host[:port]`
    pub fn origin(&self) -> String {
        let scheme = self.url.split_once("://").map_or("https", |(s, _)| s);
        let host = self.after_scheme().split(['/', '?', '#']).next().unwrap_or("");
        format!("{scheme}://{host}")
    }

    /// The path, still percent-encoded (the router decodes the parts it extracts).
    pub fn path(&self) -> &str {
        let rest = self.after_scheme();
        let start = rest.find('/').unwrap_or(rest.len());
        let path = &rest[start..];
        let end = path.find(['?', '#']).unwrap_or(path.len());
        if path.is_empty() {
            "/"
        } else {
            &path[..end]
        }
    }

    /// A query parameter like `URLSearchParams.get` (first value, `+` as space, percent-decoded).
    pub fn query(&self, name: &str) -> Option<String> {
        let query = self.url.split_once('?')?.1.split('#').next().unwrap_or("");
        query.split('&').filter(|p| !p.is_empty()).find_map(|pair| {
            let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
            (decode_component(k) == name).then(|| decode_component(v))
        })
    }

    pub fn body_text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

/// `decodeURIComponent` for query parts (with `+` meaning space, as in forms).
pub fn decode_component(text: &str) -> String {
    percent_decode_str(&text.replace('+', " ")).decode_utf8_lossy().into_owned()
}

/// `decodeURIComponent` for a path segment: `None` when the escape is broken (JavaScript throws there).
pub fn decode_path_segment(text: &str) -> Option<String> {
    percent_decode_str(text).decode_utf8().ok().map(|s| s.into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parts_of_a_url() {
        let r = Request::new("GET", "https://example.test/api/v5/x%20y?since=3&limit=a+b&since=9#frag");
        assert_eq!(r.origin(), "https://example.test");
        assert_eq!(r.path(), "/api/v5/x%20y");
        assert_eq!(r.query("since").as_deref(), Some("3"));
        assert_eq!(r.query("limit").as_deref(), Some("a b"));
        assert_eq!(r.query("none"), None);
        assert_eq!(Request::new("GET", "https://h").path(), "/");
    }
}
