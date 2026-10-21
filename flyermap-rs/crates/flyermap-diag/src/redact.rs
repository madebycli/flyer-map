//! Nothing that identifies a person, a place or a session may enter a log or a report: positions stay on the device, links and cookies are credentials.
//! Redaction is textual (token-like strings, addresses, coordinates, numbers) and structural (by key). Foreign text (an exception, a library line, a
//! server's error body) is never kept as it is: it is *recognised* or only its length is recorded.
use regex_lite::Regex;
use std::sync::OnceLock;

pub const MAX_TEXT: usize = 300;
pub const MAX_KEYS: usize = 40;

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("redaction pattern"))
}

/// Keys whose values must never be recorded, whatever they hold.
pub fn is_secret_key(key: &str) -> bool {
    const KEYS: &[&str] = &[
        "lat",
        "lng",
        "lon",
        "latitude",
        "longitude",
        "coord",
        "coords",
        "coordinates",
        "center",
        "centre",
        "position",
        "geometry",
        "ring",
        "bbox",
        "bounds",
        "token",
        "secret",
        "password",
        "passwd",
        "cookie",
        "authorization",
        "auth",
        "session",
        "hash",
        "access",
        "label",
        "name",
        "address",
        "title",
        "text",
        "body",
        "email",
        "note",
        "notes",
    ];
    KEYS.iter().any(|k| key.eq_ignore_ascii_case(k))
}

