#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // This connects to the 'lib.rs' file above
    // "universal_compressor_lib" comes from [lib] name in your Cargo.toml
    universal_compressor_lib::run();
}