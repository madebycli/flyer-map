use crate::http::request::{decode_component, Request};

pub const SESSION_COOKIE: &str = "vf_session";
pub const COLLECTION_COOKIE: &str = "vf_collection_session";

/// The first cookie of that name, decoded.
pub fn cookie(request: &Request, name: &str) -> Option<String> {
    let header = request.header("cookie")?;
    header.split(';').find_map(|part| {
        let (k, v) = part.trim().split_once('=').unwrap_or((part.trim(), ""));
        (k == name).then(|| decode_component(&v.replace('+', "%2B")))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_and_decodes() {
        let r = Request::new("GET", "https://h/").with_header("cookie", "a=1; vf_session=x%2Fy=z; b=2");
        assert_eq!(cookie(&r, "vf_session").as_deref(), Some("x/y=z"));
        assert_eq!(cookie(&r, "none"), None);
    }
}
