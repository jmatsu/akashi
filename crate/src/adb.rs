//! An experiment: the ADB protocol spoken straight to a device over TCP/IP.
//!
//! Not a product feature, and not something the browser app could ever reach
//! -- a page cannot open a TCP socket, which is the finding this exists to
//! demonstrate. See `EXPERIMENT.md`. What it is instead is the smallest client
//! that can take a screenshot off a phone on the same Wi-Fi: connect, sign the
//! daemon's challenge, open one service, read the bytes back.
//!
//! `adb tcpip 5555` on a cabled device, or Wireless debugging in the developer
//! settings, is what puts a daemon on the far end of the port. Nothing here
//! talks to the local `adb` server on 5037; the point is that the server is
//! not in the way.
//!
//! Multiplexing is the part deliberately left out. Real ADB runs many streams
//! over the one connection; [`Device::open`] hands out one at a time, which is
//! all a screenshot or a file needs, and it keeps the flow control honest --
//! every `WRTE` is acknowledged before the next is read.

mod auth;
mod message;
mod sync;

use std::io::{self, Read, Write};

use message::{
    A_AUTH, A_CLSE, A_CNXN, A_OKAY, A_OPEN, A_STLS, A_WRTE, AUTH_RSAPUBLICKEY, AUTH_SIGNATURE, AUTH_TOKEN,
    Message,
};

pub use auth::Key;
pub use sync::pull;

/// The oldest protocol version, and asked for on purpose. A daemon told it is
/// talking to a modern client answers Android 11 and up with `STLS` and wants
/// TLS from there -- a second dependency, and one this experiment does not
/// need to make its point.
const VERSION: u32 = 0x0100_0000;

/// The largest payload we will accept in one packet, and what we advertise.
const MAX_PAYLOAD: u32 = 256 * 1024;

/// What a device that has never seen us before is asked to trust. It is shown
/// in the *Allow USB debugging?* dialog, beside the key's fingerprint.
const CLIENT_NAME: &str = "akashi-adb";

/// A connected daemon. Generic over the socket so the handshake can be tested
/// against a daemon made of bytes rather than a phone.
pub struct Device<S: Read + Write> {
    socket: S,
    banner: String,
    max_payload: usize,
    next_local_id: u32,
}

