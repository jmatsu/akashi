# A draft over WebUSB

An experiment, not a product feature. Akashi's draft already crosses devices —
`Export ▸ Draft` writes a `.akashi`, and AirDrop, Quick Share, a cable or a
shared folder carry it. The question this asks is whether the browser can carry
it *itself*, over the cable, with no server and no file manager in between.

The answer is that it can, on exactly one pairing, at a price the feature is not
worth. What follows is what was built, what it does, what it cannot do, and why
it stays here rather than in the app.

## Running it

```sh
adb kill-server          # it holds the interface this page needs
npm run dev:webusb       # vite, on the experiment's own root
```

Then, on the phone: developer options, USB debugging on, cable in. In the page,
**Pick an adb device**, **adb connect**, accept the dialog that appears on the
phone, and **List** `/sdcard/Download`.

Nothing here is part of `npm run build`: the app's entry is the repository's own
`index.html`, and `dist/` never sees this directory. The unit tests do run with
the rest — `npm test` covers the framing, the padding and the key encoding.

## What is in here

```
adb/message.ts   The 24-byte header: commands, checksum, magic
adb/rsa.ts       The signature adbd wants, and Android's public-key struct
adb/sync.ts      The `sync:` packets: SEND, RECV, LIST, DATA, DONE
adb/device.ts    Interface discovery, the bulk pair, connect/auth, one stream
adb/transfer.ts  push, pull and list on top of a `sync:` stream
probe.ts         What a device exposes, and what a page may claim of it
main.ts          The page
```

The protocol layers are DOM-free and USB-free, which is what lets the tests
exercise them against OpenSSL and against Android's own encoding without a
device in the room.

## What it can do

- **Speak ADB from a page.** The full handshake is reachable with what a browser
  already has: `CNXN`, the `AUTH` token/signature/public-key exchange, `OPEN
  sync:`, and the sync protocol on top. No native helper, no extension.
- **Move a draft in both directions.** `push` sends a `.akashi` to
  `/sdcard/Download`; `pull` brings one back and hands it to the browser as a
  download. `list` finds the drafts already on the phone, which is the direction
  that matters — annotate on the phone, finish on the desktop.
- **Sign without WebCrypto being able to help.** adbd hands over a 20-byte token
  and expects a PKCS#1 v1.5 signature in which that token *is* the SHA-1 digest;
  `crypto.subtle.sign` would hash it a second time. The padding and the modular
  exponentiation are done by hand, and the test asserts that OpenSSL recovers
  exactly the padded token from the result.
- **Encode the public key the way Android decodes it.** Not PEM, not JWK: a
  524-byte struct with the modulus and the Montgomery `rr` little-endian and
  `n0inv` precomputed. The test checks all four fields against the modulus.
- **Stay off the network.** WebUSB is not an origin, so nothing here is a request
  and nothing in `src/csp.ts` or `biome.json` had to be relaxed. This was the
  open question worth answering, and the answer is that the principle survives.
- **Remember the pairing.** The permission is per-origin and persistent
  (`navigator.usb.getDevices()`), and the RSA key is kept in `localStorage`, so
  the phone's "always allow from this computer" keeps holding after a reload.

## What it cannot do

**Chromium only, so most of Akashi's platforms are out.** Safari and Firefox
have both declined to implement WebUSB on privacy grounds and say so in their
standards positions. Every browser on iOS is WebKit, so iOS is out entirely —
and iOS is the platform where getting a file off the device is most awkward,
which is to say the case that most needed help is the one case this cannot
serve.

**USB roles fix the direction.** A laptop cannot be a USB gadget, so
desktop-to-desktop has no path at all; a page is always the host and the phone
is always the device. Chrome on Android in OTG mode is a host too, so
phone-to-phone is out for the same reason.

**Mass storage is a protected class.** WebUSB refuses to claim class `0x08`
whatever the OS thinks, so a USB stick can never be the courier. The same list
rules out HID, audio, video, smart card and wireless controllers. The probe
tests this rather than assuming it: **Test what is claimable** claims and
releases every interface and reports what the browser actually said.

**MTP is not a way around it.** The interface is claimable by class, but on
macOS and Windows the OS or a helper already holds it, and Chrome cannot claim
an interface a kernel driver has. Where it is free — Linux, where MTP is
user-space — the prize is implementing MTP to copy one file.

**ADB is a large permission for a small errand.** It needs developer options,
USB debugging on, and the user accepting an RSA fingerprint on the phone. That
setting is precisely the one that lets any host holding the key read and write
the whole device. A page that can speak `sync:` is a few lines from `shell:`:
this directory is about 500 lines, and none of the remaining distance is
technical.

**The host's own `adb` gets in the way.** If an `adb` server is running it has
already claimed the interface and `claimInterface` fails. `adb kill-server`
fixes it, and nothing in a page can do that for the user.

**Per-OS setup remains.** Windows wants the device bound to WinUSB rather than a
vendor driver; Linux wants a udev rule. Neither is something the page can
arrange.

**Android 11 and later can ask for TLS.** If a device answers the handshake with
`STLS`, a page cannot continue — TLS inside a bulk stream is not something the
platform exposes. The code reports this rather than hanging. It is the wireless
path that normally requires it, so a cable should not hit it, but it is a
standing risk rather than a settled one.

**The phone is passive.** It runs no Akashi code during the transfer: the draft
has to already be a file in its storage, which means its owner already tapped
`Export ▸ Draft`. Once a file is sitting in Downloads, AirDrop, Quick Share and
a file manager over MTP all already move it. The step this replaces is not the
step that was hard.

## What has been verified, and what has not

Verified here: the framing, the padding, the signature (against OpenSSL's
recovery) and the public-key struct, all under `npm test`; and the page booting,
detecting WebUSB and reporting its failures, in Chrome 152 on macOS 26.6.

Not yet verified: a transfer against a real phone. Everything from
`claimInterface` onwards — the handshake, the dialog, `sync:`, the throughput —
is written from the protocol and has not been run against a device. Nothing in
the section above depends on the outcome, but the "it can do" list is a claim
about code, not yet a report from hardware.

## Conclusion

It works, and it should not ship.

The transfer is buildable and the privacy principle survives it, which are the
two things worth knowing. But it reaches Chromium-on-desktop paired with an
Android phone in developer mode, and it asks for whole-device access to move a
screenshot between two devices that already have three ways to move a file. The
platform it would help most — iOS — is the one platform it can never reach.

If continuing a draft on another device deserves a better path than the file
system, the direction is somewhere else. This one is a dead end worth having
mapped.
