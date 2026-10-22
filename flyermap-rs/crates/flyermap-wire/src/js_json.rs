//! `JSON.stringify(JSON.parse(text))` as JavaScript does it: keys in their order (a repeated key keeps the first place and the last value),
//! numbers in JavaScript's shortest form. Needed where both Workers hash the same JSON (the outline hash of a map pack).
use serde::de::{Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
use std::fmt;

enum Js {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Js>),
    Obj(Vec<(String, Js)>),
}

impl<'de> Deserialize<'de> for Js {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Js, D::Error> {
        d.deserialize_any(JsVisitor)
    }
}

struct JsVisitor;

impl<'de> Visitor<'de> for JsVisitor {
    type Value = Js;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("JSON")
    }
    fn visit_unit<E>(self) -> Result<Js, E> {
        Ok(Js::Null)
    }
    fn visit_bool<E>(self, v: bool) -> Result<Js, E> {
        Ok(Js::Bool(v))
    }
    fn visit_i64<E>(self, v: i64) -> Result<Js, E> {
        Ok(Js::Num(v as f64))
    }
    fn visit_u64<E>(self, v: u64) -> Result<Js, E> {
        Ok(Js::Num(v as f64))
    }
    fn visit_f64<E>(self, v: f64) -> Result<Js, E> {
        Ok(Js::Num(v))
    }
    fn visit_str<E>(self, v: &str) -> Result<Js, E> {
        Ok(Js::Str(v.to_string()))
    }
    fn visit_string<E>(self, v: String) -> Result<Js, E> {
        Ok(Js::Str(v))
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Js, A::Error> {
        let mut items = Vec::new();
        while let Some(item) = seq.next_element()? {
            items.push(item);
        }
        Ok(Js::Arr(items))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Js, A::Error> {
        let mut entries: Vec<(String, Js)> = Vec::new();
        while let Some((key, value)) = map.next_entry::<String, Js>()? {
            match entries.iter_mut().find(|(k, _)| *k == key) {
                Some(entry) => entry.1 = value,
                None => entries.push((key, value)),
            }
        }
        Ok(Js::Obj(entries))
    }
}

/// `String(x)` for a number as `JSON.stringify` writes it (`null` for NaN and infinities).
pub fn number_text(x: f64) -> String {
    if !x.is_finite() {
        return "null".into();
    }
    if x == 0.0 {
        return "0".into();
    }
    let a = x.abs();
    if (1e-6..1e21).contains(&a) {
        return format!("{x}");
    }
    let text = format!("{x:e}");
    match text.split_once('e') {
        Some((mantissa, exp)) if !exp.starts_with('-') => format!("{mantissa}e+{exp}"),
        _ => text,
    }
}

fn write(value: &Js, out: &mut String) {
    match value {
        Js::Null => out.push_str("null"),
        Js::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Js::Num(n) => out.push_str(&number_text(*n)),
        Js::Str(s) => out.push_str(&serde_json::to_string(s).unwrap_or_default()),
        Js::Arr(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write(item, out);
            }
            out.push(']');
        }
        Js::Obj(entries) => {
            out.push('{');
            for (i, (key, item)) in entries.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(key).unwrap_or_default());
                out.push(':');
                write(item, out);
            }
            out.push('}');
        }
    }
}

/// `None` when the text is not JSON.
pub fn restringify(text: &str) -> Option<String> {
    let value: Js = serde_json::from_str(text).ok()?;
    let mut out = String::with_capacity(text.len());
    write(&value, &mut out);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::{number_text, restringify};

    #[test]
    fn numbers_like_javascript() {
        for (x, js) in [
            (13.0, "13"),
            (0.1 + 0.2, "0.30000000000000004"),
            (1e-6, "0.000001"),
            (1e-7, "1e-7"),
            (1.5e21, "1.5e+21"),
            (-0.0, "0"),
            (123e18, "123000000000000000000"),
        ] {
            assert_eq!(number_text(x), js);
        }
    }

    #[test]
    fn order_spacing_and_repeated_keys() {
        assert_eq!(
            restringify(r#"{ "type" : "Polygon", "coordinates": [[[13.0, 51.10], [1E2, -0.0]]], "type": "X" }"#).unwrap(),
            r#"{"type":"X","coordinates":[[[13,51.1],[100,0]]]}"#
        );
        assert_eq!(restringify(r#""aä\/\n""#).unwrap(), "\"aä/\\n\"");
        assert!(restringify("{").is_none());
    }
}
