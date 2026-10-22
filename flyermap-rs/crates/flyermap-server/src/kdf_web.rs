//! PBKDF2 by the platform's WebCrypto: native speed, outside the WebAssembly (the same function in software would take seconds).
use crate::kdf::{Derived, Kdf};
use js_sys::{Array, ArrayBuffer, Object, Reflect, Uint8Array};
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;
use web_sys::{CryptoKey, SubtleCrypto, WorkerGlobalScope};

pub struct WebKdf;

fn subtle() -> Result<SubtleCrypto, JsValue> {
    let scope: WorkerGlobalScope = js_sys::global().unchecked_into();
    Ok(scope.crypto()?.subtle())
}

async fn derive(password: &[u8], salt: &[u8], iterations: u32) -> Result<Vec<u8>, JsValue> {
    let subtle = subtle()?;
    let usages = Array::of1(&JsValue::from_str("deriveBits"));
    let key: CryptoKey = JsFuture::from(subtle.import_key_with_str("raw", &Uint8Array::from(password), "PBKDF2", false, &usages)?).await?.unchecked_into();
    let params = Object::new();
    Reflect::set(&params, &"name".into(), &"PBKDF2".into())?;
    Reflect::set(&params, &"hash".into(), &"SHA-256".into())?;
    Reflect::set(&params, &"salt".into(), &Uint8Array::from(salt).into())?;
    Reflect::set(&params, &"iterations".into(), &JsValue::from_f64(f64::from(iterations)))?;
    let bits: ArrayBuffer = JsFuture::from(subtle.derive_bits_with_object(&params, &key, 256)?).await?.unchecked_into();
    Ok(Uint8Array::new(&bits).to_vec())
}

impl Kdf for WebKdf {
    fn derive<'a>(&'a self, password: &'a [u8], salt: &'a [u8], iterations: u32) -> Derived<'a> {
        // a failing platform call yields an empty value, which never matches a stored hash
        Box::pin(async move { derive(password, salt, iterations).await.unwrap_or_default() })
    }
}
