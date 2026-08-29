// Generates the PWA icon set from geometry -- no image libraries, no binary
// blobs to review. Run after changing the mark; the shared colours and the
// icon list come from src/brand.ts.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCENT, ICONS, PAPER } from '../src/brand.ts'
import { PNG_SIGNATURE, chunk } from '../src/png.ts'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

// Tints that exist only inside the mark, so they stay out of the brand module.
const PHOTO = '#f7dad4'
const RIDGE = '#e68477'
const AMBER = '#fbb433'
const WOOD = '#fae1b8'
const GRAPHITE = '#45546a'
const MUTED = '#8992a3'

/**
 * The mark in a 100-unit *plate* space -- the plate is the space, so the same
 * numbers serve the bleeding icons, where the plate fills the square. A framed
 * photo of a sunlit ridge, a pencil drawing a lasso over it, and a comment
 * bubble. The `favicon.svg` below draws the same shape from these values.
 */
const MARK = {
  plate: { margin: 6, radius: 22 },
  card: { x: 15.5, y: 18.6, w: 69, h: 66.3, radius: 7.5, border: 6, photoRadius: 3 },
  sun: { x: 31.8, y: 35.7, r: 5.3 },
  /** Apex, then the run each slope covers per unit of fall to the photo floor. */
  ridges: [
    { apex: [38.2, 46.8], slopes: [1.05, 0.85], fill: RIDGE },
    { apex: [63.2, 37.3], slopes: [0.9, 0.7], fill: ACCENT },
  ],
  /** An ellipse left open between `to` and `from`, where the pencil crosses it. */
  lasso: { x: 47.7, y: 70.4, rx: 10.2, ry: 6.6, stroke: 2.2, from: 13, to: 298 },
  bubble: {
    x: 9.5,
    y: 61.5,
    w: 24,
    h: 15.9,
    radius: 4,
    tail: [
      [24.5, 73],
      [30.2, 73],
      [29.8, 81],
    ],
    lines: [
      [14.4, 66.9, 28.4],
      [14.6, 71.8, 23.6],
    ],
    lineStroke: 2.4,
  },
  pencil: {
    axis: [
      [58.1, 72],
      [91.6, 32.6],
    ],
    halfWidth: 6,
    capRadius: 2.5,
    /** Fractions along the axis: the graphite point, the wood cone, the band. */
    graphite: 0.11,
    wood: 0.23,
    band: [0.79, 0.85],
  },
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

const clamp01 = (v) => Math.min(1, Math.max(0, v))

/** Antialiased coverage from a signed distance, in pixels. */
const cover = (d) => clamp01(0.5 - d)

// --- signed distance fields, in plate units ------------------------------

function sdRoundRect(px, py, x, y, w, h, r) {
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r)
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

const sdCircle = (px, py, x, y, r) => Math.hypot(px - x, py - y) - r

function sdSegment(px, py, ax, ay, bx, by, halfWidth) {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  const t = lenSq === 0 ? 0 : clamp01(((px - ax) * dx + (py - ay) * dy) / lenSq)
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) - halfWidth
}

/** Nearest edge, signed by an even-odd crossing count. */
function sdPolygon(px, py, pts) {
  let d = Infinity
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[i]
    const [bx, by] = pts[j]
    d = Math.min(d, sdSegment(px, py, ax, ay, bx, by, 0))
    if (ay > py !== by > py && px < ax + ((py - ay) / (by - ay)) * (bx - ax)) inside = !inside
  }
  return inside ? -d : d
}

const sdPolyline = (px, py, pts, halfWidth) => {
  let d = Infinity
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]
    const [bx, by] = pts[i]
    d = Math.min(d, sdSegment(px, py, ax, ay, bx, by, halfWidth))
  }
  return d
}

/** A slab across the axis, used to cut the pencil into its coloured sections. */
const sdSlab = (s, lo, hi) => Math.max(lo - s, s - hi)

// --- the mark, as layers painted back to front ---------------------------

const rad = (deg) => (deg * Math.PI) / 180

function ellipsePoints({ x, y, rx, ry, from, to }, steps = 72) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = rad(from + ((to - from) * i) / steps)
    return [x + rx * Math.cos(a), y + ry * Math.sin(a)]
  })
}

const photoRect = () => {
  const { x, y, w, h, border } = MARK.card
  return { x: x + border, y: y + border, w: w - 2 * border, h: h - 2 * border }
}

/** Apex plus a base cut below the photo floor, so the clip makes the edge. */
function ridgePoints({ apex, slopes }) {
  const base = photoRect().y + photoRect().h + 2
  const fall = base - apex[1]
  return [apex, [apex[0] + slopes[1] * fall, base], [apex[0] - slopes[0] * fall, base]]
}

