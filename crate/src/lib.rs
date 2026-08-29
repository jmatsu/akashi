//! The wasm core for Akashi: the pixel work that repeats too often to leave
//! in JS.
//!
//! [`region`] backs the annotation editor's redactions, which reprocess the
//! pixels under them on every frame of a drag; [`gif`] backs the video
//! converter, which quantises and LZW-encodes every frame of a clip.
//!
//! Image buffers crossing the boundary are RGBA8, row-major,
//! `width * height * 4` bytes -- the layout of a canvas `ImageData`.

// An experiment rather than part of the core, and gated so the wasm module --
// which could not open a socket in the first place -- never sees it.
#[cfg(feature = "adb")]
pub mod adb;
mod gif;
mod region;

pub use gif::GifEncoder;
pub use region::{MODE_BLACKOUT, MODE_MOSAIC, MODE_TRANSPARENT, apply_region};
