// Generates the PWA icon set from geometry -- no image libraries, no binary
// blobs to review. Run after changing the mark; colours and the icon list come
// from src/brand.ts.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCENT, ICONS, INK, PAPER } from '../src/brand.ts'
import { PNG_SIGNATURE, chunk } from '../src/png.ts'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

/**
 * The mark in a 100-unit design space: a red disc on a rounded plate under a
 * white arrow. The `favicon.svg` below draws the same shape from these values.
 */
const MARK = {
  plateRadius: 22,
  plateMargin: 6,
  disc: 30,
  /** A bleeding plate has no margin, so the disc can be a little larger. */
  discBleed: 34,
  stroke: 10,
  tail: { x: -17, y: 17 },
  tip: { x: 16, y: -16 },
  barb: 17,
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

const clamp01 = (v) => Math.min(1, Math.max(0, v))

/** Antialiased coverage from a signed distance, in pixels. */
const cover = (d) => clamp01(0.5 - d)

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

function sdSegment(px, py, ax, ay, bx, by, halfWidth) {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  const t = lenSq === 0 ? 0 : clamp01(((px - ax) * dx + (py - ay) * dy) / lenSq)
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) - halfWidth
}

function over(dst, i, colour, a) {
  if (a <= 0) return
  for (let c = 0; c < 3; c++) dst[i + c] = Math.round(dst[i + c] * (1 - a) + colour[c] * a)
  dst[i + 3] = Math.round(dst[i + 3] * (1 - a) + 255 * a)
}

/**
 * `bleed` fills the whole square (maskable and iOS icons are cropped by the
 * platform); otherwise the plate is a rounded square with a margin.
 */
function renderIcon(size, bleed) {
  const px = new Uint8Array(size * size * 4)
  const s = size / 100
  const cx = size / 2
  const cy = size / 2

  const ink = rgb(INK)
  const accent = rgb(ACCENT)
  const paper = rgb(PAPER)

  const margin = bleed ? 0 : MARK.plateMargin * s
  const radius = bleed ? 0 : MARK.plateRadius * s
  const discR = (bleed ? MARK.discBleed : MARK.disc) * s
  const halfStroke = (MARK.stroke / 2) * s
  const ax = cx + MARK.tail.x * s
  const ay = cy + MARK.tail.y * s
  const bx = cx + MARK.tip.x * s
  const by = cy + MARK.tip.y * s
  const barb = MARK.barb * s

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const cxp = x + 0.5
      const cyp = y + 0.5

      const plate = cover(sdRoundRect(cxp, cyp, cx, cy, cx - margin, cy - margin, radius))
      over(px, i, ink, plate)
      over(px, i, accent, cover(Math.hypot(cxp - cx, cyp - cy) - discR) * plate)

      // Shaft, then the two barbs at the tip.
      let arrow = sdSegment(cxp, cyp, ax, ay, bx, by, halfStroke)
      arrow = Math.min(arrow, sdSegment(cxp, cyp, bx, by, bx - barb, by, halfStroke))
      arrow = Math.min(arrow, sdSegment(cxp, cyp, bx, by, bx, by + barb, halfStroke))
      over(px, i, paper, cover(arrow) * plate)
    }
  }
  return px
}

// --- minimal PNG writer -------------------------------------------------

// The container -- signature, framing, CRC -- comes from src/png.ts. Only the
// image data below is this script's own.

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    ...chunk('IHDR', [ihdr]),
    ...chunk('IDAT', [deflateSync(raw, { level: 9 })]),
    ...chunk('IEND', []),
  ])
}

const { plateRadius, disc, stroke, tail, tip, barb } = MARK
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="${plateRadius}" fill="${INK}"/>
  <circle cx="50" cy="50" r="${disc}" fill="${ACCENT}"/>
  <path d="M${50 + tail.x} ${50 + tail.y}L${50 + tip.x} ${50 + tip.y}M${50 + tip.x - barb} ${50 + tip.y}h${barb}v${barb}"
        fill="none" stroke="${PAPER}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`

mkdirSync(OUT, { recursive: true })
for (const { file, size, bleed } of ICONS) {
  writeFileSync(join(OUT, file), encodePng(renderIcon(size, bleed), size))
  console.log(`wrote public/${file} (${size}px)`)
}
writeFileSync(join(OUT, 'favicon.svg'), SVG)
console.log('wrote public/favicon.svg')
