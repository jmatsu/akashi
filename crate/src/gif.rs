//! Animated GIF encoding for the video converter.
//!
//! The caller decodes the clip -- that is the browser's job, through a
//! `<video>` element -- and hands the frames over as RGBA. Here they become a
//! GIF: one palette for the whole animation, each frame quantised onto it,
//! diffed against the frame before so that only what moved is stored, and
//! LZW-compressed.
//!
//! Frames stream through. A spread of them is sampled first to settle the
//! palette ([`GifEncoder::sample`]), then each frame is encoded and dropped
//! ([`GifEncoder::add_frame`]), so memory is one frame rather than the clip.

mod lzw;
mod palette;

use lzw::Lzw;
use palette::{Histogram, MAX_COLORS, Palette};
use wasm_bindgen::prelude::*;

/// Palette indices are bytes, so codes start at 8 bits wide.
const MIN_CODE_SIZE: u8 = 8;
/// Browsers treat a delay under 2 centiseconds as 10, which would run a fast
/// GIF five times slower than asked; 2 is the fastest that is honoured.
const MIN_DELAY_CS: u16 = 2;
/// The largest sub-block a GIF data stream can carry.
const BLOCK_MAX: usize = 255;

/// Builds an animated GIF one frame at a time.
///
/// The sequence is: `sample` the frames the palette should be chosen from,
/// `add_frame` each frame of the animation in order, then `finish`. The first
/// `add_frame` settles the palette, and any `sample` after that is ignored.
#[wasm_bindgen]
pub struct GifEncoder {
    width: u16,
    height: u16,
    delay_cs: u16,
    loop_forever: bool,
    dither: bool,
    histogram: Histogram,
    palette: Option<Palette>,
    /// The index meaning "leave what is underneath", one past the palette.
    transparent: u8,
    /// The previous frame's indices, which the next frame is diffed against.
    previous: Vec<u8>,
    /// The compressor, kept so its dictionary is not rebuilt for every frame.
    lzw: Lzw,
    frames: u32,
    out: Vec<u8>,
}

