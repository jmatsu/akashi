import { bounds, emojiFont, handlesOf, normalize, TEXT_LINE_HEIGHT, textFont } from './geom'
import type { Handle, Measure, Rect } from './geom'
import type { Doc, ArrowObj, MarkerObj, Obj, Pt, RegionObj, ShapeObj, TextObj, EmojiObj } from './types'
import { applyRegion } from './wasm'

/** Highlighter strokes are translucent so the pixels under them stay readable. */
const MARKER_ALPHA = 0.45

/**
 * Draw the whole document into `ctx` at 1:1 document scale, with no transform
 * applied. The editor keeps a scene canvas exactly this size; the visible
 * canvas then blits it under the pan/zoom transform, and PNG export reads it
 * directly. Region effects need `getImageData`, which ignores transforms, so
 * this separation is what makes them work at any zoom.
 *
 * `skipId` omits one object: while a text object is being typed into, the live
 * `<textarea>` overlay stands in for it, and drawing both would double it up.
 */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  doc: Doc,
  image: CanvasImageSource | null,
  skipId: string | null = null,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, doc.width, doc.height)
  if (doc.background) {
    ctx.fillStyle = doc.background
    ctx.fillRect(0, 0, doc.width, doc.height)
  }
  if (image) ctx.drawImage(image, 0, 0, doc.width, doc.height)
  for (const o of doc.objects) {
    if (o.id !== skipId) drawObject(ctx, o, doc)
  }
}

function drawObject(ctx: CanvasRenderingContext2D, o: Obj, doc: Doc): void {
  ctx.save()
  switch (o.type) {
    case 'rect':
    case 'ellipse':
      drawShape(ctx, o)
      break
    case 'arrow':
      drawArrow(ctx, o)
      break
    case 'marker':
      drawMarker(ctx, o)
      break
    case 'text':
      drawText(ctx, o)
      break
    case 'emoji':
      drawEmoji(ctx, o)
      break
    case 'region':
      drawRegion(ctx, o, doc)
      break
  }
  ctx.restore()
}

function drawShape(ctx: CanvasRenderingContext2D, o: ShapeObj): void {
  const r = normalize(o)
  ctx.beginPath()
  if (o.type === 'rect') {
    ctx.rect(r.x, r.y, r.w, r.h)
  } else {
    ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2)
  }
  if (o.fill) {
    ctx.fillStyle = o.fill
    ctx.fill()
  }
  if (o.strokeWidth > 0) {
    ctx.strokeStyle = o.stroke
    ctx.lineWidth = o.strokeWidth
    ctx.stroke()
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, o: ArrowObj): void {
  const dx = o.x2 - o.x1
  const dy = o.y2 - o.y1
  const len = Math.hypot(dx, dy)
  if (len < 0.5) return
  const angle = Math.atan2(dy, dx)
  const head = Math.max(o.width * 3, 12)

  ctx.strokeStyle = o.color
  ctx.fillStyle = o.color
  ctx.lineWidth = o.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // A filled head would show the shaft poking through its tip, so the shaft
  // stops where the head begins -- at both ends for a double-headed arrow.
  const backOff = o.style === 'line' ? 0 : head * 0.85
  const tailInset = o.style === 'double' ? Math.min(backOff, len / 2) : 0
  const tipInset = Math.min(backOff, len / 2)
  ctx.beginPath()
  ctx.moveTo(o.x1 + Math.cos(angle) * tailInset, o.y1 + Math.sin(angle) * tailInset)
  ctx.lineTo(o.x2 - Math.cos(angle) * tipInset, o.y2 - Math.sin(angle) * tipInset)
  ctx.stroke()

  if (o.style === 'line') {
    drawOpenHead(ctx, o.x2, o.y2, angle, head)
  } else {
    drawSolidHead(ctx, o.x2, o.y2, angle, head)
    if (o.style === 'double') drawSolidHead(ctx, o.x1, o.y1, angle + Math.PI, head)
  }
}

const HEAD_SPREAD = Math.PI / 7

function drawOpenHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  head: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x - Math.cos(angle - HEAD_SPREAD) * head, y - Math.sin(angle - HEAD_SPREAD) * head)
  ctx.lineTo(x, y)
  ctx.lineTo(x - Math.cos(angle + HEAD_SPREAD) * head, y - Math.sin(angle + HEAD_SPREAD) * head)
  ctx.stroke()
}

function drawSolidHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  head: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x - Math.cos(angle - HEAD_SPREAD) * head, y - Math.sin(angle - HEAD_SPREAD) * head)
  ctx.lineTo(x - Math.cos(angle) * head * 0.72, y - Math.sin(angle) * head * 0.72)
  ctx.lineTo(x - Math.cos(angle + HEAD_SPREAD) * head, y - Math.sin(angle + HEAD_SPREAD) * head)
  ctx.closePath()
  ctx.fill()
}

function drawMarker(ctx: CanvasRenderingContext2D, o: MarkerObj): void {
  if (o.points.length === 0) return
  ctx.globalAlpha = MARKER_ALPHA
  ctx.strokeStyle = o.color
  ctx.lineWidth = o.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(o.points[0].x, o.points[0].y)
  if (o.points.length === 1) {
    // A tap with no drag still leaves a dot.
    ctx.lineTo(o.points[0].x, o.points[0].y)
  } else {
    for (let i = 1; i < o.points.length; i++) ctx.lineTo(o.points[i].x, o.points[i].y)
  }
  ctx.stroke()
}

function drawText(ctx: CanvasRenderingContext2D, o: TextObj): void {
  ctx.font = textFont(o.size)
  ctx.textBaseline = 'top'
  ctx.fillStyle = o.color
  const lineHeight = o.size * TEXT_LINE_HEIGHT
  o.text.split('\n').forEach((line, i) => {
    ctx.fillText(line, o.x, o.y + i * lineHeight)
  })
}

function drawEmoji(ctx: CanvasRenderingContext2D, o: EmojiObj): void {
  ctx.font = emojiFont(o.size)
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText(o.char, o.x, o.y)
}

function drawRegion(ctx: CanvasRenderingContext2D, o: RegionObj, doc: Doc): void {
  const r = normalize(o)
  // Clamp to the document: `getImageData` outside it returns transparent
  // pixels, and writing those back would punch holes in the page. Clamping to
  // the document rather than to `ctx.canvas` keeps this correct if the scene is
  // ever rendered into a larger canvas.
  const x = Math.max(0, Math.floor(r.x))
  const y = Math.max(0, Math.floor(r.y))
  const w = Math.min(doc.width, Math.ceil(r.x + r.w)) - x
  const h = Math.min(doc.height, Math.ceil(r.y + r.h)) - y
  if (w <= 0 || h <= 0) return
  const img = ctx.getImageData(x, y, w, h)
  applyRegion(img, o.mode, o.strength)
  ctx.putImageData(img, x, y)
}

/** Handle size in CSS pixels; the chrome is drawn in screen space so this is
 *  constant regardless of zoom. */
export const HANDLE_SIZE = 9

/**
 * The selection's chrome, projected into screen pixels: the dashed box and the
 * handles sitting on it.
 *
 * The chrome is not only drawn but also grabbed -- a handle resizes, the box
 * moves -- so what it consists of is derived here once and used by both. Two
 * independent derivations would let the drawn outline and the grabbable strip
 * drift apart, and nothing would fail when they did.
 */
export interface SelectionChrome {
  box: Rect
  handles: Handle[]
}

export function selectionChrome(
  o: Obj,
  measure: Measure,
  toScreen: (x: number, y: number) => Pt,
): SelectionChrome {
  const b = bounds(o, measure)
  const tl = toScreen(b.x, b.y)
  const br = toScreen(b.x + b.w, b.y + b.h)
  return {
    box: { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y },
    handles: handlesOf(o, b).map((handle) => ({ ...handle, ...toScreen(handle.x, handle.y) })),
  }
}

/**
 * Draw the chrome onto the visible canvas. Deliberately not part of
 * `renderScene`, so it never lands in an export.
 */
export function drawSelection(view: CanvasRenderingContext2D, chrome: SelectionChrome): void {
  view.save()
  view.strokeStyle = '#3b82f6'
  view.lineWidth = 1.5
  view.setLineDash([5, 4])
  view.strokeRect(chrome.box.x, chrome.box.y, chrome.box.w, chrome.box.h)
  view.setLineDash([])

  for (const handle of chrome.handles) {
    view.beginPath()
    view.rect(handle.x - HANDLE_SIZE / 2, handle.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE)
    view.fillStyle = '#ffffff'
    view.fill()
    view.strokeStyle = '#3b82f6'
    view.stroke()
  }
  view.restore()
}
