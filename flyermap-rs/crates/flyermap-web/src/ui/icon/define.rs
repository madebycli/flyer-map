//! One table makes the icon names, their TypeScript names and their SVG markup, so they cannot drift apart.

macro_rules! define_icons {
    ($($variant:ident $name:literal => $markup:literal,)*) => {
        /// The icons of the app. `as_str` is the name in `src/ui/icons.tsx`.
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
        pub enum IconName {
            $($variant,)*
        }

        impl IconName {
            pub const ALL: &'static [IconName] = &[$(IconName::$variant,)*];

            pub fn as_str(self) -> &'static str {
                match self {
                    $(IconName::$variant => $name,)*
                }
            }

            /// The inner SVG markup (paths and circles) on the 24 px grid.
            pub fn markup(self) -> &'static str {
                match self {
                    $(IconName::$variant => $markup,)*
                }
            }
        }
    };
}

pub(crate) use define_icons;
