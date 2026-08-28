import type { BoxObj, Obj, Pt } from './types'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Widest of `lines` when set at `size`, in document units.
 *
 * Text is the one shape whose extent only the renderer can know. Passing the
 * measurement in rather than a canvas context keeps this module free of the
 * DOM, and gives the caller one place to set the font.
 */
export type Measure = (lines: readonly string[], size: number) => number

/** The eight box handles, plus the two an arrow uses. */
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'p1' | 'p2'

export interface Handle {
  id: HandleId
  x: number
  y: number
  cursor: string
}

export function isBox(o: Obj): o is BoxObj {
  return o.type === 'rect' || o.type === 'ellipse' || o.type === 'region'
}

/** Flip a rect drawn right-to-left or bottom-to-top into positive extents. */
export function normalize(r: Rect): Rect {
  return {
    x: r.w < 0 ? r.x + r.w : r.x,
    y: r.h < 0 ? r.y + r.h : r.y,
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  }
}

/** Axis-aligned bounds in document space. */
export function bounds(o: Obj, measure: Measure): Rect {
  switch (o.type) {
    case 'rect':
    case 'ellipse':
    case 'region':
      return normalize(o)
    case 'arrow': {
      // Grow by the stroke width so thin arrows stay easy to grab.
      const pad = Math.max(o.width, 8)
      return normalize({
        x: Math.min(o.x1, o.x2) - pad,
        y: Math.min(o.y1, o.y2) - pad,
        w: Math.abs(o.x2 - o.x1) + pad * 2,
        h: Math.abs(o.y2 - o.y1) + pad * 2,
      })
    }
    case 'marker': {
      const pad = o.width / 2
      // One pass, no intermediate arrays: a freehand stroke can hold thousands
      // of points, and this runs on every hover event while it is selected.
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const p of o.points) {
        if (p.x < minX) minX = p.x
        if (p.x > maxX) maxX = p.x
        if (p.y < minY) minY = p.y
        if (p.y > maxY) maxY = p.y
      }
      return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 }
    }
    case 'emoji':
      return { x: o.x, y: o.y, w: o.size, h: o.size }
    case 'text': {
      const lines = o.text.split('\n')
      return {
        x: o.x,
        y: o.y,
        // An empty line still needs a grabbable width.
        w: Math.max(measure(lines, o.size), o.size * 0.5),
        h: lines.length * o.size * TEXT_LINE_HEIGHT,
      }
    }
  }
}

export const TEXT_LINE_HEIGHT = 1.25

export function textFont(size: number): string {
  return `600 ${size}px "Helvetica Neue", Arial, "Hiragino Sans", "Noto Sans JP", sans-serif`
}

