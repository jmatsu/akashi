//! Choosing one palette for a whole animation, and mapping pixels onto it.
//!
//! GIF allows 256 colours; a clip has far more. Colours are counted into a
//! coarse histogram as frames are sampled, median cut splits that into the
//! boxes worth keeping, and a lookup table over the same buckets turns the
//! per-pixel search into one index. Sampling a spread of frames rather than
//! all of them is what lets the encoder stream: the palette is settled before
//! the first frame is written, so no frame is ever held twice.

/// Bits per channel kept in the histogram: 32768 buckets, coarse enough to
/// walk exhaustively and fine enough that dithering hides the rounding.
const HIST_BITS: u32 = 5;
const HIST_SIZE: usize = 1 << (3 * HIST_BITS);

/// Colours a palette may hold. One index of the 256 is reserved for
/// "unchanged since the previous frame".
pub const MAX_COLORS: usize = 255;

#[derive(Clone, Copy, Default)]
struct Bucket {
    count: u64,
    sum: [u64; 3],
}

/// A colour worth a palette slot: the mean of everything in one bucket.
struct Entry {
    rgb: [u8; 3],
    count: u64,
}

fn bucket_of(rgb: [u8; 3]) -> usize {
    let q = |v: u8| (v >> (8 - HIST_BITS)) as usize;
    (q(rgb[0]) << (2 * HIST_BITS)) | (q(rgb[1]) << HIST_BITS) | q(rgb[2])
}

/// The colour a bucket stands for, with its low bits spread back over the full
/// range so that white stays white.
fn bucket_color(index: usize) -> [u8; 3] {
    let mask = (1 << HIST_BITS) - 1;
    let expand = |v: usize| ((v << (8 - HIST_BITS)) | (v >> (2 * HIST_BITS - 8))) as u8;
    [expand((index >> (2 * HIST_BITS)) & mask), expand((index >> HIST_BITS) & mask), expand(index & mask)]
}

/// Colour counts across the frames handed to [`Histogram::sample`].
pub struct Histogram {
    buckets: Vec<Bucket>,
}

impl Histogram {
    pub fn new() -> Histogram {
        Histogram { buckets: vec![Bucket::default(); HIST_SIZE] }
    }

    /// Count one RGBA frame. Alpha is ignored: a GIF frame is opaque.
    pub fn sample(&mut self, rgba: &[u8]) {
        for px in rgba.as_chunks::<4>().0 {
            let bucket = &mut self.buckets[bucket_of([px[0], px[1], px[2]])];
            bucket.count += 1;
            for (sum, &value) in bucket.sum.iter_mut().zip(&px[..3]) {
                *sum += value as u64;
            }
        }
    }

    /// Median cut: split the colours seen into at most `max_colors` boxes,
    /// taking the widest and busiest one each time, and keep the mean of each.
    pub fn palette(&self, max_colors: usize) -> Palette {
        let mut entries = self.entries();
        if entries.is_empty() {
            return Palette::new(vec![[0, 0, 0]]);
        }

        let mut boxes = vec![(0usize, entries.len())];
        while boxes.len() < max_colors.max(1) {
            let splittable = (0..boxes.len())
                .filter(|&i| boxes[i].1 - boxes[i].0 > 1)
                .max_by_key(|&i| priority(&entries[boxes[i].0..boxes[i].1]));
            let Some(pick) = splittable else { break };

            let (start, end) = boxes[pick];
            let span = &mut entries[start..end];
            let channel = widest_channel(span);
            span.sort_unstable_by_key(|entry| entry.rgb[channel]);

            let mid = start + split_at(span);
            boxes[pick] = (start, mid);
            boxes.push((mid, end));
        }

        Palette::new(boxes.iter().map(|&(s, e)| mean(&entries[s..e])).collect())
    }

    fn entries(&self) -> Vec<Entry> {
        self.buckets
            .iter()
            .filter(|bucket| bucket.count > 0)
            .map(|bucket| Entry {
                rgb: [
                    (bucket.sum[0] / bucket.count) as u8,
                    (bucket.sum[1] / bucket.count) as u8,
                    (bucket.sum[2] / bucket.count) as u8,
                ],
                count: bucket.count,
            })
            .collect()
    }
}

