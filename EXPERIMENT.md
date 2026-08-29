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
