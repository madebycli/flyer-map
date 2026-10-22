//! The local-storage keys of this device. They are the keys of the React app (`src/ui/theme.ts`, `src/ui/palette.ts`, `src/pwa/device.ts`,
//! `src/v5/app/App.tsx`), so a person who switches between both apps keeps their choices.

/// `"light"` or absent (dark).
pub const THEME: &str = "vf-v5-theme";
/// `"left"` or absent (right).
pub const HAND: &str = "vf-v5-hand";
/// `"off"` or absent (on): the street map under the houses.
pub const BASE: &str = "vf-v5-base";
/// `"off"` or absent (on): keep the screen awake.
pub const AWAKE: &str = "vf-awake";
/// `"off"` or absent (on): a short buzz when marking.
pub const HAPTICS: &str = "vf-haptics";
/// `"on"` or absent (off): a short tone when marking. New in this app (a tone in the field is a choice).
pub const SOUND: &str = "vf-sound";
/// `#rrggbb` of the seed colour, absent for the default.
pub const SEED: &str = "vf-v5-seed";
