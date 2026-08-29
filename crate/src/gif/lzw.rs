//! The LZW variant GIF uses: codes packed least-significant bit first, growing
//! from 9 to 12 bits as the dictionary fills, and a reset once it is full.

/// A dictionary holds 4096 codes; past that, the encoder starts over.
const MAX_CODES: u16 = 4096;
/// Widest code a decoder will read.
const MAX_WIDTH: u32 = 12;
/// No entry: a real code can be 0, so absence needs a value of its own.
const NONE: u16 = u16::MAX;

/// The dictionary, kept across frames.
///
/// It is a flat 2MB table rather than a hash, so every lookup is a single
/// index -- which is worth having only if the table is not rebuilt constantly.
/// A busy frame fills and resets it dozens of times, so the slots written
/// since the last reset are recorded and only those are cleared: a few
/// thousand entries rather than a megabyte, per reset and per frame.
pub struct Lzw {
    table: Vec<u16>,
    written: Vec<u32>,
}

impl Lzw {
    pub fn new() -> Lzw {
        Lzw { table: vec![NONE; MAX_CODES as usize * 256], written: Vec::new() }
    }

    /// Compress `data` (one palette index per byte) into a GIF code stream.
    /// The caller writes the leading minimum-code-size byte and cuts the
    /// result into sub-blocks.
    pub fn encode(&mut self, data: &[u8], min_code_size: u8) -> Vec<u8> {
        let clear = 1u16 << min_code_size;
        let end = clear + 1;
        let start_width = min_code_size as u32 + 1;

        let mut out = BitWriter::default();
        let mut width = start_width;
        out.write(clear, width);

        let Some((&first, rest)) = data.split_first() else {
            out.write(end, width);
            return out.finish();
        };

        let table = &mut self.table;
        let written = &mut self.written;
        for &slot in written.iter() {
            table[slot as usize] = NONE;
        }
        written.clear();

        let mut next = end + 1;
        let mut prefix = u16::from(first);

        for &byte in rest {
            let slot = prefix as usize * 256 + byte as usize;
            if table[slot] != NONE {
                prefix = table[slot];
                continue;
            }
            out.write(prefix, width);
            if next < MAX_CODES {
                table[slot] = next;
                written.push(slot as u32);
                next += 1;
                // A decoder learns each entry one code later than the encoder
                // writes it, so the width grows one code later than the
                // dictionary outgrows it: the code just assigned is emitted at
                // the new width at the earliest.
                if u32::from(next) == (1 << width) + 1 && width < MAX_WIDTH {
                    width += 1;
                }
            } else {
                out.write(clear, width);
                for &slot in written.iter() {
                    table[slot as usize] = NONE;
                }
                written.clear();
                next = end + 1;
                width = start_width;
            }
            prefix = u16::from(byte);
        }

        out.write(prefix, width);
        out.write(end, width);
        out.finish()
    }
}

#[derive(Default)]
struct BitWriter {
    out: Vec<u8>,
    acc: u32,
    bits: u32,
}

impl BitWriter {
    fn write(&mut self, code: u16, width: u32) {
        self.acc |= u32::from(code) << self.bits;
        self.bits += width;
        while self.bits >= 8 {
            self.out.push(self.acc as u8);
            self.acc >>= 8;
            self.bits -= 8;
        }
    }

    fn finish(mut self) -> Vec<u8> {
        if self.bits > 0 {
            self.out.push(self.acc as u8);
        }
        self.out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A decoder, so the encoder is checked against the thing that has to read
    /// it rather than against a fixture of its own output.
    fn decode(bytes: &[u8], min_code_size: u8) -> Vec<u8> {
        let clear = 1u16 << min_code_size;
        let end = clear + 1;
        let start_width = min_code_size as u32 + 1;
        let fresh = || -> Vec<Vec<u8>> {
            (0..clear).map(|i| vec![i as u8]).chain([Vec::new(), Vec::new()]).collect()
        };

        let mut reader = BitReader { data: bytes, pos: 0, acc: 0, bits: 0 };
        let mut width = start_width;
        let mut table = fresh();
        let mut previous: Option<u16> = None;
        let mut out = Vec::new();

        while let Some(code) = reader.read(width) {
            if code == clear {
                table = fresh();
                width = start_width;
                previous = None;
                continue;
            }
            if code == end {
                break;
            }
            let entry = match table.get(code as usize) {
                Some(entry) if !entry.is_empty() => entry.clone(),
                // The one forward reference LZW allows: a code defined by the
                // very sequence it stands for.
                _ => {
                    let mut entry = table[previous.expect("code before any prefix") as usize].clone();
                    entry.push(entry[0]);
                    entry
                }
            };
            out.extend_from_slice(&entry);
            if let Some(prefix) = previous
                && table.len() < MAX_CODES as usize
            {
                let mut grown = table[prefix as usize].clone();
                grown.push(entry[0]);
                table.push(grown);
                if table.len() as u32 == 1 << width && width < MAX_WIDTH {
                    width += 1;
                }
            }
            previous = Some(code);
        }
        out
    }

    struct BitReader<'a> {
        data: &'a [u8],
        pos: usize,
        acc: u32,
        bits: u32,
    }

    impl BitReader<'_> {
        fn read(&mut self, width: u32) -> Option<u16> {
            while self.bits < width {
                let byte = *self.data.get(self.pos)?;
                self.pos += 1;
                self.acc |= u32::from(byte) << self.bits;
                self.bits += 8;
            }
            let code = (self.acc & ((1 << width) - 1)) as u16;
            self.acc >>= width;
            self.bits -= width;
            Some(code)
        }
    }

    fn round_trip(data: &[u8]) {
        assert_eq!(decode(&Lzw::new().encode(data, 8), 8), data);
    }

    #[test]
    fn an_empty_frame_round_trips() {
        round_trip(&[]);
    }

    #[test]
    fn a_single_pixel_round_trips() {
        round_trip(&[42]);
    }

    #[test]
    fn a_run_of_one_colour_round_trips() {
        round_trip(&[7; 5000]);
    }

    #[test]
    fn a_repeating_pattern_round_trips() {
        let data: Vec<u8> = (0..9000).map(|i| (i % 17) as u8).collect();
        round_trip(&data);
    }

    /// Long enough to fill the dictionary several times over, which is where
    /// the code width and the reset have to stay in step with the decoder.
    #[test]
    fn data_that_outgrows_the_dictionary_round_trips() {
        let mut state = 1u32;
        let data: Vec<u8> = (0..200_000)
            .map(|_| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (state >> 24) as u8
            })
            .collect();
        round_trip(&data);
    }

    #[test]
    fn a_narrow_code_size_round_trips() {
        let data: Vec<u8> = (0..3000).map(|i| (i % 4) as u8).collect();
        assert_eq!(decode(&Lzw::new().encode(&data, 2), 2), data);
    }

    #[test]
    fn a_run_compresses() {
        assert!(Lzw::new().encode(&[3; 4096], 8).len() < 200);
    }

    /// The dictionary is reused between frames, so a stale entry would show up
    /// as a stream the decoder reads back as the wrong pixels.
    #[test]
    fn a_reused_encoder_gives_the_same_stream_as_a_fresh_one() {
        let first: Vec<u8> = (0..9000).map(|i| (i % 17) as u8).collect();
        let second: Vec<u8> = (0..9000).map(|i| (i % 5 + i % 31) as u8).collect();

        let mut reused = Lzw::new();
        reused.encode(&first, 8);
        assert_eq!(reused.encode(&second, 8), Lzw::new().encode(&second, 8));
        assert_eq!(decode(&reused.encode(&first, 8), 8), first);
    }
}
