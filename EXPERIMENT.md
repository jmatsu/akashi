# Experiments

What Akashi has tried that is not part of the app. Nothing here is a product
feature: it ships on its own terms, can be dropped, and the browser app never
depends on it. See [README](README.md) for the app itself.

## The GIF encoder from a shell

An experiment, not a product feature: the encoder the browser reaches through
wasm, driven from a pipe instead. It sits behind a Cargo feature, so neither
the library nor the wasm module carries any of it.

Built binaries for Linux, macOS and Windows are attached to the
[`cli-v*` releases](https://github.com/jmatsu/akashi/releases), with a
`SHA256SUMS` beside them. Or build it yourself:

```sh
cargo build --manifest-path crate/Cargo.toml --release --features cli
crate/target/release/akashi-gif --help
```

A released binary reports the tag it was cut from and the commit under it —
`0.1.0-a1b2c3d` — so `--version` in a bug report names one commit and no other.
Built from a checkout it reports the crate version alone.

Decoding is somebody else's problem here for the same reason it is in the app.
There a `<video>` element does it; here ffmpeg does, and the binary is the
encoder and nothing more:

```sh
ffmpeg -i clip.mp4 -ss 2 -to 6 -vf scale=640:-1 -f rawvideo -pix_fmt rgba - \
  | akashi-gif --width 640 --height 360 --fps 10 -o out.gif
```

Frames are read as tightly packed `width * height * 4` bytes, so `--width` and
`--height` have to be the size ffmpeg is scaling to. What the app does with two
handles and an output-width box is `-ss`, `-to` and `scale`. Frames are held in
memory until the palette is settled — a pipe cannot be rewound to sample a
spread of it — and `--max-frames` (300, the app's own ceiling) is what bounds
that.

Redaction is not exposed: `apply_region` is an editor interaction, not a
conversion.

## ADB over TCP/IP

The question was whether a screenshot could come off an Android phone and into
Akashi over Wi-Fi, with nothing in between — no cable, no `adb` server, and
above all nothing the bytes could be uploaded to. The answer is yes, and not
from the browser. Both halves of that are the finding.

`akashi-adb` is the prototype: the ADB wire protocol spoken straight to a
device, behind the `adb` feature, so the library and the wasm module carry none
of it.

```sh
cargo build --manifest-path crate/Cargo.toml --release --features adb
crate/target/release/akashi-adb --device 192.168.1.24 screenshot -o shot.png
crate/target/release/akashi-adb --device 192.168.1.24 record --seconds 8 -o clip.mp4
```

The device has to be listening first — `adb tcpip 5555` once over a cable — and
to have authorised this workstation, which costs nothing extra because the
handshake is signed with the same `~/.android/adbkey` that `adb` itself uses.

### What it does

Measured against a Pixel 3 XL on Android 12, on the same Wi-Fi, with
`adb 1.0.41` over the identical link as the reference.

- **Connects and authenticates.** `CNXN`, then the daemon's 20-byte challenge
  signed with the workstation's RSA key: online in 20–60 ms. Nothing on port
  5037 is involved — the local `adb` server is not started and not needed.
- **Takes a screenshot.** `exec:screencap -p`, straight to a PNG. On identical
  screen content it produces a byte-for-byte identical file to
  `adb exec-out screencap -p`, in 1.24 s against `adb`'s 1.06 s for a 98 KB
  capture. On a full 3.3 MB screen both land in the 6–8 s range: that path is
  bound by `screencap` encoding the PNG, not by the wire.
- **Pulls a file.** The `sync:` service, `RECV`. A 20 MB pull comes back
  byte-identical to `adb pull` in 8.3–9.2 s against `adb`'s 7.6–7.9 s.
- **Records the screen.** `screenrecord` to `/sdcard`, then the pull, then the
  staged file is removed whether or not the pull worked. The MP4 plays.
- **Raises the authorisation dialog** on a device that has never seen the key,
  by offering the packed `RSAPublicKey` blob Android's verifier reads. Confirmed
  on the device: `com.android.systemui/.usb.UsbDebuggingActivity`.

The gap to `adb` on bulk transfer — 10 to 18% — is the one design decision worth
naming. Every `WRTE` is acknowledged before the next is read, where `adb`
negotiates `delayed_ack` and keeps a window in flight. One packet per round trip
is the honest, small implementation; it costs a round trip per packet.

### What it cannot do

- **Run in the browser. Not now, and not by trying harder.** A page cannot open
  a TCP socket, and ADB is binary framing on a raw one — a WebSocket is a
  different protocol, not a socket. The Direct Sockets API exists but only for
  Isolated Web Apps, which are signed, installed bundles rather than a site at a
  URL. WebUSB is the one route a page has to a device, and it is USB, so it is
  neither TCP/IP nor available on iOS. Anything that closed the gap would be a
  bridge on the network, which is a backend, which is the one thing Akashi does
  not have. `src/csp.ts` and `test/offline.test.ts` would both have to be
  relaxed to ship it; neither should be.
- **Talk to Wireless debugging as Android 11+ pairs it.** The `adb pair` flow
  puts the daemon behind TLS, and this client asks for the oldest protocol
  version precisely so a modern daemon stays on the classic `AUTH` path instead
  of answering `STLS`. Against a device that only offers pairing it stops with
  that in the error rather than guessing. Supporting it means a TLS stack and
  SPAKE2 — two dependencies to prove a point already made.
- **Learn that a dialog was refused.** Dismissing it produces no packet at all;
  the daemon simply stops talking, so a refusal and a person who has not picked
  the phone up yet are the same silence. The 120 s default timeout is that. A
  shorter one loses the race, visibly — with `--timeout 15` the device logged
  `authorization received for deleted transport (19), ignoring` as the tap
  landed after the socket had already gone.
- **Run two streams at once.** Real ADB multiplexes; `Device::open` hands out
  one stream at a time, which is all a screenshot or a file needs.
- **Stream a recording.** `screenrecord` writes a file and has no MP4 mode that
  goes to stdout, so a recording is staged on the device and pulled afterwards.
  It is also capped at 180 seconds and carries no audio — both `screenrecord`'s
  limits, not this client's.
- **Find the device.** The IP has to be known. The daemon advertises itself over
  mDNS and none of that is implemented here.
- **Reach anything the shell user cannot read.** App-private storage comes back
  as a `FAIL` with the device's own reason, which is correct and worth knowing
  before planning around it.

### Conclusion

It works, and it is the wrong shape for Akashi.

Taking a screenshot off a phone over TCP/IP turns out to be about 700 lines and
one dependency, and the result is at parity with `adb` for everything a ticket
needs. But it can only ever be a binary on a workstation — the browser app, the
part of Akashi that anyone actually uses, is exactly where this cannot go. And
on a workstation it competes with `adb`, which is already installed on any
machine that put the device in TCP/IP mode in the first place.

So it stays here, next to the GIF encoder: something tried, kept for the record,
depended on by nothing. The browser-native answer to the same want was always
simpler — Akashi is a PWA and runs on the phone, so a screenshot taken there can
be annotated there, and the transfer that this experiment exists to perform
never has to happen.

One thing to put away afterwards: `adb tcpip 5555` leaves a debugging port open
on the network until the device reboots. `adb usb` closes it.