export function emojiFont(size: number): string {
  return `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
}

function inRect(p: Pt, r: Rect, slop = 0): boolean {
  return p.x >= r.x - slop && p.x <= r.x + r.w + slop && p.y >= r.y - slop && p.y <= r.y + r.h + slop
}

/**
 * Whether `p` is within `slop` of the outline of `r` rather than somewhere in
 * its interior. Used both for grabbing an unfilled rectangle and for grabbing
 * the selection box drawn around whatever is selected.
 */
export function onRectBorder(p: Pt, r: Rect, slop: number): boolean {
  // A negative slop shrinks the rect, so the inset test needs no second rect:
  // one thinner than the tolerance has an empty interior and is all border.
  return inRect(p, r, slop) && !inRect(p, r, -slop)
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  // A zero-length segment is just a point.
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * Whether a document-space point selects this object. `slop` is the grab
 * tolerance in document units, scaled by the caller so it stays a constant
 * number of screen pixels at any zoom.
 */
export function hitTest(o: Obj, p: Pt, measure: Measure, slop = 6): boolean {
  switch (o.type) {
    case 'region':
      // A redaction is opaque by nature: grab it anywhere.
      return inRect(p, normalize(o), slop)
    case 'rect': {
      const r = normalize(o)
      // A filled shape is grabbable anywhere inside; an outlined one only near
      // its border, so you can still reach what it frames.
      return o.fill ? inRect(p, r, slop) : onRectBorder(p, r, slop)
    }
    case 'ellipse': {
      const r = normalize(o)
      const rx = r.w / 2
      const ry = r.h / 2
      if (rx <= 0 || ry <= 0) return false
      const nx = (p.x - (r.x + rx)) / rx
      const ny = (p.y - (r.y + ry)) / ry
      const d = nx * nx + ny * ny
      const outer = (1 + slop / Math.min(rx, ry)) ** 2
      if (o.fill) return d <= outer
      const inner = Math.max(0, 1 - slop / Math.min(rx, ry)) ** 2
      return d <= outer && d >= inner
    }
    case 'arrow':
      return distToSegment(p, { x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }) <= o.width / 2 + slop
    case 'marker': {
      const reach = o.width / 2 + slop
      for (let i = 1; i < o.points.length; i++) {
        if (distToSegment(p, o.points[i - 1], o.points[i]) <= reach) return true
      }
      // A single tap leaves a one-point stroke, which the loop above skips.
      return o.points.length === 1 && Math.hypot(p.x - o.points[0].x, p.y - o.points[0].y) <= reach
    }
    case 'emoji':
    case 'text':
      return inRect(p, bounds(o, measure), slop)
  }
}

/**
 * Handles for the selected object, in document space. `box` is the object's
 * bounds, passed in because every caller has already computed it -- measuring
 * a text object's width is the most expensive thing on the hover path.
 */
export function handlesOf(o: Obj, box: Rect): Handle[] {
  if (o.type === 'arrow') {
    return [
      { id: 'p1', x: o.x1, y: o.y1, cursor: 'move' },
      { id: 'p2', x: o.x2, y: o.y2, cursor: 'move' },
    ]
  }
  // Text and marker strokes are moved, not resized -- their size lives in the
  // options bar. Checked before building anything.
  if (o.type === 'text' || o.type === 'marker') return []

  const r = box
  const corners: Handle[] = [
    { id: 'nw', x: r.x, y: r.y, cursor: 'nwse-resize' },
    { id: 'ne', x: r.x + r.w, y: r.y, cursor: 'nesw-resize' },
    { id: 'se', x: r.x + r.w, y: r.y + r.h, cursor: 'nwse-resize' },
    { id: 'sw', x: r.x, y: r.y + r.h, cursor: 'nesw-resize' },
  ]
  // Emoji scale uniformly, so they get corners only.
  if (o.type === 'emoji') return corners
  return [
    ...corners,
    { id: 'n', x: r.x + r.w / 2, y: r.y, cursor: 'ns-resize' },
    { id: 'e', x: r.x + r.w, y: r.y + r.h / 2, cursor: 'ew-resize' },
    { id: 's', x: r.x + r.w / 2, y: r.y + r.h, cursor: 'ns-resize' },
    { id: 'w', x: r.x, y: r.y + r.h / 2, cursor: 'ew-resize' },
  ]
}

/**
 * Write `start` moved by (dx, dy) into `target`.
 *
 * Both drag operations here recompute from the state the drag began in rather
 * than accumulating per-event deltas, so a long drag cannot drift. Writing into
 * the live object keeps that property without cloning on every pointer event.
 */
export function translate(target: Obj, start: Obj, dx: number, dy: number): void {
  if (target.type === 'arrow' && start.type === 'arrow') {
    target.x1 = start.x1 + dx
    target.y1 = start.y1 + dy
    target.x2 = start.x2 + dx
    target.y2 = start.y2 + dy
    return
  }
  if (target.type === 'marker' && start.type === 'marker') {
    for (let i = 0; i < start.points.length; i++) {
      target.points[i] = { x: start.points[i].x + dx, y: start.points[i].y + dy }
    }
    return
  }
  if (target.type === 'arrow' || target.type === 'marker' || start.type === 'arrow' || start.type === 'marker') return
  target.x = start.x + dx
  target.y = start.y + dy
}

/** Smallest extent a drag can produce; also the threshold below which a
 *  click that never became a drag is discarded. */
export const MIN_SIZE = 4

/** Snap an angle to the nearest 45 degrees. */
export function snapAngle(angle: number): number {
  return Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)
}

/**
 * Square off a drag's extents, keeping whichever is larger and preserving the
 * direction the pointer went. Shared by drawing a shape and resizing one.
 */
export function square(w: number, h: number): { w: number; h: number } {
  const size = Math.max(Math.abs(w), Math.abs(h))
  return { w: size * (Math.sign(w) || 1), h: size * (Math.sign(h) || 1) }
}

/** Whether this object's proportions are fixed regardless of the shift key. */
export function locksAspect(o: Obj): boolean {
  return (o.type === 'rect' || o.type === 'ellipse') && o.lockAspect
}

/**
 * Drag a handle to `p`, writing the result into `target`. `start` is the object
 * as it was when the drag began; see `translate` for why.
 */
export function resize(target: Obj, start: Obj, handle: HandleId, p: Pt, keepAspect: boolean): void {
  if (target.type === 'arrow' && start.type === 'arrow') {
    const end = keepAspect ? snapFrom(handle === 'p1' ? { x: start.x2, y: start.y2 } : { x: start.x1, y: start.y1 }, p) : p
    if (handle === 'p1') {
      target.x1 = end.x
      target.y1 = end.y
    } else {
      target.x2 = end.x
      target.y2 = end.y
    }
    return
  }
  if (target.type === 'emoji' && start.type === 'emoji') {
    // Emoji are square: drive the size from the distance to the fixed corner.
    const fixedX = handle === 'nw' || handle === 'sw' ? start.x + start.size : start.x
    const fixedY = handle === 'nw' || handle === 'ne' ? start.y + start.size : start.y
    const size = Math.max(MIN_SIZE, Math.max(Math.abs(p.x - fixedX), Math.abs(p.y - fixedY)))
    target.size = size
    target.x = handle === 'nw' || handle === 'sw' ? fixedX - size : fixedX
    target.y = handle === 'nw' || handle === 'ne' ? fixedY - size : fixedY
    return
  }
  if (!isBox(target) || !isBox(start)) return

  let { x, y, w, h } = start
  if (handle.includes('w')) {
    w = start.x + start.w - p.x
    x = p.x
  }
  if (handle.includes('e')) w = p.x - start.x
  if (handle.includes('n')) {
    h = start.y + start.h - p.y
    y = p.y
  }
  if (handle.includes('s')) h = p.y - start.y

  // Corner drags on a locked shape follow the larger of the two extents.
  if ((keepAspect || locksAspect(start)) && handle.length === 2) {
    const s = square(w, h)
    if (handle.includes('w')) x = start.x + start.w - s.w
    if (handle.includes('n')) y = start.y + start.h - s.h
    w = s.w
    h = s.h
  }

  const r = normalize({ x, y, w, h })
  target.x = r.x
  target.y = r.y
  target.w = Math.max(MIN_SIZE, r.w)
  target.h = Math.max(MIN_SIZE, r.h)
}

/**
 * Whether an object is too small to be worth keeping -- a click that never
 * turned into a drag. Measured on the object's own geometry rather than its
 * padded bounds, so a zero-length arrow counts as degenerate too.
 */
export function isDegenerate(o: Obj): boolean {
  switch (o.type) {
    case 'arrow':
      return Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < MIN_SIZE
    case 'marker':
      return o.points.length === 0
    case 'rect':
    case 'ellipse':
    case 'region':
      return o.w <= MIN_SIZE && o.h <= MIN_SIZE
    default:
      return false
  }
}

/** `p`, rotated onto the nearest 45-degree ray from `origin`. */
export function snapFrom(origin: Pt, p: Pt): Pt {
  const angle = snapAngle(Math.atan2(p.y - origin.y, p.x - origin.x))
  const len = Math.hypot(p.x - origin.x, p.y - origin.y)
  return { x: origin.x + Math.cos(angle) * len, y: origin.y + Math.sin(angle) * len }
}
