//! The 24-byte header every ADB packet begins with, and the packet itself.
//!
//! Layout, all little-endian: command, arg0, arg1, payload length, payload
//! checksum, and the command's own bitwise complement as a magic. Nothing here
//! knows what a command means -- that is [`super`]'s job.

use std::io::{self, Read, Write};

pub const A_CNXN: u32 = u32::from_le_bytes(*b"CNXN");
pub const A_AUTH: u32 = u32::from_le_bytes(*b"AUTH");
pub const A_OPEN: u32 = u32::from_le_bytes(*b"OPEN");
pub const A_OKAY: u32 = u32::from_le_bytes(*b"OKAY");
pub const A_WRTE: u32 = u32::from_le_bytes(*b"WRTE");
pub const A_CLSE: u32 = u32::from_le_bytes(*b"CLSE");
/// Sent by an Android 11 or newer daemon that wants the rest of the connection
/// wrapped in TLS. See `super::Device::handshake` for why we never see it.
pub const A_STLS: u32 = u32::from_le_bytes(*b"STLS");

/// `AUTH` arg0: the daemon's 20-byte challenge.
pub const AUTH_TOKEN: u32 = 1;
/// `AUTH` arg0: our signature over that challenge.
pub const AUTH_SIGNATURE: u32 = 2;
/// `AUTH` arg0: our public key, which is what raises the dialog on the device.
pub const AUTH_RSAPUBLICKEY: u32 = 3;

pub const HEADER_LEN: usize = 24;

/// A refusal to allocate on a length field alone: no service this speaks sends
/// a payload near it, and the peer is a device on a network.
const MAX_PAYLOAD: usize = 1024 * 1024;

pub struct Message {
    pub command: u32,
    pub arg0: u32,
    pub arg1: u32,
    pub payload: Vec<u8>,
}

impl Message {
    pub fn new(command: u32, arg0: u32, arg1: u32, payload: Vec<u8>) -> Self {
        Self { command, arg0, arg1, payload }
    }

    /// The command as the four ASCII bytes it was written as, for errors.
    pub fn name(&self) -> String {
        String::from_utf8_lossy(&self.command.to_le_bytes()).into_owned()
    }

    pub fn write_to<W: Write>(&self, out: &mut W) -> io::Result<()> {
        let mut header = [0u8; HEADER_LEN];
        let words = [
            self.command,
            self.arg0,
            self.arg1,
            self.payload.len() as u32,
            checksum(&self.payload),
            !self.command,
        ];
        for (slot, value) in header.as_chunks_mut::<4>().0.iter_mut().zip(words) {
            *slot = value.to_le_bytes();
        }
        out.write_all(&header)?;
        out.write_all(&self.payload)?;
        out.flush()
    }

    pub fn read_from<R: Read>(input: &mut R) -> io::Result<Self> {
        let mut header = [0u8; HEADER_LEN];
        input.read_exact(&mut header)?;
        let mut fields = header.as_chunks::<4>().0.iter().copied().map(u32::from_le_bytes);
        let mut next = || fields.next().expect("a 24-byte header is six words");
        let (command, arg0, arg1, length, sum, magic) = (next(), next(), next(), next(), next(), next());

        if magic != !command {
            return Err(invalid(format!("header magic {magic:#x} does not match command")));
        }
        let length = length as usize;
        if length > MAX_PAYLOAD {
            return Err(invalid(format!("payload of {length} bytes is beyond anything ADB sends")));
        }
        let mut payload = vec![0u8; length];
        input.read_exact(&mut payload)?;

        // A daemon told it is talking to a modern client stops filling the
        // checksum in, and a zero is then no evidence either way. We ask for
        // the older protocol, so a non-zero one is still expected to add up.
        if sum != 0 && sum != checksum(&payload) {
            return Err(invalid("payload does not match its checksum"));
        }
        Ok(Self { command, arg0, arg1, payload })
    }
}

/// The sum of the payload bytes, which is all ADB means by a checksum.
fn checksum(payload: &[u8]) -> u32 {
    payload.iter().fold(0u32, |sum, byte| sum.wrapping_add(u32::from(*byte)))
}

fn invalid(message: impl Into<Box<dyn std::error::Error + Send + Sync>>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(message: &Message) -> io::Result<Message> {
        let mut wire = Vec::new();
        message.write_to(&mut wire)?;
        Message::read_from(&mut wire.as_slice())
    }

    #[test]
    fn a_command_is_its_four_ascii_bytes_little_endian() {
        assert_eq!(A_CNXN, 0x4e58_4e43);
        assert_eq!(Message::new(A_WRTE, 0, 0, vec![]).name(), "WRTE");
    }

    #[test]
    fn a_message_survives_the_wire() {
        let sent = Message::new(A_WRTE, 7, 9, b"screencap -p".to_vec());
        let read = roundtrip(&sent).expect("a message we wrote is a message we can read");
        assert_eq!(read.command, A_WRTE);
        assert_eq!((read.arg0, read.arg1), (7, 9));
        assert_eq!(read.payload, b"screencap -p");
    }

    #[test]
    fn the_checksum_is_the_sum_of_the_payload_bytes() {
        let mut wire = Vec::new();
        Message::new(A_WRTE, 0, 0, vec![0xff, 0x01]).write_to(&mut wire).unwrap();
        assert_eq!(u32::from_le_bytes(wire[16..20].try_into().unwrap()), 0x100);
    }

    #[test]
    fn a_corrupted_payload_is_refused() {
        let mut wire = Vec::new();
        Message::new(A_WRTE, 0, 0, b"data".to_vec()).write_to(&mut wire).unwrap();
        wire[HEADER_LEN] ^= 0x01;
        assert!(Message::read_from(&mut wire.as_slice()).is_err());
    }

    #[test]
    fn a_header_whose_magic_is_not_the_complement_is_refused() {
        let mut wire = Vec::new();
        Message::new(A_OKAY, 0, 0, vec![]).write_to(&mut wire).unwrap();
        wire[20] ^= 0x01;
        assert!(Message::read_from(&mut wire.as_slice()).is_err());
    }

    #[test]
    fn a_zero_checksum_is_accepted_since_a_modern_daemon_stops_filling_it_in() {
        let mut wire = Vec::new();
        Message::new(A_WRTE, 0, 0, b"data".to_vec()).write_to(&mut wire).unwrap();
        wire[16..20].copy_from_slice(&0u32.to_le_bytes());
        assert!(Message::read_from(&mut wire.as_slice()).is_ok());
    }

    #[test]
    fn a_truncated_payload_is_an_error_rather_than_a_short_read() {
        let mut wire = Vec::new();
        Message::new(A_WRTE, 0, 0, b"data".to_vec()).write_to(&mut wire).unwrap();
        wire.truncate(HEADER_LEN + 2);
        assert!(Message::read_from(&mut wire.as_slice()).is_err());
    }
}
