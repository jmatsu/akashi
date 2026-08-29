//! A native front end for the ADB client in `crate/src/adb.rs`: a screenshot
//! or a screen recording taken off an Android device over Wi-Fi, without the
//! `adb` server, a cable, or anything the bytes could be uploaded to.
//!
//! The device has to be listening first, which is `adb tcpip 5555` over a
//! cable once, or Wireless debugging in the developer settings:
//!
//! ```sh
//! akashi-adb --device 192.168.1.24 screenshot -o shot.png
//! akashi-adb --device 192.168.1.24 record --seconds 8 -o clip.mp4
//! ```
//!
//! The result is a file for the browser app to open, which is where this
//! stops: the app itself can never do any of this -- a page has no TCP.

use std::fs::File;
use std::io::{self, Read};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use akashi_core::adb::{Device, Key, pull};
use clap::{Parser, Subcommand};

/// The port `adb tcpip` puts a daemon on.
const DEFAULT_PORT: u16 = 5555;

/// Long enough to cover a person picking the phone up and tapping *Allow*,
/// which is what the first connection with a new key waits for.
const DEFAULT_TIMEOUT: u64 = 120;

/// Where a recording is staged on the device. `screenrecord` writes a file and
/// has no mode that streams an MP4, so the file is pulled and then removed.
const REMOTE_RECORDING: &str = "/sdcard/akashi-adb";

#[derive(Parser)]
#[command(
    name = "akashi-adb",
    version,
    about = "Take a screenshot or a screen recording off an Android device over TCP/IP",
    long_about = "Take a screenshot or a screen recording off an Android device over TCP/IP.\n\n\
                  Speaks the ADB protocol directly to the device: no `adb` server, no cable, \
                  and nothing between the phone and the file. The device has to be listening \
                  first -- `adb tcpip 5555` once over a cable, or Wireless debugging in the \
                  developer settings -- and to have authorised this workstation's key, which \
                  is the same ~/.android/adbkey `adb` itself uses."
)]
struct Args {
    /// The device, as `host` or `host:port`. Port 5555 unless one is given.
    #[arg(short, long, value_name = "HOST[:PORT]")]
    device: String,

    /// The RSA key to authenticate with. Defaults to `~/.android/adbkey`.
    #[arg(long, value_name = "FILE")]
    key: Option<PathBuf>,

    /// Seconds to wait on the device before giving up.
    #[arg(long, value_name = "SECONDS", default_value_t = DEFAULT_TIMEOUT)]
    timeout: u64,

    /// Say nothing on stderr.
    #[arg(short, long)]
    quiet: bool,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Print what the device says it is, and stop.
    Info,

    /// Capture the screen as a PNG.
    Screenshot {
        /// Write the PNG here.
        #[arg(short, long, value_name = "FILE")]
        output: PathBuf,
    },

    /// Record the screen, then pull the MP4 off the device.
    Record {
        /// How long to record for. `screenrecord` caps this at 180.
        #[arg(long, value_name = "SECONDS", default_value_t = 10)]
        seconds: u32,

        /// Resolution to record at, as `WIDTHxHEIGHT`. The display's own by
        /// default.
        #[arg(long, value_name = "WxH")]
        size: Option<String>,

        /// Bits per second. `screenrecord` defaults to 20 Mbps.
        #[arg(long, value_name = "BPS")]
        bit_rate: Option<u32>,

        /// Write the MP4 here.
        #[arg(short, long, value_name = "FILE")]
        output: PathBuf,
    },