/** Along-axis and across-axis coordinates, plus the stops the sections use. */
function pencilFrame() {
  const [[ax, ay], [bx, by]] = MARK.pencil.axis
  const length = Math.hypot(bx - ax, by - ay)
  const ux = (bx - ax) / length
  const uy = (by - ay) / length
  return {
    length,
    angle: (Math.atan2(uy, ux) * 180) / Math.PI,
    origin: [ax, ay],
    local: (px, py) => {
      const dx = px - ax
      const dy = py - ay
      return [dx * ux + dy * uy, dy * ux - dx * uy]
    },
    wood: MARK.pencil.wood * length,
    graphite: MARK.pencil.graphite * length,
    band: MARK.pencil.band.map((f) => f * length),
  }
}

/** The barrel: square where the cone meets it, rounded at the eraser end. */
const pencilBody = (s, t, f) => {
  const { halfWidth: hw, capRadius: r } = MARK.pencil
  const w = f.length - f.wood
  return Math.min(
    sdRoundRect(s, t, f.wood, -hw, w, 2 * hw, r),
    sdRoundRect(s, t, f.wood, -hw, w - r, 2 * hw, 0),
  )
}

/** A cone from the point out to `end` along the axis, at the barrel's taper. */
const pencilCone = (s, t, f, end) => {
  const half = (MARK.pencil.halfWidth * end) / f.wood
  return sdPolygon(s, t, [
    [0, 0],
    [end, -half],
    [end, half],
  ])
}

function buildLayers() {
  const { card, sun, ridges, lasso, bubble } = MARK
  const photo = photoRect()
  const inPhoto = (px, py) => sdRoundRect(px, py, photo.x, photo.y, photo.w, photo.h, card.photoRadius)

  const layers = [
    { fill: PAPER, sd: (px, py) => sdRoundRect(px, py, card.x, card.y, card.w, card.h, card.radius) },
    { fill: PHOTO, sd: inPhoto },
    { fill: AMBER, sd: (px, py) => sdCircle(px, py, sun.x, sun.y, sun.r), clip: inPhoto },
    ...ridges.map((ridge) => {
      const pts = ridgePoints(ridge)
      return { fill: ridge.fill, sd: (px, py) => sdPolygon(px, py, pts), clip: inPhoto }
    }),
  ]

  const loop = ellipsePoints(lasso)
  layers.push({ fill: AMBER, sd: (px, py) => sdPolyline(px, py, loop, lasso.stroke / 2) })

  layers.push(
    { fill: PAPER, sd: (px, py) => sdPolygon(px, py, bubble.tail) },
    {
      fill: PAPER,
      sd: (px, py) => sdRoundRect(px, py, bubble.x, bubble.y, bubble.w, bubble.h, bubble.radius),
    },
    ...bubble.lines.map(([x0, y, x1]) => ({
      fill: MUTED,
      sd: (px, py) => sdSegment(px, py, x0, y, x1, y, bubble.lineStroke / 2),
    })),
  )

  const f = pencilFrame()
  const barrel = (px, py) => {
    const [s, t] = f.local(px, py)
    return Math.min(pencilBody(s, t, f), pencilCone(s, t, f, f.wood))
  }
  layers.push(
    { fill: AMBER, sd: barrel },
    { fill: PAPER, sd: (px, py) => sdSlab(f.local(px, py)[0], f.band[0], f.band[1]), clip: barrel },
    { fill: GRAPHITE, sd: (px, py) => sdSlab(f.local(px, py)[0], f.band[1], f.length), clip: barrel },
    {
      fill: WOOD,
      sd: (px, py) => {
        const [s, t] = f.local(px, py)
        return pencilCone(s, t, f, f.wood)
      },
    },
    {
      fill: GRAPHITE,
      sd: (px, py) => {
        const [s, t] = f.local(px, py)
        return pencilCone(s, t, f, f.graphite)
      },
    },
  )

  return layers.map(({ fill, sd, clip }) => ({ colour: rgb(fill), sd, clip }))
}

