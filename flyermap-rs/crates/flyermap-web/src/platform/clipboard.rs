//! Reading the clipboard (a pasted invitation link). The browser asks the person for permission on the first read and may refuse (or not have the call at all):
//! then there is nothing, and the screen says to type the code. The call is reached through `Reflect` because `web-sys` keeps the clipboard behind an unstable flag.
use js_sys::{Function, Promise, Reflect};
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;

/// The text on the clipboard, or `None` when it cannot be read.
pub async fn read_text() -> Option<String> {
    let navigator = web_sys::window()?.navigator();
    let clipboard = Reflect::get(&navigator, &"clipboard".into()).ok().filter(|c| !c.is_undefined() && !c.is_null())?;
    let read: Function = Reflect::get(&clipboard, &"readText".into()).ok()?.dyn_into().ok()?;
    let promise: Promise = read.call0(&clipboard).ok()?.dyn_into().ok()?;
    JsFuture::from(promise).await.ok()?.as_string()
}
