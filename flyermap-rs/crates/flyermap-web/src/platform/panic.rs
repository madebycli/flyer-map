//! A panic in the browser ends up in the console with its message (the release build aborts after that). Replaces `console_error_panic_hook`.

pub fn install() {
    std::panic::set_hook(Box::new(|info| {
        web_sys::console::error_1(&format!("flyermap-web: {info}").into());
    }));
}
