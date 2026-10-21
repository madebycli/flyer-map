//! Deployment settings from the environment. Everything third-party (the basemap style) is configured here, never in the client.
use flyermap_wire::meta::Basemap;

const DEFAULT_DARK: &str = "https://tiles.openfreemap.org/styles/dark";
const DEFAULT_LIGHT: &str = "https://tiles.openfreemap.org/styles/bright";

/// A style URL must be https (or a same-origin path); anything else is ignored rather than handed to every client.
pub fn safe_style_url(value: Option<&str>) -> Option<String> {
    let v = value?.trim();
    if v.is_empty() {
        return None;
    }
    if v.starts_with('/') && !v.starts_with("//") {
        return Some(v.to_string());
    }
    let rest = v.strip_prefix("https://")?;
    (!rest.is_empty() && !rest.starts_with('/')).then(|| v.to_string())
}

/// `V5_BASEMAP_DARK` / `V5_BASEMAP_LIGHT` set a style; the literal value `off` serves no basemap at all (plain background).
pub fn basemap_from_env(get: impl Fn(&str) -> Option<String>) -> Basemap {
    let pick = |name: &str, fallback: &str| {
        let value = get(name);
        if value.as_deref().map(|v| v.trim().eq_ignore_ascii_case("off")) == Some(true) {
            None
        } else {
            Some(safe_style_url(value.as_deref()).unwrap_or_else(|| fallback.to_string()))
        }
    };
    Basemap { dark: pick("V5_BASEMAP_DARK", DEFAULT_DARK), light: pick("V5_BASEMAP_LIGHT", DEFAULT_LIGHT) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn styles_from_the_environment() {
        let env = |pairs: &'static [(&'static str, &'static str)]| move |k: &str| pairs.iter().find(|(n, _)| *n == k).map(|(_, v)| v.to_string());
        assert_eq!(basemap_from_env(env(&[])), Basemap { dark: Some(DEFAULT_DARK.into()), light: Some(DEFAULT_LIGHT.into()) });
        assert_eq!(
            basemap_from_env(env(&[("V5_BASEMAP_DARK", "off"), ("V5_BASEMAP_LIGHT", "http://insecure/x")])),
            Basemap { dark: None, light: Some(DEFAULT_LIGHT.into()) }
        );
        assert_eq!(safe_style_url(Some("/styles/own.json")).as_deref(), Some("/styles/own.json"));
        assert_eq!(safe_style_url(Some("//evil/x")), None);
    }
}
