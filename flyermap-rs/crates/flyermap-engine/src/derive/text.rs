//! Text helpers that behave exactly like the TypeScript reference (trim, names, counters).
use crate::geo::coord_key;
use crate::model::*;
use std::collections::BTreeMap;
use unicode_normalization::UnicodeNormalization;

/// JS `String.prototype.trim` (White_Space plus the byte order mark).
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}')
}

pub(super) fn trimmed(tags: &Tags, key: &str) -> Option<String> {
    tags.get(key).map(|v| js_trim(v).to_string())
}

pub(super) fn non_empty(v: Option<String>) -> Option<String> {
    v.filter(|s| !s.is_empty())
}

pub(super) fn normalize_name(name: Option<&str>) -> String {
    let lowered: String = name.unwrap_or("").nfkc().collect::<String>().to_lowercase();
    let replaced = lowered.replace("straße", "str").replace("strasse", "str");
    let kept: String = replaced.chars().filter(|c| !(c.is_whitespace() || *c == '\u{FEFF}' || *c == '.' || *c == '-')).collect();
    js_trim(&kept).to_string()
}

pub(super) fn vertex_key(way: &RawWay, index: usize) -> String {
    match way.nodes.as_ref().and_then(|n| n.get(index)) {
        Some(node) => format!("n{node}"),
        None => format!("c{}", coord_key(way.coords[index])),
    }
}

pub(super) fn bump(map: &mut BTreeMap<String, u32>, key: String) {
    *map.entry(key).or_insert(0) += 1;
}