impl<S: Read + Write> Device<S> {
    /// Performs the `CNXN`/`AUTH` handshake and returns once the daemon has
    /// declared the connection online.
    ///
    /// The key signs the daemon's challenge. If the device does not know the
    /// key it asks again, and the second answer is the public key itself,
    /// which raises the dialog -- so this call blocks until somebody taps it.
    pub fn connect(socket: S, key: &Key) -> io::Result<Self> {
        let mut device =
            Self { socket, banner: String::new(), max_payload: MAX_PAYLOAD as usize, next_local_id: 1 };
        device.send(Message::new(A_CNXN, VERSION, MAX_PAYLOAD, banner()))?;

        let mut offered = Offered::Nothing;
        loop {
            // A device whose dialog is dismissed says nothing at all rather
            // than refusing, so silence after the key has been offered is the
            // refusal -- and the only shape one ever takes.
            let message = device.receive().map_err(|error| match offered {
                Offered::PublicKey if timed_out(&error) => io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "the device never answered the key it was offered -- \
                     the dialog is waiting, or it was dismissed",
                ),
                _ => error,
            })?;
            match (message.command, message.arg0) {
                (A_CNXN, _) => {
                    device.banner =
                        String::from_utf8_lossy(&message.payload).trim_end_matches('\0').to_string();
                    // The daemon's own ceiling; an older one is far below ours.
                    device.max_payload = device.max_payload.min(message.arg1.max(4096) as usize);
                    return Ok(device);
                }
                (A_AUTH, AUTH_TOKEN) => {
                    let answer = match offered {
                        Offered::Nothing => {
                            offered = Offered::Signature;
                            Message::new(A_AUTH, AUTH_SIGNATURE, 0, key.sign(&message.payload)?)
                        }
                        Offered::Signature => {
                            offered = Offered::PublicKey;
                            let payload = key.public_key_payload(CLIENT_NAME);
                            Message::new(A_AUTH, AUTH_RSAPUBLICKEY, 0, payload)
                        }
                        Offered::PublicKey => {
                            return Err(io::Error::new(
                                io::ErrorKind::PermissionDenied,
                                "the device rejected the key -- \
                                 the dialog was dismissed, or debugging is revoked",
                            ));
                        }
                    };
                    device.send(answer)?;
                }
                (A_STLS, _) => {
                    return Err(io::Error::new(
                        io::ErrorKind::Unsupported,
                        "the daemon wants TLS, which this experiment does not speak",
                    ));
                }
                _ => return Err(unexpected(&message, "during the handshake")),
            }
        }
    }

    /// What the device said it is, and what it can do: product, model, and the
    /// feature list the daemon offers.
    pub fn banner(&self) -> &str {
        &self.banner
    }

    /// The largest packet either end will put on the wire. It is the number
    /// that decides how fast a transfer runs, since every packet costs a round
    /// trip -- see `EXPERIMENT.md`.
    pub fn max_payload(&self) -> usize {
        self.max_payload
    }

    /// Opens one of the daemon's services -- `exec:screencap -p`, `sync:`,
    /// `shell:...` -- and returns the stream it answers on.
    pub fn open(&mut self, service: &str) -> io::Result<Stream<'_, S>> {
        let local_id = self.next_local_id;
        self.next_local_id += 1;

        let mut payload = service.as_bytes().to_vec();
        payload.push(0);
        self.send(Message::new(A_OPEN, local_id, 0, payload))?;

        loop {
            let message = self.receive()?;
            match message.command {
                A_OKAY if message.arg1 == local_id => {
                    let remote_id = message.arg0;
                    let max_payload = self.max_payload;
                    return Ok(Stream {
                        device: self,
                        local_id,
                        remote_id,
                        max_payload,
                        pending: Vec::new(),
                        read: 0,
                        closed: false,
                    });
                }
                A_CLSE if message.arg1 == local_id => {
                    return Err(io::Error::new(
                        io::ErrorKind::ConnectionRefused,
                        format!("the device refused the service `{service}`"),
                    ));
                }
                // A packet for a stream that is already gone; ADB expects it
                // to be dropped rather than answered.
                A_WRTE | A_OKAY | A_CLSE => continue,
                _ => return Err(unexpected(&message, "while opening a stream")),
            }
        }
    }

    fn send(&mut self, message: Message) -> io::Result<()> {
        message.write_to(&mut self.socket)
    }

    fn receive(&mut self) -> io::Result<Message> {
        Message::read_from(&mut self.socket)
    }
}

/// How far through the two answers to a challenge we are. A daemon repeats the
/// challenge after each, so without this the same signature goes back forever.
enum Offered {
    Nothing,
    Signature,
    PublicKey,
}

/// One service's byte stream. Reads block until the device writes; the end of
/// the stream is the device closing it, which for `exec:` is the command
/// exiting.
pub struct Stream<'a, S: Read + Write> {
    device: &'a mut Device<S>,
    local_id: u32,
    remote_id: u32,
    max_payload: usize,
    pending: Vec<u8>,
    read: usize,
    closed: bool,
}

impl<S: Read + Write> Stream<'_, S> {
    /// Reads packets until one carries data for us, acknowledging each as ADB
    /// requires -- an unacknowledged `WRTE` stops the daemon sending the next.
    fn fill(&mut self) -> io::Result<()> {
        while self.read == self.pending.len() && !self.closed {
            let message = self.device.receive()?;
            match message.command {
                A_WRTE if message.arg1 == self.local_id => {
                    self.pending = message.payload;
                    self.read = 0;
                    let ack = Message::new(A_OKAY, self.local_id, self.remote_id, Vec::new());
                    self.device.send(ack)?;
                }
                A_CLSE if message.arg1 == self.local_id => self.closed = true,
                A_OKAY | A_WRTE | A_CLSE => continue,
                _ => return Err(unexpected(&message, "on an open stream")),
            }
        }
        Ok(())
    }

    /// Closes the stream, so the next one starts from a quiet connection.
    pub fn close(mut self) -> io::Result<()> {
        self.shutdown()
    }

    fn shutdown(&mut self) -> io::Result<()> {
        if self.closed {
            return Ok(());
        }
        self.closed = true;
        self.device.send(Message::new(A_CLSE, self.local_id, self.remote_id, Vec::new()))
    }
}

impl<S: Read + Write> Read for Stream<'_, S> {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        self.fill()?;
        let available = &self.pending[self.read..];
        let taken = available.len().min(out.len());
        out[..taken].copy_from_slice(&available[..taken]);
        self.read += taken;
        Ok(taken)
    }
}

