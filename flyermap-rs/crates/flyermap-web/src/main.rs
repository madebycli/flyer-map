fn main() {
    #[cfg(target_arch = "wasm32")]
    flyermap_web::start();
}
