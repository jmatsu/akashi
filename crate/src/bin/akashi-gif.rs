//! A native front end for the GIF encoder in `crate/src/gif.rs`, the one the
//! browser reaches through wasm.
//!
//! The encoder takes RGBA frames and nothing else -- decoding a clip is the
//! caller's job, which in the browser is a `<video>` element. There is no
//! `<video>` here, so the frames arrive already decoded, as raw RGBA on stdin:
//!
//! ```sh
//! ffmpeg -i clip.mp4 -vf scale=640:-1 -f rawvideo -pix_fmt rgba - \
//!   | akashi-gif --width 640 --height 360 --fps 10 -o out.gif
//! ```
//!
//! That keeps the decoder somebody else's problem, exactly as the web app
//! does, and leaves this binary as the encoder and nothing more.

use std::fs::File;
use std::io::{self, IsTerminal, Read, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use akashi_core::GifEncoder;
use clap::Parser;

/// The shortest delay a browser honours, in centiseconds; see `gif.rs`.
const MIN_DELAY_CS: u16 = 2;

/// A ceiling on frames, matching `MAX_FRAMES` in `src/apps/gif/plan.ts`. It is
/// also what bounds memory here: the frames are held until the palette has
/// been settled, which a pipe cannot be rewound to do.
const MAX_FRAMES: usize = 300;

/// Frames the palette is chosen from, matching `PALETTE_SAMPLES` in
/// `src/apps/gif/plan.ts`.
const PALETTE_FRAMES: usize = 12;

/// What `--version` reports. The release workflow bakes in the tag and the
/// commit it was cut from; anything built from a checkout falls back to the
/// crate's own version, which is the only one it can honestly claim.
const VERSION: &str = match option_env!("AKASHI_GIF_VERSION") {
    Some(version) => version,
    None => env!("CARGO_PKG_VERSION"),
};

#[derive(Parser)]
#[command(
    name = "akashi-gif",
    version = VERSION,
    about = "Encode raw RGBA frames into an animated GIF",
    long_about = "Encode raw RGBA frames into an animated GIF.\n\n\
                  Frames are read from stdin (or --input) as tightly packed \
                  width*height*4 byte images, the layout ffmpeg writes for \
                  `-f rawvideo -pix_fmt rgba`. Nothing here decodes video:\n\n  \
                  ffmpeg -i clip.mp4 -vf scale=640:-1 -f rawvideo -pix_fmt rgba - \\\n    \
                  | akashi-gif --width 640 --height 360 --fps 10 -o out.gif"
)]
struct Args {
    /// Width of each incoming frame, in pixels.
    #[arg(long, value_parser = clap::value_parser!(u32).range(1..=u16::MAX as i64))]
    width: u32,

    /// Height of each incoming frame, in pixels.
    #[arg(long, value_parser = clap::value_parser!(u32).range(1..=u16::MAX as i64))]
    height: u32,

    /// Frames per second the GIF plays at. Rounded to the centisecond a GIF
    /// can actually store, and never faster than a browser honours.
    #[arg(long, default_value_t = 10.0)]
    fps: f64,

    /// Read frames from a file instead of stdin.
    #[arg(short, long, value_name = "FILE")]
    input: Option<PathBuf>,

    /// Write the GIF to a file instead of stdout.
    #[arg(short, long, value_name = "FILE")]
    output: Option<PathBuf>,

    /// Play the animation once instead of forever.
    #[arg(long)]
    no_loop: bool,

    /// Dither, trading speed and file size for smoother gradients.
    #[arg(long)]
    dither: bool,

    /// Stop reading after this many frames.
    #[arg(long, value_name = "N", default_value_t = MAX_FRAMES)]
    max_frames: usize,

    /// How many of the frames the palette is chosen from, spread evenly.
    #[arg(long, value_name = "N", default_value_t = PALETTE_FRAMES)]
    palette_frames: usize,