const LAYERS = buildLayers()

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
  const out = new Uint8Array(size * size * 4)
  const inset = bleed ? 0 : MARK.plate.margin
  const radius = bleed ? 0 : MARK.plate.radius
  // Pixels per plate unit, and where the plate starts in the icon square.
  const k = (size * (100 - 2 * inset)) / 10000
  const origin = (size * inset) / 100
  const accent = rgb(ACCENT)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const u = (x + 0.5 - origin) / k
      const v = (y + 0.5 - origin) / k

      const plate = cover(sdRoundRect(u, v, 0, 0, 100, 100, radius) * k)
      if (plate <= 0) continue
      over(out, i, accent, plate)

      for (const { colour, sd, clip } of LAYERS) {
        const a = cover(sd(u, v) * k)
        if (a <= 0) continue
        over(out, i, colour, a * plate * (clip ? cover(clip(u, v) * k) : 1))
      }
    }
  }
  return out
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

// --- the same mark, as SVG ----------------------------------------------

const n = (v) => Number(v.toFixed(2))
const pts = (list) => list.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')

/** A bar with a square left end and a rounded right one, in pencil-local space. */
function barPath(from, to, halfWidth, radius) {
  const [a, b, hw, r] = [n(from), n(to), n(halfWidth), n(radius)]
  return `M${a} ${-hw}H${n(to - radius)}A${r} ${r} 0 0 1 ${b} ${n(-halfWidth + radius)}V${n(halfWidth - radius)}A${r} ${r} 0 0 1 ${n(to - radius)} ${hw}H${a}Z`
}

function buildSvg() {
  const { plate, card, sun, ridges, lasso, bubble, pencil } = MARK
  const photo = photoRect()
  const f = pencilFrame()
  const hw = pencil.halfWidth
  const arc = ({ x, y, rx, ry, from, to }) => {
    const at = (deg) => `${n(x + rx * Math.cos(rad(deg)))} ${n(y + ry * Math.sin(rad(deg)))}`
    return `M${at(from)}A${n(rx)} ${n(ry)} 0 ${to - from > 180 ? 1 : 0} 1 ${at(to)}`
  }
  const coneHalf = (end) => (hw * end) / f.wood

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <clipPath id="photo">
    <rect x="${n(photo.x)}" y="${n(photo.y)}" width="${n(photo.w)}" height="${n(photo.h)}" rx="${card.photoRadius}"/>
  </clipPath>
  <rect width="100" height="100" rx="${plate.radius}" fill="${ACCENT}"/>
  <rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" rx="${card.radius}" fill="${PAPER}"/>
  <rect x="${n(photo.x)}" y="${n(photo.y)}" width="${n(photo.w)}" height="${n(photo.h)}" rx="${card.photoRadius}" fill="${PHOTO}"/>
  <g clip-path="url(#photo)">
    <circle cx="${sun.x}" cy="${sun.y}" r="${sun.r}" fill="${AMBER}"/>
${ridges.map((r) => `    <polygon points="${pts(ridgePoints(r))}" fill="${r.fill}"/>`).join('\n')}
  </g>
  <path d="${arc(lasso)}" fill="none" stroke="${AMBER}" stroke-width="${lasso.stroke}" stroke-linecap="round"/>
  <polygon points="${pts(bubble.tail)}" fill="${PAPER}"/>
  <rect x="${bubble.x}" y="${bubble.y}" width="${bubble.w}" height="${bubble.h}" rx="${bubble.radius}" fill="${PAPER}"/>
  <path d="${bubble.lines.map(([x0, y, x1]) => `M${x0} ${y}H${x1}`).join('')}"
        fill="none" stroke="${MUTED}" stroke-width="${bubble.lineStroke}" stroke-linecap="round"/>
  <g transform="translate(${f.origin[0]} ${f.origin[1]}) rotate(${n(f.angle)})">
    <path d="${barPath(f.wood, f.length, hw, pencil.capRadius)}" fill="${AMBER}"/>
    <rect x="${n(f.band[0])}" y="${-hw}" width="${n(f.band[1] - f.band[0])}" height="${2 * hw}" fill="${PAPER}"/>
    <path d="${barPath(f.band[1], f.length, hw, pencil.capRadius)}" fill="${GRAPHITE}"/>
    <polygon points="0,0 ${n(f.wood)},${-hw} ${n(f.wood)},${hw}" fill="${WOOD}"/>
    <polygon points="0,0 ${n(f.graphite)},${n(-coneHalf(f.graphite))} ${n(f.graphite)},${n(coneHalf(f.graphite))}" fill="${GRAPHITE}"/>
  </g>
</svg>
`
}

mkdirSync(OUT, { recursive: true })
for (const { file, size, bleed } of ICONS) {
  writeFileSync(join(OUT, file), encodePng(renderIcon(size, bleed), size))
  console.log(`wrote public/${file} (${size}px)`)
}
writeFileSync(join(OUT, 'favicon.svg'), buildSvg())
console.log('wrote public/favicon.svg')