    /// Copy any file the shell user can read off the device.
    Pull {
        /// The path on the device.
        #[arg(value_name = "REMOTE")]
        remote: String,

        /// Write it here.
        #[arg(short, long, value_name = "FILE")]
        output: PathBuf,
    },
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        // `Display`, not the `Debug` that returning a `Result` from `main`
        // would print: an io::Error reads as its message, not its struct.
        Err(error) => {
            eprintln!("akashi-adb: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();
    let key = load_key(args.key.as_deref())?;
    let report = Report { quiet: args.quiet };

    let socket = dial(&args.device, Duration::from_secs(args.timeout))?;
    let started = Instant::now();
    let mut device = Device::connect(socket, &key).inspect_err(|error| {
        if error.kind() == io::ErrorKind::PermissionDenied {
            report.say("the device is showing the key's fingerprint -- accept it and run again");
        }
    })?;
    report.say(&format!("connected in {:?}, {} byte packets", started.elapsed(), device.max_payload()));

    match &args.command {
        Command::Info => {
            println!("{}", device.banner());
            Ok(())
        }
        Command::Screenshot { output } => {
            let written = drain(&mut device, "exec:screencap -p", output, &report)?;
            expect_png(output, written)?;
            Ok(())
        }
        Command::Pull { remote, output } => {
            let mut stream = device.open("sync:")?;
            let mut file = create(output)?;
            let started = Instant::now();
            let written = pull(&mut stream, remote, &mut file)?;
            report.transfer(written, started, output);
            Ok(())
        }
        Command::Record { seconds, size, bit_rate, output } => {
            let remote = format!("{REMOTE_RECORDING}-{}.mp4", epoch_seconds());
            let command = screenrecord(&remote, *seconds, size.as_deref(), *bit_rate)?;

            report.say(&format!("recording for {seconds}s"));
            // `screenrecord` says nothing until it is done; the stream closing
            // is the recording having been written.
            let noise = drain_to_vec(&mut device, &format!("exec:{command}"))?;
            if !noise.is_empty() {
                report.say(String::from_utf8_lossy(&noise).trim());
            }

            let mut stream = device.open("sync:")?;
            let mut file = create(output)?;
            let started = Instant::now();
            let written = pull(&mut stream, &remote, &mut file);
            drop(stream);

            // The staged file is removed whether or not the pull worked, so a
            // failed run does not leave the recording on the device.
            let removed = drain_to_vec(&mut device, &format!("exec:rm -f {remote}"));
            let written = written?;
            if let Err(error) = removed {
                report.say(&format!("could not remove {remote}: {error}"));
            }
            if written == 0 {
                return Err(format!("{remote} came back empty -- the recording did not start").into());
            }
            report.transfer(written, started, output);
            Ok(())
        }
    }
}

/// Reads a service to a file, which is every capture this does: the device
/// closing the stream is the command having finished.
fn drain(
    device: &mut Device<TcpStream>,
    service: &str,
    output: &Path,
    report: &Report,
) -> Result<u64, Box<dyn std::error::Error>> {
    let mut stream = device.open(service)?;
    let mut file = create(output)?;
    let started = Instant::now();
    let written = io::copy(&mut stream, &mut file)?;
    report.transfer(written, started, output);
    Ok(written)
}

fn drain_to_vec(device: &mut Device<TcpStream>, service: &str) -> io::Result<Vec<u8>> {
    let mut stream = device.open(service)?;
    let mut output = Vec::new();
    stream.read_to_end(&mut output)?;
    Ok(output)
}

/// `screencap` writes its complaints to the same stream as the image, so an
/// unreadable screen arrives as a file that is not a PNG rather than an error.
fn expect_png(output: &Path, written: u64) -> Result<(), String> {
    let head = File::open(output)
        .and_then(|mut file| {
            let mut magic = [0u8; 8];
            file.read_exact(&mut magic).map(|()| magic)
        })
        .unwrap_or_default();
    if written == 0 || head != *b"\x89PNG\r\n\x1a\n" {
        return Err(format!(
            "{} is not a PNG -- the device wrote {written} bytes of something else",
            output.display()
        ));
    }
    Ok(())
}

/// The `screenrecord` command line, with every value the caller supplied
/// parsed rather than pasted -- it is going into a shell on the device.
fn screenrecord(
    remote: &str,
    seconds: u32,
    size: Option<&str>,
    bit_rate: Option<u32>,
) -> Result<String, String> {
    let mut command = format!("screenrecord --time-limit {seconds}");
    if let Some(size) = size {
        let (width, height) = size
            .split_once(['x', 'X'])
            .and_then(|(w, h)| Some((w.trim().parse::<u32>().ok()?, h.trim().parse::<u32>().ok()?)))
            .ok_or_else(|| format!("--size wants WIDTHxHEIGHT, not `{size}`"))?;
        command.push_str(&format!(" --size {width}x{height}"));
    }
    if let Some(bit_rate) = bit_rate {
        command.push_str(&format!(" --bit-rate {bit_rate}"));
    }
    command.push(' ');
    command.push_str(remote);
    Ok(command)
}

fn load_key(path: Option<&Path>) -> Result<Key, String> {
    let path = match path {
        Some(path) => path.to_path_buf(),
        None => Key::default_path().ok_or("no HOME, so no ~/.android/adbkey: pass --key")?,
    };
    Key::load(&path).map_err(|error| format!("{}: {error}", path.display()))
}

fn dial(device: &str, timeout: Duration) -> Result<TcpStream, String> {
    let target = if device.contains(':') { device.to_string() } else { format!("{device}:{DEFAULT_PORT}") };
    let address = target
        .to_socket_addrs()
        .map_err(|error| format!("{target}: {error}"))?
        .next()
        .ok_or_else(|| format!("{target} resolves to no address"))?;

    let socket =
        TcpStream::connect_timeout(&address, timeout).map_err(|error| format!("{target}: {error}"))?;
    socket.set_read_timeout(Some(timeout)).map_err(|error| error.to_string())?;
    socket.set_write_timeout(Some(timeout)).map_err(|error| error.to_string())?;
    // Packets are acknowledged one at a time; Nagle would sit on every ack.
    socket.set_nodelay(true).map_err(|error| error.to_string())?;
    Ok(socket)
}

fn create(path: &Path) -> Result<File, String> {
    File::create(path).map_err(|error| format!("{}: {error}", path.display()))
}

fn epoch_seconds() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |since| since.as_secs())
}

/// Everything said on stderr, so stdout carries only what was asked for.
struct Report {
    quiet: bool,
}

impl Report {
    fn say(&self, message: &str) {
        if !self.quiet {
            eprintln!("akashi-adb: {message}");
        }
    }

    /// What a transfer cost, which is the number this experiment exists to
    /// produce: bytes, seconds, and the rate between them.
    fn transfer(&self, bytes: u64, started: Instant, output: &Path) {
        let elapsed = started.elapsed();
        let rate = bytes as f64 / elapsed.as_secs_f64() / 1_000_000.0;
        self.say(&format!("{bytes} bytes in {elapsed:.2?} ({rate:.1} MB/s) -> {}", output.display()));
    }
}
