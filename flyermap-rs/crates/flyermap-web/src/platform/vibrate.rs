//! A short buzz that confirms a mark (port of `tick` in `src/pwa/device.ts`). Fails quietly where the browser has no vibration (iOS).

/// How long the buzz lasts, ms.
pub const TICK_MS: u32 = 12;

/// Buzz once, if the person wants it. Returns whether the browser accepted it.
pub fn tick(haptics_on: bool) -> bool {
    if !haptics_on {
        return false;
    }
    web_sys::window()
        .map(|w| w.navigator().vibrate_with_duration(TICK_MS))
        .unwrap_or(false)
}