    /// Say nothing on stderr.
    #[arg(short, long)]
    quiet: bool,
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        // `Display`, not the `Debug` that returning a `Result` from `main`
        // would print: an io::Error reads as its message, not its struct.
        Err(error) => {
            eprintln!("akashi-gif: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();
    if args.max_frames == 0 {
        return Err("--max-frames must be at least 1".into());
    }
    if args.palette_frames == 0 {
        return Err("--palette-frames must be at least 1".into());
    }
    if args.output.is_none() && io::stdout().is_terminal() {
        return Err("refusing to write a GIF to the terminal: pass --output, or redirect stdout".into());
    }

    // Everything the arguments alone can settle is settled before a clip is
    // read, so a typo costs nothing but the typo.
    let delay_cs = delay_cs(args.fps)?;

    let frame_bytes = args.width as usize * args.height as usize * 4;
    let frames = match &args.input {
        Some(path) => read_frames(named(File::open(path), path)?, frame_bytes, args.max_frames)?,
        None => read_frames(io::stdin().lock(), frame_bytes, args.max_frames)?,
    };
    if frames.is_empty() {
        return Err(format!("no frames on the input: expected multiples of {frame_bytes} bytes").into());
    }

    let mut encoder = GifEncoder::new(args.width, args.height, delay_cs, !args.no_loop, args.dither);
    for at in spread(frames.len(), args.palette_frames) {
        encoder.sample(&frames[at]);
    }
    for frame in &frames {
        // The frames were read at exactly the declared size, so the encoder
        // has nothing left to refuse.
        encoder.add_frame(frame);
    }
    let gif = encoder.finish();

    // The whole file in one write: it is already in memory, and a BufWriter
    // would only add a flush whose failure goes unnoticed on drop.
    match &args.output {
        Some(path) => named(File::create(path).and_then(|mut file| file.write_all(&gif)), path)?,
        None => io::stdout().lock().write_all(&gif)?,
    }

    if !args.quiet {
        let where_to = args.output.as_deref().map_or("stdout".into(), |p| p.display().to_string());
        eprintln!(
            "{} frames, {}x{}, {} cs/frame -> {} bytes to {where_to}",
            frames.len(),
            args.width,
            args.height,
            delay_cs,
            gif.len(),
        );
    }
    Ok(())
}

/// Put the path back into a file error, which otherwise says what went wrong
/// without saying what it happened to.
fn named<T>(result: io::Result<T>, path: &Path) -> Result<T, String> {
    result.map_err(|error| format!("{}: {error}", path.display()))
}

/// The delay one frame is shown for, in centiseconds. A GIF stores hundredths
/// of a second and nothing finer, so the rate asked for is only ever
/// approximated -- and never beyond what a browser will honour.
fn delay_cs(fps: f64) -> Result<u16, String> {
    if !fps.is_finite() || fps <= 0.0 {
        return Err(format!("--fps must be a positive number, not {fps}"));
    }
    Ok(((100.0 / fps).round() as u64).clamp(MIN_DELAY_CS as u64, u16::MAX as u64) as u16)
}

/// `count` indices spread evenly over `len` frames -- which frames the palette
/// is chosen from. A spread rather than a prefix, so a colour that only
/// appears at the end of the clip is still represented.
fn spread(len: usize, count: usize) -> Vec<usize> {
    if len <= count {
        return (0..len).collect();
    }
    if count == 1 {
        return vec![0];
    }
    let step = (len - 1) as f64 / (count - 1) as f64;
    (0..count).map(|i| (i as f64 * step).round() as usize).collect()
}

/// Whole frames off the input, up to `max`. Anything left over is a truncated
/// frame, which means the size the caller declared is not the size the frames
/// are -- worth an error rather than a GIF full of skew.
fn read_frames(mut input: impl Read, frame_bytes: usize, max: usize) -> io::Result<Vec<Vec<u8>>> {
    let mut frames = Vec::new();
    while frames.len() < max {
        let mut frame = vec![0u8; frame_bytes];
        match fill(&mut input, &mut frame)? {
            0 => break,
            read if read == frame_bytes => frames.push(frame),
            read => {
                let message =
                    format!("input ends mid-frame: {read} bytes left over, a frame is {frame_bytes}");
                return Err(io::Error::new(io::ErrorKind::InvalidData, message));
            }
        }
    }
    Ok(frames)
}

/// Read until `buf` is full or the input ends, and say how much was read. A
/// pipe hands over whatever has arrived, which is rarely a whole frame.
fn fill(input: &mut impl Read, buf: &mut [u8]) -> io::Result<usize> {
    let mut read = 0;
    while read < buf.len() {
        match input.read(&mut buf[read..])? {
            0 => break,
            n => read += n,
        }
    }
    Ok(read)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_delay_follows_the_frame_rate_a_gif_can_store() {
        assert_eq!(delay_cs(10.0).unwrap(), 10);
        assert_eq!(delay_cs(12.5).unwrap(), 8);
        // 30fps is 3.33cs, and a GIF stores whole centiseconds.
        assert_eq!(delay_cs(30.0).unwrap(), 3);
        assert!(delay_cs(0.0).is_err());
        assert!(delay_cs(f64::NAN).is_err());
    }

    #[test]
    fn a_rate_faster_than_a_browser_honours_is_clamped() {
        assert_eq!(delay_cs(1000.0).unwrap(), MIN_DELAY_CS);
    }

    #[test]
    fn the_palette_is_sampled_across_the_whole_clip() {
        assert_eq!(spread(3, 12), vec![0, 1, 2]);
        assert_eq!(spread(12, 12), (0..12).collect::<Vec<_>>());
        assert_eq!(spread(100, 5), vec![0, 25, 50, 74, 99]);
        // Whatever the count, the first and last frame are always in it.
        let at = spread(300, 12);
        assert_eq!(at.first(), Some(&0));
        assert_eq!(at.last(), Some(&299));
        assert_eq!(spread(300, 1), vec![0]);
    }

    #[test]
    fn frames_are_read_whole() {
        let input = [7u8; 16 * 3];
        let frames = read_frames(&input[..], 16, 10).unwrap();
        assert_eq!(frames.len(), 3);
        assert!(frames.iter().all(|f| f.len() == 16));
    }

    #[test]
    fn reading_stops_at_the_ceiling() {
        let input = [0u8; 16 * 10];
        assert_eq!(read_frames(&input[..], 16, 4).unwrap().len(), 4);
    }

    #[test]
    fn an_input_that_ends_mid_frame_is_refused() {
        let input = [0u8; 16 * 2 + 5];
        let error = read_frames(&input[..], 16, 10).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn an_empty_input_is_no_frames_rather_than_an_error() {
        assert!(read_frames(&[][..], 16, 10).unwrap().is_empty());
    }

    /// A pipe delivers what has arrived, not what was asked for.
    #[test]
    fn a_frame_split_across_reads_is_still_one_frame() {
        struct Dribble(Vec<u8>);
        impl Read for Dribble {
            fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
                if self.0.is_empty() {
                    return Ok(0);
                }
                buf[0] = self.0.remove(0);
                Ok(1)
            }
        }
        let frames = read_frames(Dribble(vec![1u8; 8]), 4, 10).unwrap();
        assert_eq!(frames.len(), 2);
    }
}