/// How much a box stands to gain from being split: its colour spread weighted
/// by how many pixels sit in it, so a wide box nobody looks at loses to a busy
/// one.
fn priority(span: &[Entry]) -> u64 {
    let count: u64 = span.iter().map(|entry| entry.count).sum();
    u64::from(channel_range(span, widest_channel(span))) * count
}

fn widest_channel(span: &[Entry]) -> usize {
    (0..3).max_by_key(|&c| channel_range(span, c)).unwrap_or(0)
}

fn channel_range(span: &[Entry], channel: usize) -> u8 {
    let mut lo = u8::MAX;
    let mut hi = 0u8;
    for entry in span {
        lo = lo.min(entry.rgb[channel]);
        hi = hi.max(entry.rgb[channel]);
    }
    hi.saturating_sub(lo)
}

/// Where to cut a sorted box: at the pixel median, so both halves carry a
/// similar share of the image. Always leaves an entry on each side.
fn split_at(span: &[Entry]) -> usize {
    let total: u64 = span.iter().map(|entry| entry.count).sum();
    let mut seen = 0;
    for (i, entry) in span.iter().enumerate().take(span.len() - 1) {
        seen += entry.count;
        if seen * 2 >= total {
            return i + 1;
        }
    }
    span.len() - 1
}

fn mean(span: &[Entry]) -> [u8; 3] {
    let mut sum = [0u64; 3];
    let mut count = 0u64;
    for entry in span {
        count += entry.count;
        for (total, &value) in sum.iter_mut().zip(&entry.rgb) {
            *total += value as u64 * entry.count;
        }
    }
    if count == 0 {
        return [0, 0, 0];
    }
    [(sum[0] / count) as u8, (sum[1] / count) as u8, (sum[2] / count) as u8]
}

/// The colours of one animation, with the bucket-to-index table that maps a
/// pixel onto them.
pub struct Palette {
    colors: Vec<[u8; 3]>,
    lut: Vec<u8>,
}

impl Palette {
    fn new(colors: Vec<[u8; 3]>) -> Palette {
        // Every bucket is resolved once here, so quantising a pixel is a
        // lookup rather than a search over the whole palette.
        let lut = (0..HIST_SIZE).map(|i| nearest(&colors, bucket_color(i))).collect();
        Palette { colors, lut }
    }

    pub fn colors(&self) -> &[[u8; 3]] {
        &self.colors
    }

    pub fn len(&self) -> usize {
        self.colors.len()
    }

    pub fn index_of(&self, rgb: [u8; 3]) -> u8 {
        self.lut[bucket_of(rgb)]
    }

    /// Map one RGBA frame onto palette indices.
    ///
    /// Dithering diffuses the error of each pixel into its neighbours
    /// (Floyd-Steinberg), which is what keeps a gradient from banding into
    /// stripes once 16M colours have become 255. The error is carried at 16x
    /// -- the sum of the weights -- so the diffusion stays in integers.
    pub fn quantize(&self, rgba: &[u8], width: usize, height: usize, dither: bool) -> Vec<u8> {
        let pixels = rgba.as_chunks::<4>().0;
        if !dither {
            return pixels
                .iter()
                .take(width * height)
                .map(|px| self.index_of([px[0], px[1], px[2]]))
                .collect();
        }

        let mut out = vec![0u8; width * height];
        // A column of padding at each end, so the diagonal terms of the first
        // and last pixel of a row need no bounds check.
        let mut row = vec![0i32; (width + 2) * 3];
        let mut below = vec![0i32; (width + 2) * 3];
        for y in 0..height {
            for x in 0..width {
                let px = pixels[y * width + x];
                let at = (x + 1) * 3;
                let want = [
                    (px[0] as i32 + row[at] / 16).clamp(0, 255),
                    (px[1] as i32 + row[at + 1] / 16).clamp(0, 255),
                    (px[2] as i32 + row[at + 2] / 16).clamp(0, 255),
                ];
                let index = self.index_of([want[0] as u8, want[1] as u8, want[2] as u8]);
                out[y * width + x] = index;

                let got = self.colors[index as usize];
                for c in 0..3 {
                    let err = want[c] - got[c] as i32;
                    row[at + 3 + c] += err * 7;
                    below[at - 3 + c] += err * 3;
                    below[at + c] += err * 5;
                    below[at + 3 + c] += err;
                }
            }
            std::mem::swap(&mut row, &mut below);
            below.fill(0);
        }
        out
    }
}

