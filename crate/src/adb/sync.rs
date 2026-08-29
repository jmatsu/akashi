//! The file half of ADB: the `sync:` service, and the one request of it this
//! experiment needs -- `RECV`, which is what `adb pull` is underneath.
//!
//! Requests and responses are a four-byte id and a little-endian length, laid
//! end to end inside the stream from [`super::Device::open`]. A pull answers
//! with `DATA` chunks until `DONE`, or one `FAIL` carrying the reason the
//! device could not read the path -- which for anything outside the shell
//! user's reach is what comes back.

use std::io::{self, Read, Write};

/// The largest chunk the daemon puts in one `DATA`.
const DATA_MAX: usize = 64 * 1024;

/// Copies a file off the device, returning the number of bytes written.
pub fn pull<T: Read + Write, W: Write>(stream: &mut T, remote: &str, out: &mut W) -> io::Result<u64> {
    request(stream, b"RECV", remote.as_bytes())?;

    let mut written = 0u64;
    loop {
        let (id, length) = response(stream)?;
        match &id {
            b"DATA" => {
                if length > DATA_MAX {
                    return Err(invalid(format!("a {length}-byte DATA is past the chunk size")));
                }
                let mut chunk = vec![0u8; length];
                stream.read_exact(&mut chunk)?;
                out.write_all(&chunk)?;
                written += length as u64;
            }
            // The trailing word is the file's mtime, which we do not carry over.
            b"DONE" => {
                let _ = request(stream, b"QUIT", &[]);
                return Ok(written);
            }
            b"FAIL" => {
                let mut reason = vec![0u8; length.min(1024)];
                stream.read_exact(&mut reason)?;
                return Err(io::Error::other(format!(
                    "the device refused `{remote}`: {}",
                    String::from_utf8_lossy(&reason)
                )));
            }
            _ => return Err(invalid(format!("unexpected sync response {}", name(&id)))),
        }
    }
}

fn request<T: Write>(stream: &mut T, id: &[u8; 4], payload: &[u8]) -> io::Result<()> {
    let mut frame = Vec::with_capacity(8 + payload.len());
    frame.extend_from_slice(id);
    frame.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    frame.extend_from_slice(payload);
    stream.write_all(&frame)
}

fn response<T: Read>(stream: &mut T) -> io::Result<([u8; 4], usize)> {
    let mut header = [0u8; 8];
    stream.read_exact(&mut header)?;
    let id: [u8; 4] = header[..4].try_into().expect("four of eight bytes");
    let length = u32::from_le_bytes(header[4..].try_into().expect("four of eight bytes"));
    Ok((id, length as usize))
}

fn name(id: &[u8; 4]) -> String {
    String::from_utf8_lossy(id).into_owned()
}

fn invalid(message: String) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A `sync:` stream made of bytes: the daemon's script to read, and what
    /// the client sent kept for the test.
    struct FakeStream {
        outgoing: io::Cursor<Vec<u8>>,
        incoming: Vec<u8>,
    }

    impl FakeStream {
        fn new(script: &[(&[u8; 4], &[u8])]) -> Self {
            let mut outgoing = Vec::new();
            for (id, payload) in script {
                outgoing.extend_from_slice(*id);
                outgoing.extend_from_slice(&(payload.len() as u32).to_le_bytes());
                outgoing.extend_from_slice(payload);
            }
            Self { outgoing: io::Cursor::new(outgoing), incoming: Vec::new() }
        }
    }

    impl Read for FakeStream {
        fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
            self.outgoing.read(out)
        }
    }

    impl Write for FakeStream {
        fn write(&mut self, data: &[u8]) -> io::Result<usize> {
            self.incoming.write(data)
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn a_pull_is_the_data_chunks_end_to_end() {
        let mut stream = FakeStream::new(&[(b"DATA", b"first "), (b"DATA", b"second"), (b"DONE", &[0; 4])]);
        let mut file = Vec::new();
        let written = pull(&mut stream, "/sdcard/clip.mp4", &mut file).expect("a readable file");

        assert_eq!(file, b"first second");
        assert_eq!(written, 12);
        assert_eq!(&stream.incoming[..4], b"RECV");
        assert_eq!(u32::from_le_bytes(stream.incoming[4..8].try_into().unwrap()), 16);
        assert_eq!(&stream.incoming[8..24], b"/sdcard/clip.mp4");
    }

    #[test]
    fn a_pull_of_nothing_is_an_empty_file_rather_than_an_error() {
        let mut stream = FakeStream::new(&[(b"DONE", &[0; 4])]);
        let mut file = Vec::new();
        assert_eq!(pull(&mut stream, "/sdcard/empty", &mut file).unwrap(), 0);
        assert!(file.is_empty());
    }

    #[test]
    fn a_refusal_carries_the_reason_the_device_gave() {
        let mut stream = FakeStream::new(&[(b"FAIL", b"Permission denied")]);
        let mut file = Vec::new();
        let error = pull(&mut stream, "/data/data/x", &mut file).expect_err("shell cannot read it");
        assert!(error.to_string().contains("Permission denied"));
        assert!(error.to_string().contains("/data/data/x"));
    }

    #[test]
    fn a_truncated_transfer_is_an_error_rather_than_a_short_file() {
        let mut stream = FakeStream::new(&[(b"DATA", b"half")]);
        let mut file = Vec::new();
        assert!(pull(&mut stream, "/sdcard/clip.mp4", &mut file).is_err());
    }

    #[test]
    fn a_chunk_beyond_the_protocols_own_ceiling_is_refused() {
        let mut stream = FakeStream::new(&[]);
        stream.outgoing = io::Cursor::new({
            let mut wire = b"DATA".to_vec();
            wire.extend_from_slice(&(DATA_MAX as u32 + 1).to_le_bytes());
            wire
        });
        let mut file = Vec::new();
        assert!(pull(&mut stream, "/sdcard/clip.mp4", &mut file).is_err());
    }
}
