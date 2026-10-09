//! Questions the app asks the engine about what it holds: which houses and street pieces lie inside a lasso, and street/address
//! search. Same answers as the TypeScript reference (`src/v5/engine/search.ts`, `app/mark.ts` lasso), checked differentially.
use crate::model::LngLat;
use std::cmp::Ordering;
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

/// Same test as `pointInRing` in geo.ts (even-odd rule).
pub fn point_in_ring(p: LngLat, ring: &[LngLat]) -> bool {
    let mut inside = false;
    let mut j = ring.len().wrapping_sub(1);
    for i in 0..ring.len() {
        let (xi, yi, xj, yj) = (ring[i][0], ring[i][1], ring[j][0], ring[j][1]);
        if (yi > p[1]) != (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Bounding-box pre-check plus ring test; `None` when fewer than three points (a lasso needs a shape).
pub struct Lasso<'a> { ring: &'a [LngLat], w: f64, s: f64, e: f64, n: f64 }
impl<'a> Lasso<'a> {
    pub fn new(ring: &'a [LngLat]) -> Option<Self> {
        if ring.len() < 3 { return None; }
        let (mut w, mut s, mut e, mut n) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
        for p in ring { w = w.min(p[0]); e = e.max(p[0]); s = s.min(p[1]); n = n.max(p[1]); }
        Some(Lasso { ring, w, s, e, n })
    }
    pub fn contains(&self, p: LngLat) -> bool { p[0] >= self.w && p[0] <= self.e && p[1] >= self.s && p[1] <= self.n && point_in_ring(p, self.ring) }
}

/// JavaScript's `\s` (and `trim`) set; Rust's `char::is_whitespace` differs at U+0085 and U+FEFF.
fn js_space(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}
/// JavaScript's ASCII `\w` (what `\b` means without the `i` flag).
fn js_word(c: char) -> bool { c.is_ascii_alphanumeric() || c == '_' }

/// Case, umlauts and the spellings of "Straße" must not matter: lower case, accents stripped, ß → ss, "str"/"str." → "strasse".
/// Mirrors `fold` in `src/v5/engine/search.ts` rule by rule.
pub fn fold(text: &str) -> String {
    // lowercase → NFD → drop combining marks → ß → ss
    let mut chars: Vec<char> = Vec::with_capacity(text.len());
    for c in text.to_lowercase().nfd() {
        if is_combining_mark(c) { continue; }
        if c == 'ß' { chars.push('s'); chars.push('s'); } else { chars.push(c); }
    }
    // .replace(/\bstr\b\.?/g, 'strasse')
    let mut a: Vec<char> = Vec::with_capacity(chars.len() + 8);
    let mut i = 0;
    while i < chars.len() {
        let is_str = i + 3 <= chars.len() && chars[i] == 's' && chars[i + 1] == 't' && chars[i + 2] == 'r'
            && (i == 0 || !js_word(chars[i - 1])) && (i + 3 == chars.len() || !js_word(chars[i + 3]));
        if is_str {
            a.extend("strasse".chars());
            i += 3;
            if i < chars.len() && chars[i] == '.' { i += 1; }
        } else { a.push(chars[i]); i += 1; }
    }
    // .replace(/str\.(?=\s|$)/g, 'strasse')
    let mut b: Vec<char> = Vec::with_capacity(a.len());
    let mut i = 0;
    while i < a.len() {
        if i + 4 <= a.len() && a[i] == 's' && a[i + 1] == 't' && a[i + 2] == 'r' && a[i + 3] == '.' && (i + 4 == a.len() || js_space(a[i + 4])) {
            b.extend("strasse".chars());
            i += 4;
        } else { b.push(a[i]); i += 1; }
    }
    // .replace(/\s+/g, ' ').trim()
    let mut out = String::with_capacity(b.len());
    let mut pending_space = false;
    for c in b {
        if js_space(c) { pending_space = true; continue; }
        if pending_space && !out.is_empty() { out.push(' '); }
        pending_space = false;
        out.push(c);
    }
    out
}

/// Deterministic "natural" order: digit runs compare by value, everything else by code point.
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (mut x, mut y) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (x.peek().copied(), y.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(p), Some(q)) if p.is_ascii_digit() && q.is_ascii_digit() => {
                let (mut dx, mut dy) = (String::new(), String::new());
                while let Some(&c) = x.peek() { if c.is_ascii_digit() { dx.push(c); x.next(); } else { break; } }
                while let Some(&c) = y.peek() { if c.is_ascii_digit() { dy.push(c); y.next(); } else { break; } }
                let (tx, ty) = (dx.trim_start_matches('0'), dy.trim_start_matches('0'));
                let o = tx.len().cmp(&ty.len()).then_with(|| tx.cmp(ty)).then_with(|| dx.len().cmp(&dy.len()));
                if o != Ordering::Equal { return o; }
            }
            (Some(p), Some(q)) => {
                if p != q { return p.cmp(&q); }
                x.next(); y.next();
            }
        }
    }
}

pub struct Entry { pub street: bool, pub id: String, pub label: String, pub detail: String, pub norm: String }

/// Every word of the query must occur; prefix matches and streets first, then natural order of the folded text.
pub fn search(entries: &[Entry], query: &str, limit: usize) -> Vec<usize> {
    let folded = fold(query);
    let words: Vec<&str> = folded.split(' ').filter(|w| !w.is_empty()).collect();
    if words.is_empty() { return Vec::new(); }
    let mut scored: Vec<(usize, usize)> = Vec::new();
    'entry: for (index, entry) in entries.iter().enumerate() {
        let mut score = 0usize;
        for word in &words {
            match entry.norm.find(word) {
                None => continue 'entry,
                Some(0) => {}
                Some(at) => score += if entry.norm[..at].ends_with(' ') { 1 } else { 3 },
            }
        }
        scored.push((score * 2 + if entry.street { 0 } else { 1 }, index));
    }
    scored.sort_by(|a, b| {
        let (x, y) = (&entries[a.1], &entries[b.1]);
        a.0.cmp(&b.0).then_with(|| natural_cmp(&x.norm, &y.norm)).then_with(|| natural_cmp(&x.label, &y.label)).then_with(|| x.id.cmp(&y.id))
    });
    scored.into_iter().take(limit).map(|(_, i)| i).collect()
}