fn nearest(colors: &[[u8; 3]], rgb: [u8; 3]) -> u8 {
    let mut best = 0;
    let mut best_distance = i32::MAX;
    for (i, color) in colors.iter().enumerate() {
        let mut distance = 0;
        for c in 0..3 {
            let d = rgb[c] as i32 - color[c] as i32;
            distance += d * d;
        }
        if distance < best_distance {
            best_distance = distance;
            best = i;
        }
    }
    best as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(pixels: &[[u8; 3]]) -> Vec<u8> {
        pixels.iter().flat_map(|px| [px[0], px[1], px[2], 255]).collect()
    }

    #[test]
    fn a_bucket_stands_for_a_colour_close_to_itself() {
        for color in [[0, 0, 0], [255, 255, 255], [12, 200, 70]] {
            let back = bucket_color(bucket_of(color));
            for c in 0..3 {
                assert!(color[c].abs_diff(back[c]) <= 8, "{color:?} -> {back:?}");
            }
        }
    }

    #[test]
    fn the_palette_keeps_the_colours_that_are_there() {
        let mut hist = Histogram::new();
        hist.sample(&frame(&[[255, 0, 0], [0, 255, 0], [0, 0, 255]]));
        let palette = hist.palette(MAX_COLORS);
        assert_eq!(palette.len(), 3);
        for color in [[255, 0, 0], [0, 255, 0], [0, 0, 255]] {
            assert_eq!(palette.colors()[palette.index_of(color) as usize], color);
        }
    }

    #[test]
    fn the_palette_never_outgrows_what_it_was_asked_for() {
        let mut hist = Histogram::new();
        let ramp: Vec<[u8; 3]> = (0..=255u8).map(|v| [v, v / 2, 255 - v]).collect();
        hist.sample(&frame(&ramp));
        assert!(hist.palette(8).len() <= 8);
        assert!(hist.palette(MAX_COLORS).len() <= MAX_COLORS);
    }

    #[test]
    fn an_empty_histogram_still_yields_a_usable_palette() {
        assert_eq!(Histogram::new().palette(MAX_COLORS).len(), 1);
    }

    #[test]
    fn quantize_maps_a_flat_frame_onto_a_single_index() {
        let mut hist = Histogram::new();
        let flat = frame(&[[40, 90, 160]; 4]);
        hist.sample(&flat);
        let palette = hist.palette(MAX_COLORS);
        assert_eq!(palette.quantize(&flat, 2, 2, false), vec![0, 0, 0, 0]);
        // Dithering has no error to spread when the palette holds the colour.
        assert_eq!(palette.quantize(&flat, 2, 2, true), vec![0, 0, 0, 0]);
    }

    #[test]
    fn dithering_mixes_two_colours_to_stand_in_for_a_third() {
        // Only black and white are available, so a mid grey has to be spread.
        let mut hist = Histogram::new();
        hist.sample(&frame(&[[0, 0, 0], [255, 255, 255]]));
        let palette = hist.palette(2);
        let grey = frame(&[[128, 128, 128]; 16]);
        let dithered = palette.quantize(&grey, 4, 4, true);
        assert!(dithered.contains(&0) && dithered.contains(&1));
        // Undithered, every pixel lands on whichever single colour is nearest.
        let flat = palette.quantize(&grey, 4, 4, false);
        assert!(flat.iter().all(|&i| i == flat[0]));
    }
}
