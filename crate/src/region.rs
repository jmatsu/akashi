//! Pixel-region processing: the effects behind the editor's redactions.
//!
//! Region edits are non-destructive: every redaction is an object, and the
//! renderer hands the pixels currently under it to [`apply_region`] on each
//! frame of a drag. That repetition is why this lives in wasm rather than JS.

use wasm_bindgen::prelude::*;

/// Average each block of pixels into a single colour. `strength` is the block
/// edge length in pixels.
pub const MODE_MOSAIC: u32 = 0;
/// Paint the region black. `strength` is the opacity of the black, 0.0..=1.0.
pub const MODE_BLACKOUT: u32 = 1;
/// Erase the region. `strength` is how much alpha to remove, 0.0..=1.0.
pub const MODE_TRANSPARENT: u32 = 2;

/// Apply a region effect in place. An unknown `mode` leaves the buffer
/// untouched, so a document from a newer aka degrades to "no effect".
#[wasm_bindgen]
pub fn apply_region(data: &mut [u8], width: u32, height: u32, mode: u32, strength: f32) {
    let w = width as usize;
    let h = height as usize;
    if w == 0 || h == 0 || data.len() < w * h * 4 {
        return;
    }
    match mode {
        MODE_MOSAIC => mosaic(data, w, h, strength.max(1.0) as usize),
        MODE_BLACKOUT => blackout(data, strength.clamp(0.0, 1.0)),
        MODE_TRANSPARENT => transparent(data, strength.clamp(0.0, 1.0)),
        _ => {}
    }
}

fn mosaic(data: &mut [u8], w: usize, h: usize, block: usize) {
    let mut by = 0;
    while by < h {
        let y_end = (by + block).min(h);
        let mut bx = 0;
        while bx < w {
            let x_end = (bx + block).min(w);

            let mut sum = [0u32; 4];
            let mut count = 0u32;
            for y in by..y_end {
                let row = y * w * 4;
                for x in bx..x_end {
                    let i = row + x * 4;
                    sum[0] += data[i] as u32;
                    sum[1] += data[i + 1] as u32;
                    sum[2] += data[i + 2] as u32;
                    sum[3] += data[i + 3] as u32;
                    count += 1;
                }
            }
            // `count` is never zero: the while-loops only run for non-empty spans.
            let avg = [
                (sum[0] / count) as u8,
                (sum[1] / count) as u8,
                (sum[2] / count) as u8,
                (sum[3] / count) as u8,
            ];
            for y in by..y_end {
                let row = y * w * 4;
                for x in bx..x_end {
                    let i = row + x * 4;
                    data[i..i + 4].copy_from_slice(&avg);
                }
            }
            bx = x_end;
        }
        by = y_end;
    }
}

fn blackout(data: &mut [u8], strength: f32) {
    let keep = 1.0 - strength;
    let floor = (255.0 * strength) as u8;
    // RGBA, so the remainder is always empty.
    for px in data.as_chunks_mut::<4>().0 {
        px[0] = (px[0] as f32 * keep) as u8;
        px[1] = (px[1] as f32 * keep) as u8;
        px[2] = (px[2] as f32 * keep) as u8;
        // An opaque bar must cover what is underneath, even where the source
        // pixels were themselves transparent.
        px[3] = px[3].max(floor);
    }
}

fn transparent(data: &mut [u8], strength: f32) {
    let keep = 1.0 - strength;
    for px in data.as_chunks_mut::<4>().0 {
        px[3] = (px[3] as f32 * keep) as u8;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn buf(pixels: &[[u8; 4]]) -> Vec<u8> {
        pixels.iter().flatten().copied().collect()
    }

    #[test]
    fn mosaic_averages_a_whole_block() {
        // 2x2 image, one 2px block: every pixel becomes the mean.
        let mut data = buf(&[[0, 0, 0, 255], [100, 100, 100, 255], [200, 200, 200, 255], [0, 0, 0, 255]]);
        apply_region(&mut data, 2, 2, MODE_MOSAIC, 2.0);
        assert_eq!(data, buf(&[[75, 75, 75, 255]; 4]));
    }

    #[test]
    fn mosaic_handles_a_partial_trailing_block() {
        // 3x1 with a 2px block: the last column averages only itself.
        let mut data = buf(&[[0, 0, 0, 255], [100, 100, 100, 255], [40, 40, 40, 255]]);
        apply_region(&mut data, 3, 1, MODE_MOSAIC, 2.0);
        assert_eq!(data, buf(&[[50, 50, 50, 255], [50, 50, 50, 255], [40, 40, 40, 255]]));
    }

    #[test]
    fn blackout_covers_transparent_source_pixels() {
        let mut data = buf(&[[9, 9, 9, 0]]);
        apply_region(&mut data, 1, 1, MODE_BLACKOUT, 1.0);
        assert_eq!(data, buf(&[[0, 0, 0, 255]]));
    }

    #[test]
    fn transparent_scales_alpha_only() {
        let mut data = buf(&[[10, 20, 30, 200]]);
        apply_region(&mut data, 1, 1, MODE_TRANSPARENT, 0.5);
        assert_eq!(data, buf(&[[10, 20, 30, 100]]));
    }

    #[test]
    fn unknown_mode_is_a_no_op() {
        let original = buf(&[[1, 2, 3, 4]]);
        let mut data = original.clone();
        apply_region(&mut data, 1, 1, 99, 1.0);
        assert_eq!(data, original);
    }

    #[test]
    fn short_buffer_is_rejected_instead_of_panicking() {
        let mut data = vec![0u8; 4];
        apply_region(&mut data, 4, 4, MODE_MOSAIC, 2.0);
        assert_eq!(data, vec![0u8; 4]);
    }
}