impl<S: Read + Write> Write for Stream<'_, S> {
    /// Writes one packet and waits for its acknowledgement, which is the flow
    /// control ADB has. Anything the device says meanwhile is kept for [`read`].
    ///
    /// [`read`]: Read::read
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        if self.closed {
            return Err(io::Error::new(io::ErrorKind::BrokenPipe, "the device closed the stream"));
        }
        let taken = data.len().min(self.max_payload);
        let packet = Message::new(A_WRTE, self.local_id, self.remote_id, data[..taken].to_vec());
        self.device.send(packet)?;

        loop {
            let message = self.device.receive()?;
            match message.command {
                A_OKAY if message.arg1 == self.local_id => return Ok(taken),
                A_WRTE if message.arg1 == self.local_id => {
                    // Held for the next read; the daemon still needs its ack.
                    self.pending.drain(..self.read);
                    self.read = 0;
                    self.pending.extend_from_slice(&message.payload);
                    let ack = Message::new(A_OKAY, self.local_id, self.remote_id, Vec::new());
                    self.device.send(ack)?;
                }
                A_CLSE if message.arg1 == self.local_id => {
                    self.closed = true;
                    return Err(io::Error::new(
                        io::ErrorKind::BrokenPipe,
                        "the device closed the stream mid-write",
                    ));
                }
                A_OKAY | A_WRTE | A_CLSE => continue,
                _ => return Err(unexpected(&message, "while writing to a stream")),
            }
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl<S: Read + Write> Drop for Stream<'_, S> {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

/// `host::features=` is what `adb` sends; we claim none, so the daemon offers
/// us the oldest shape of every service -- including the sync protocol in
/// [`sync`], which is written to the version without `sendrecv_v2`.
fn banner() -> Vec<u8> {
    b"host::features=\0".to_vec()
}

/// A socket read that ran out its timeout, which one platform calls a timeout
/// and another calls a would-block.
fn timed_out(error: &io::Error) -> bool {
    matches!(error.kind(), io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock)
}

fn unexpected(message: &Message, when: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, format!("unexpected {} {when}", message.name()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// A daemon made of bytes: it replies from a script written in advance,
    /// and keeps what the client said for the test to read back.
    struct FakeDaemon {
        outgoing: Cursor<Vec<u8>>,
        incoming: Vec<u8>,
    }

    impl FakeDaemon {
        fn new(script: Vec<Message>) -> Self {
            let mut outgoing = Vec::new();
            for message in &script {
                message.write_to(&mut outgoing).expect("a vec accepts every write");
            }
            Self { outgoing: Cursor::new(outgoing), incoming: Vec::new() }
        }

        fn heard(&self) -> Vec<Message> {
            let mut wire = self.incoming.as_slice();
            let mut heard = Vec::new();
            while let Ok(message) = Message::read_from(&mut wire) {
                heard.push(message);
            }
            heard
        }
    }

    impl Read for FakeDaemon {
        fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
            self.outgoing.read(out)
        }
    }

    impl Write for FakeDaemon {
        fn write(&mut self, data: &[u8]) -> io::Result<usize> {
            self.incoming.write(data)
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    fn key() -> Key {
        Key::from_pem(include_str!("adb/testdata/adbkey-pkcs8.pem")).expect("the test key")
    }

    fn online() -> Message {
        Message::new(A_CNXN, VERSION, MAX_PAYLOAD, b"device::ro.product.name=akashi\0".to_vec())
    }

    fn connect(script: Vec<Message>) -> io::Result<Device<FakeDaemon>> {
        Device::connect(FakeDaemon::new(script), &key())
    }

    /// Neither a `Device` nor a `Stream` is `Debug` -- there is a socket in
    /// both -- so a failed call gives up its error this way rather than
    /// through `expect_err`.
    fn refusal<T>(result: io::Result<T>) -> io::Error {
        result.err().expect("the call was supposed to fail")
    }

    #[test]
    fn a_daemon_that_needs_no_auth_comes_online_at_once() {
        let device = connect(vec![online()]).expect("a daemon that trusts us");
        assert_eq!(device.banner(), "device::ro.product.name=akashi");
        let sent = device.socket.heard();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].command, A_CNXN);
        assert_eq!(sent[0].payload, b"host::features=\0");
    }

    #[test]
    fn the_oldest_protocol_version_is_asked_for_so_the_daemon_never_wants_tls() {
        let device = connect(vec![online()]).unwrap();
        assert_eq!(device.socket.heard()[0].arg0, VERSION);
    }

    #[test]
    fn a_challenge_is_answered_with_a_signature() {
        let challenge = Message::new(A_AUTH, AUTH_TOKEN, 0, vec![0x11; 20]);
        let device = connect(vec![challenge, online()]).expect("the signature is accepted");
        let answer = &device.socket.heard()[1];
        assert_eq!((answer.command, answer.arg0), (A_AUTH, AUTH_SIGNATURE));
        assert_eq!(answer.payload.len(), 256);
    }

    #[test]
    fn a_second_challenge_offers_the_public_key_that_raises_the_dialog() {
        let challenge = || Message::new(A_AUTH, AUTH_TOKEN, 0, vec![0x11; 20]);
        let device = connect(vec![challenge(), challenge(), online()]).expect("the dialog is taken");
        let answer = &device.socket.heard()[2];
        assert_eq!((answer.command, answer.arg0), (A_AUTH, AUTH_RSAPUBLICKEY));
        assert!(answer.payload.ends_with(b" akashi-adb\0"));
    }

    #[test]
    fn a_third_challenge_is_a_refusal_rather_than_a_loop() {
        let challenge = || Message::new(A_AUTH, AUTH_TOKEN, 0, vec![0x11; 20]);
        let error = refusal(connect(vec![challenge(), challenge(), challenge()]));
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
    }

    #[test]
    fn a_daemon_asking_for_tls_says_so_rather_than_hanging() {
        let error = refusal(connect(vec![Message::new(A_STLS, 1, 0, vec![])]));
        assert_eq!(error.kind(), io::ErrorKind::Unsupported);
    }

    #[test]
    fn the_payload_ceiling_is_the_smaller_of_the_two() {
        let device = connect(vec![Message::new(A_CNXN, VERSION, 4096, b"device::\0".to_vec())])
            .expect("an older daemon");
        assert_eq!(device.max_payload, 4096);
    }

    #[test]
    fn a_service_is_read_until_the_device_closes_the_stream() {
        let script = vec![
            online(),
            Message::new(A_OKAY, 12, 1, vec![]),
            Message::new(A_WRTE, 12, 1, b"\x89PNG".to_vec()),
            Message::new(A_WRTE, 12, 1, b"\r\n\x1a\n".to_vec()),
            Message::new(A_CLSE, 12, 1, vec![]),
        ];
        let mut device = connect(script).unwrap();
        let mut stream = device.open("exec:screencap -p").unwrap();

        let mut bytes = Vec::new();
        stream.read_to_end(&mut bytes).expect("the stream ends when the command exits");
        assert_eq!(bytes, b"\x89PNG\r\n\x1a\n");

        drop(stream);
        let heard = device.socket.heard();
        assert_eq!(heard[1].command, A_OPEN);
        assert_eq!(heard[1].payload, b"exec:screencap -p\0");
        // One acknowledgement per packet of data, or the daemon stops sending.
        assert_eq!(heard.iter().filter(|m| m.command == A_OKAY).count(), 2);
    }

    #[test]
    fn a_service_the_device_will_not_open_is_an_error() {
        let script = vec![online(), Message::new(A_CLSE, 0, 1, vec![])];
        let mut device = connect(script).unwrap();
        assert_eq!(refusal(device.open("exec:nope")).kind(), io::ErrorKind::ConnectionRefused);
    }

    #[test]
    fn a_write_waits_for_its_acknowledgement_and_keeps_what_arrives_meanwhile() {
        let script = vec![
            online(),
            Message::new(A_OKAY, 12, 1, vec![]),
            Message::new(A_WRTE, 12, 1, b"early".to_vec()),
            Message::new(A_OKAY, 12, 1, vec![]),
            Message::new(A_CLSE, 12, 1, vec![]),
        ];
        let mut device = connect(script).unwrap();
        let mut stream = device.open("sync:").unwrap();
        assert_eq!(stream.write(b"STAT").expect("the daemon acknowledges"), 4);

        let mut rest = Vec::new();
        stream.read_to_end(&mut rest).unwrap();
        assert_eq!(rest, b"early");
    }
}
