//! The own stroke icon set (port of `src/ui/icons.tsx`): no icon font, no network, themable through `currentColor`.
mod define;
pub mod table;
pub mod view;

pub use table::IconName;
pub use view::Icon;

#[cfg(test)]
mod tests {
    use super::IconName;
    use std::collections::HashSet;

    #[test]
    fn every_icon_of_the_react_app_is_there_once() {
        // the 57 of the React app and the ones this app added (speaker, vibrate, studio)
        assert_eq!(IconName::ALL.len(), 63);
        let names: HashSet<_> = IconName::ALL.iter().map(|i| i.as_str()).collect();
        assert_eq!(names.len(), 63);
        for name in ["check", "cloudOk", "cloudOff", "mapPin", "menu", "chevron", "back", "palette", "help"] {
            assert!(names.contains(name), "{name}");
        }
    }

    #[test]
    fn markup_is_svg_shapes_with_balanced_tags() {
        for icon in IconName::ALL {
            let m = icon.markup();
            assert!(m.starts_with('<') && m.ends_with("/>"), "{icon:?}");
            assert_eq!(m.matches('<').count(), m.matches("/>").count(), "{icon:?}: every shape closes itself");
            assert!(!m.contains("strokeDasharray") && !m.contains('{'), "{icon:?}: no JSX left");
        }
    }
}