/// Defence in depth for every string that is recorded: addresses, coordinates, long numbers, e-mail addresses and token-like strings never survive.
/// This does not make arbitrary foreign text safe (a name has no recognisable shape): that is [`foreign_message`]'s job.
pub fn redact_text(text: &str, max: usize) -> String {
    static FRAGMENT: OnceLock<Regex> = OnceLock::new();
    static URL: OnceLock<Regex> = OnceLock::new();
    static BARE_URL: OnceLock<Regex> = OnceLock::new();
    static QUERY: OnceLock<Regex> = OnceLock::new();
    static EMAIL: OnceLock<Regex> = OnceLock::new();
    static PAIR: OnceLock<Regex> = OnceLock::new();
    static COORD: OnceLock<Regex> = OnceLock::new();
    static DIGITS: OnceLock<Regex> = OnceLock::new();
    static TOKEN: OnceLock<Regex> = OnceLock::new();
    // Cut first (with room for a whole address at the edge), so the cost never depends on what someone threw at us.
    let head: String = text.chars().take(max + 200).collect();
    let cut = head.chars().count() < text.chars().count();
    let mut s = re(&FRAGMENT, r"#(access|collection)=\S+").replace_all(&head, "#$1=[removed]").into_owned();
    s = re(&URL, r#"(?i)\b(?:https?|wss?|blob|data):[^\s"'<>)]*"#).replace_all(&s, "[url]").into_owned();
    s = re(&BARE_URL, r#"(?i)(?://[^\s"'<>)]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+/[^\s"'<>)]*)"#).replace_all(&s, "[url]").into_owned();
    s = re(&QUERY, r#"\?[^\s=&"'<>]{1,40}=[^\s"'<>]*"#).replace_all(&s, "[query]").into_owned();
    s = re(&EMAIL, r"[^\s@]{1,64}@[^\s@.]{1,63}(?:\.[^\s@.]{1,63}){1,4}").replace_all(&s, "[email]").into_owned();
    s = re(&PAIR, r"-?\d{1,3}[.,]\d{3,}\s*[,;/ ]\s*-?\d{1,3}[.,]\d{3,}").replace_all(&s, "[num]").into_owned();
    s = re(&COORD, r"-?\d{1,3}[.,]\d{4,}").replace_all(&s, "[num]").into_owned();
    s = re(&DIGITS, r"\d{6,}").replace_all(&s, "[num]").into_owned();
    s = re(&TOKEN, r"[A-Za-z0-9_-]{32,}").replace_all(&s, "[token]").into_owned();
    if s.chars().count() > max || cut {
        let kept: String = s.chars().take(max).collect();
        format!("{kept}…")
    } else {
        s
    }
}

/// Text from outside our own code can hold anything. It is kept only when it starts like a message we know to be technical (and then only that start);
/// otherwise only its length is recorded. Extend the list when a harmless message is missed in the field; never loosen it to "keep most text".
pub fn foreign_message(text: &str) -> String {
    static KNOWN: OnceLock<Vec<Regex>> = OnceLock::new();
    static PLACEHOLDER: OnceLock<Regex> = OnceLock::new();
    let text = text.trim();
    if text.is_empty() {
        return String::new();
    }
    if re(&PLACEHOLDER, r"^\[(?:text|object|array|value) removed(?:, \d+ (?:chars|keys|items))?\]$").is_match(text) {
        return text.to_string();
    }
    let known = KNOWN.get_or_init(|| {
        [
            r"^Failed to fetch\b",
            r"^Load failed\b",
            r"^NetworkError\b",
            r"^The operation (?:was aborted|timed out)\b",
            r"(?i)^signal is aborted\b",
            r"(?i)^(?:Request )?timed out\b",
            r"^AbortError\b",
            r"(?i)^Out of memory\b",
            r"^QuotaExceededError\b",
            r"(?i)^The quota has been exceeded\b",
            r"(?i)^(?:Could not create a WebGL context|Failed to initialize WebGL|WebGL context lost)\b",
            r"^Script error\.?$",
            r"^ResizeObserver loop (?:limit exceeded|completed with undelivered notifications)\b",
            r"^Cannot read propert(?:y|ies) of (?:undefined|null)\b",
            r"^HTTP \d{3}\b",
            r"^status \d{3}\b",
            r"(?i)^Unexpected end of (?:JSON )?input\b",
            r"^Serverfehler \d{3}\b",
            r"^\d{3} [a-z][a-z0-9_]{1,40}$",
            r"^Uncaught (?:[A-Z][A-Za-z]{1,30})?Error\b",
            r"^Unable to load glyph range\b",
            r"^Failed to load font\b",
            r"^CompileError\b",
            r"^LinkError\b",
            r"^RuntimeError: (?:unreachable|memory access out of bounds|out of memory)\b",
        ]
        .iter()
        .map(|p| Regex::new(p).expect("known message pattern"))
        .collect()
    });
    for pattern in known {
        if let Some(hit) = pattern.find(text) {
            return redact_text(hit.as_str(), 80);
        }
    }
    format!("[text removed, {} chars]", text.chars().count())
}

/// An address reduced to what it is, not where it points: the kind of resource, never a path, tile number or query.
pub fn url_kind(url: &str) -> &'static str {
    let path = url.split(['?', '#']).next().unwrap_or("");
    let path = path.strip_prefix("https://").or_else(|| path.strip_prefix("http://")).map_or(path, |rest| rest.find('/').map_or("", |i| &rest[i..]));
    if path.starts_with("/api/") {
        "api"
    } else if path.ends_with(".pbf") || path.ends_with(".mvt") {
        "tile"
    } else if path.contains("/fonts/") || path.ends_with(".pbf.gz") {
        "glyphs"
    } else if path.ends_with(".json") && path.contains("style") {
        "style"
    } else if path.ends_with(".wasm") {
        "wasm"
    } else if path.ends_with(".js") || path.ends_with(".mjs") {
        "script"
    } else if path.ends_with(".css") {
        "stylesheet"
    } else if path.ends_with(".png") || path.ends_with(".jpg") || path.ends_with(".webp") || path.ends_with(".svg") {
        "image"
    } else {
        "other"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_identifies_a_place_or_a_session_does_not_survive() {
        let cases = [
            ("opened https://x.example/api/v5/campaigns/abc?token=secret now", "opened [url] now"),
            ("at 51.12345, 13.54321 and 51,12345", "at [num] and [num]"),
            ("mail me@example.org please", "mail [email] please"),
            ("id 123456789 ok", "id [num] ok"),
            ("key AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA end", "key [token] end"),
            ("link #access=abcdef rest", "link #access=[removed] rest"),
            ("host.tld/some/path here", "[url] here"),
        ];
        for (input, expected) in cases {
            assert_eq!(redact_text(input, 300), expected, "{input}");
        }
    }

    #[test]
    fn long_text_is_cut_and_marked() {
        let out = redact_text(&"ab ".repeat(500), 50);
        assert_eq!(out.chars().count(), 51);
        assert!(out.ends_with('…'));
    }

    #[test]
    fn foreign_text_is_recognised_or_only_measured() {
        assert_eq!(foreign_message("Failed to fetch https://secret.example/x"), "Failed to fetch");
        assert_eq!(foreign_message("403 cross_origin"), "403 cross_origin");
        assert_eq!(foreign_message("Max Mustermann wohnt in der Hauptstr. 5"), "[text removed, 39 chars]");
        assert_eq!(foreign_message("[text removed, 5 chars]"), "[text removed, 5 chars]");
        assert_eq!(foreign_message("   "), "");
    }

    #[test]
    fn secret_keys_are_recognised_in_any_case() {
        for key in ["lat", "Token", "COORDS", "name", "note"] {
            assert!(is_secret_key(key), "{key}");
        }
        assert!(!is_secret_key("count"));
    }

    #[test]
    fn addresses_are_reduced_to_their_kind() {
        assert_eq!(url_kind("https://h.example/api/v5/x?y=1"), "api");
        assert_eq!(url_kind("https://tiles.example/12/3/4.pbf"), "tile");
        assert_eq!(url_kind("/assets/engine.wasm"), "wasm");
        assert_eq!(url_kind("https://h.example/style.json"), "style");
        assert_eq!(url_kind("/something"), "other");
    }
}