#[wasm_bindgen]
impl GifEncoder {
    /// `delay_cs` is how long each frame is shown, in centiseconds.
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32, delay_cs: u16, loop_forever: bool, dither: bool) -> GifEncoder {
        GifEncoder {
            width: width.min(u16::MAX as u32) as u16,
            height: height.min(u16::MAX as u32) as u16,
            delay_cs: delay_cs.max(MIN_DELAY_CS),
            loop_forever,
            dither,
            histogram: Histogram::new(),
            palette: None,
            transparent: 0,
            previous: Vec::new(),
            lzw: Lzw::new(),
            frames: 0,
            out: Vec::new(),
        }
    }

    /// Count a frame's colours towards the palette. Sampling a spread of the
    /// clip rather than every frame keeps a colour that only appears late from
    /// being missed. Returns false if the frame is not the size declared.
    pub fn sample(&mut self, rgba: &[u8]) -> bool {
        if !self.fits(rgba) || self.palette.is_some() {
            return false;
        }
        self.histogram.sample(rgba);
        true
    }

    /// Encode one frame. Returns false if the frame is not the size declared.
    pub fn add_frame(&mut self, rgba: &[u8]) -> bool {
        if !self.fits(rgba) {
            return false;
        }
        if self.palette.is_none() {
            let palette = self.histogram.palette(MAX_COLORS);
            // One past the colours, which is why a palette stops at 255.
            self.transparent = palette.len() as u8;
            self.palette = Some(palette);
            self.write_header();
        }
        let palette = self.palette.as_ref().expect("palette settled above");
        let indices = palette.quantize(rgba, self.width as usize, self.height as usize, self.dither);

        let (rect, pixels) = if self.frames == 0 {
            ((0, 0, self.width, self.height), indices.clone())
        } else {
            self.patch(&indices)
        };
        self.write_frame(rect, &pixels);

        self.previous = indices;
        self.frames += 1;
        true
    }

    /// Close the file and take the bytes. The encoder is left empty.
    pub fn finish(&mut self) -> Vec<u8> {
        if self.frames == 0 {
            // Nothing was added: still hand back a file rather than a
            // fragment, so a caller that gave up has nothing half-written.
            self.palette = Some(self.histogram.palette(MAX_COLORS));
            self.write_header();
        }
        self.out.push(0x3B);
        self.previous = Vec::new();
        std::mem::take(&mut self.out)
    }

    pub fn frames(&self) -> u32 {
        self.frames
    }

    fn fits(&self, rgba: &[u8]) -> bool {
        let pixels = self.width as usize * self.height as usize;
        pixels > 0 && rgba.len() >= pixels * 4
    }

    /// What changed since the previous frame: the smallest rectangle covering
    /// it, with the pixels inside that did not change left transparent. A
    /// still frame becomes a single transparent pixel, which is enough to
    /// carry its share of the running time.
    fn patch(&self, indices: &[u8]) -> ((u16, u16, u16, u16), Vec<u8>) {
        let width = self.width as usize;
        let height = self.height as usize;
        let (mut x0, mut y0, mut x1, mut y1) = (width, height, 0usize, 0usize);
        for y in 0..height {
            for x in 0..width {
                if indices[y * width + x] != self.previous[y * width + x] {
                    x0 = x0.min(x);
                    y0 = y0.min(y);
                    x1 = x1.max(x);
                    y1 = y1.max(y);
                }
            }
        }
        if x0 > x1 {
            return ((0, 0, 1, 1), vec![self.transparent]);
        }

        let mut pixels = Vec::with_capacity((x1 - x0 + 1) * (y1 - y0 + 1));
        for y in y0..=y1 {
            for x in x0..=x1 {
                let at = y * width + x;
                pixels.push(if indices[at] == self.previous[at] { self.transparent } else { indices[at] });
            }
        }
        ((x0 as u16, y0 as u16, (x1 - x0 + 1) as u16, (y1 - y0 + 1) as u16), pixels)
    }

    fn write_header(&mut self) {
        let colors = self.palette.as_ref().expect("palette settled before the header").colors().to_vec();
        // A colour table is a power of two long, and has to have room for the
        // transparent index as well as the colours.
        let table = (colors.len() + 1).next_power_of_two().max(2);
        let exponent = table.trailing_zeros() as u8;

        self.out.extend_from_slice(b"GIF89a");
        self.push_u16(self.width);
        self.push_u16(self.height);
        // Global colour table, 8-bit source colour, unsorted, `table` long.
        self.out.push(0xF0 | (exponent - 1));
        // Background colour index, then a pixel aspect ratio of "square".
        self.out.extend_from_slice(&[0x00, 0x00]);
        for color in &colors {
            self.out.extend_from_slice(color);
        }
        for _ in colors.len()..table {
            self.out.extend_from_slice(&[0, 0, 0]);
        }

        if self.loop_forever {
            // The Netscape application extension, which is how a GIF says it
            // repeats. A count of zero means forever.
            self.out.extend_from_slice(&[0x21, 0xFF, 0x0B]);
            self.out.extend_from_slice(b"NETSCAPE2.0");
            self.out.extend_from_slice(&[0x03, 0x01, 0x00, 0x00, 0x00]);
        }
    }

    fn write_frame(&mut self, (left, top, width, height): (u16, u16, u16, u16), pixels: &[u8]) {
        // Graphic control extension: how long the frame is shown, and whether
        // the transparent index shows what is underneath. Disposal 1 leaves
        // the frame in place, which is what makes the next one a patch.
        self.out.extend_from_slice(&[0x21, 0xF9, 0x04]);
        self.out.push(0x04 | u8::from(self.frames > 0));
        self.push_u16(self.delay_cs);
        self.out.push(self.transparent);
        self.out.push(0x00);

        self.out.push(0x2C);
        self.push_u16(left);
        self.push_u16(top);
        self.push_u16(width);
        self.push_u16(height);
        // No local colour table, not interlaced.
        self.out.push(0x00);

        self.out.push(MIN_CODE_SIZE);
        for block in self.lzw.encode(pixels, MIN_CODE_SIZE).chunks(BLOCK_MAX) {
            self.out.push(block.len() as u8);
            self.out.extend_from_slice(block);
        }
        self.out.push(0x00);
    }

    fn push_u16(&mut self, value: u16) {
        self.out.extend_from_slice(&value.to_le_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(pixels: &[[u8; 3]]) -> Vec<u8> {
        pixels.iter().flat_map(|px| [px[0], px[1], px[2], 255]).collect()
    }

    fn solid(color: [u8; 3], count: usize) -> Vec<u8> {
        frame(&vec![color; count])
    }

    /// The offsets of every image descriptor in a file, which is where the
    /// frames -- and the rectangles they cover -- can be read back.
    fn image_descriptors(gif: &[u8]) -> Vec<usize> {
        let mut at = Vec::new();
        let mut i = 0;
        while i < gif.len() {
            // Frames are only ever written after a graphic control extension,
            // so 0x2C is unambiguous eleven bytes past one.
            if gif[i..].starts_with(&[0x21, 0xF9, 0x04]) && gif.get(i + 8) == Some(&0x2C) {
                at.push(i + 8);
                i += 8;
            }
            i += 1;
        }
        at
    }

    fn rect(gif: &[u8], descriptor: usize) -> (u16, u16, u16, u16) {
        let read = |at: usize| u16::from_le_bytes([gif[at], gif[at + 1]]);
        (read(descriptor + 1), read(descriptor + 3), read(descriptor + 5), read(descriptor + 7))
    }

    #[test]
    fn a_single_frame_is_a_complete_file() {
        let mut encoder = GifEncoder::new(2, 2, 10, true, false);
        let red = solid([255, 0, 0], 4);
        assert!(encoder.sample(&red));
        assert!(encoder.add_frame(&red));
        let gif = encoder.finish();

        assert!(gif.starts_with(b"GIF89a"));
        assert_eq!(gif.last(), Some(&0x3B));
        assert_eq!(u16::from_le_bytes([gif[6], gif[7]]), 2, "width");
        assert_eq!(u16::from_le_bytes([gif[8], gif[9]]), 2, "height");
        assert_eq!(image_descriptors(&gif).len(), 1);
    }

    #[test]
    fn looping_is_what_writes_the_netscape_extension() {
        let pixels = solid([1, 2, 3], 1);
        let mut looping = GifEncoder::new(1, 1, 10, true, false);
        looping.add_frame(&pixels);
        assert!(looping.finish().windows(11).any(|w| w == b"NETSCAPE2.0"));

        let mut once = GifEncoder::new(1, 1, 10, false, false);
        once.add_frame(&pixels);
        assert!(!once.finish().windows(11).any(|w| w == b"NETSCAPE2.0"));
    }

    #[test]
    fn the_delay_is_written_and_never_below_what_a_browser_honours() {
        let mut encoder = GifEncoder::new(1, 1, 0, true, false);
        encoder.add_frame(&solid([9, 9, 9], 1));
        let gif = encoder.finish();
        let at = image_descriptors(&gif)[0];
        // The delay sits inside the graphic control extension, four bytes in.
        assert_eq!(u16::from_le_bytes([gif[at - 4], gif[at - 3]]), MIN_DELAY_CS);
    }

    #[test]
    fn an_unchanged_frame_costs_a_single_pixel() {
        let pixels = solid([30, 60, 90], 64);
        let mut encoder = GifEncoder::new(8, 8, 10, true, false);
        encoder.sample(&pixels);
        encoder.add_frame(&pixels);
        encoder.add_frame(&pixels);
        let gif = encoder.finish();

        let frames = image_descriptors(&gif);
        assert_eq!(frames.len(), 2);
        assert_eq!(rect(&gif, frames[0]), (0, 0, 8, 8));
        assert_eq!(rect(&gif, frames[1]), (0, 0, 1, 1));
    }

    #[test]
    fn a_frame_covers_only_what_changed() {
        let mut first = vec![[0u8, 0, 0]; 16];
        let mut second = first.clone();
        // One pixel each, at (0, 0) of the first frame and (2, 1) of the second.
        first[0] = [255, 255, 255];
        second[6] = [255, 255, 255];

        let mut encoder = GifEncoder::new(4, 4, 10, true, false);
        encoder.sample(&frame(&first));
        encoder.sample(&frame(&second));
        encoder.add_frame(&frame(&first));
        encoder.add_frame(&frame(&second));
        let gif = encoder.finish();

        let frames = image_descriptors(&gif);
        // (0, 0) changed back to black and (2, 1) to white, so the patch spans
        // both.
        assert_eq!(rect(&gif, frames[1]), (0, 0, 3, 2));
    }

    #[test]
    fn a_frame_of_the_wrong_size_is_refused() {
        let mut encoder = GifEncoder::new(4, 4, 10, true, false);
        assert!(!encoder.sample(&solid([0, 0, 0], 4)));
        assert!(!encoder.add_frame(&solid([0, 0, 0], 4)));
        assert_eq!(encoder.frames(), 0);
    }

    #[test]
    fn sampling_after_the_first_frame_is_refused() {
        let mut encoder = GifEncoder::new(1, 1, 10, true, false);
        assert!(encoder.add_frame(&solid([0, 0, 0], 1)));
        assert!(!encoder.sample(&solid([255, 255, 255], 1)));
    }

    #[test]
    fn finishing_with_no_frames_still_gives_a_readable_file() {
        let gif = GifEncoder::new(4, 4, 10, true, false).finish();
        assert!(gif.starts_with(b"GIF89a"));
        assert_eq!(gif.last(), Some(&0x3B));
        assert!(image_descriptors(&gif).is_empty());
    }

    #[test]
    fn the_colour_table_is_long_enough_for_the_transparent_index() {
        // Two colours plus transparency needs a table of four.
        let mut encoder = GifEncoder::new(2, 1, 10, true, false);
        encoder.sample(&frame(&[[0, 0, 0], [255, 255, 255]]));
        encoder.add_frame(&frame(&[[0, 0, 0], [255, 255, 255]]));
        let gif = encoder.finish();
        let exponent = (gif[10] & 0b111) + 1;
        assert_eq!(1usize << exponent, 4);
    }
}
