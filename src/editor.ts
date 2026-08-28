import { bounds, hitTest, isDegenerate, onRectBorder, resize, textFont, translate, TEXT_LINE_HEIGHT } from './geom'
import type { Handle, HandleId, Measure } from './geom'
import { drawSelection, HANDLE_SIZE, renderScene, selectionChrome } from './render'
import { BLANK_DOC, DEFAULT_SETTINGS, STYLE_FIELDS } from './types'
import type { Doc, Obj, Pt, Settings, TextObj, ToolId } from './types'

const MIN_SCALE = 0.05
const MAX_SCALE = 8
const HISTORY_LIMIT = 100
/** How long a run of `commit(mergeKey)` calls keeps folding into one step. */
const MERGE_WINDOW_MS = 900
/** How close, in screen pixels, a pointer must come to grab something. */
const GRAB_SLOP = 8
/** Half-extent of a handle's grab box: what is drawn, plus the usual slop. */
const HANDLE_GRAB = HANDLE_SIZE / 2 + GRAB_SLOP

/**
 * A drag in progress.
 *
 * `create`, `move` and `resize` all hold the live object plus a snapshot of how
 * it looked when the drag began, and recompute from that snapshot on every
 * pointer event. Writing the result straight into the live object avoids a deep
 * clone per event while keeping the drag free of accumulated drift.
 */
type Drag =
  | { kind: 'none' }
  | { kind: 'create'; obj: Obj; start: Obj }
  | { kind: 'move'; obj: Obj; origin: Pt; before: Obj }
  | { kind: 'resize'; obj: Obj; handle: HandleId; before: Obj }
  | { kind: 'pan'; origin: Pt; tx: number; ty: number }
  | { kind: 'pinch'; distance: number; center: Pt; scale: number; tx: number; ty: number }

export interface EditorOptions {
  stage: HTMLElement
  canvas: HTMLCanvasElement
}

let nextId = 0
const newId = (): string => `o${++nextId}`

export class Editor {
  doc: Doc = { ...BLANK_DOC, name: null, objects: [] }
  settings: Settings = { ...DEFAULT_SETTINGS, regionStrength: { ...DEFAULT_SETTINGS.regionStrength } }
  tool: ToolId = 'select'
  selectedId: string | null = null

  /** The document rendered 1:1. Region effects and PNG export both read it. */
  private readonly scene = document.createElement('canvas')
  private readonly sceneCtx: CanvasRenderingContext2D
  private readonly viewCtx: CanvasRenderingContext2D
  private image: CanvasImageSource | null = null
  /**
   * The bytes `image` was decoded from, kept so a draft can carry the original
   * screenshot rather than a re-encode of the annotated one. Held only while a
   * document is open, and never sent anywhere on its own.
   */
  private imageSource: Blob | null = null

  /** Text metrics for `geom`, which is otherwise free of the DOM. */
  private readonly measure: Measure = (lines, size) => {
    this.sceneCtx.font = textFont(size)
    let width = 0
    for (const line of lines) width = Math.max(width, this.sceneCtx.measureText(line).width)
    return width
  }

  private scale = 1
  private tx = 0
  private ty = 0

  private drag: Drag = { kind: 'none' }
  private readonly pointers = new Map<number, Pt>()
  private frame = 0
  /** Cleared once the scene canvas matches the document again. */
  private sceneDirty = true
  /** Refreshed per gesture rather than per pointer event: it forces layout. */
  private canvasRect: DOMRect | null = null

  private past: string[] = []
  private present = '[]'
  private future: string[] = []
  private lastMerge: { key: string; at: number } | null = null

  private readonly listeners = new Set<() => void>()
  private readonly checker: CanvasPattern | null

  private readonly textarea = document.createElement('textarea')
  private editingId: string | null = null

  constructor(private readonly opts: EditorOptions) {
    // Region effects call `getImageData` on every frame of a drag.
    this.sceneCtx = this.scene.getContext('2d', { willReadFrequently: true })!
    this.viewCtx = opts.canvas.getContext('2d')!
    this.checker = makeChecker(this.viewCtx)

    this.resizeScene()
    this.setupTextarea()
    this.bindPointer()
    opts.canvas.addEventListener('wheel', this.onWheel, { passive: false })

    new ResizeObserver(() => {
      this.resizeView()
      this.requestViewRender()
    }).observe(opts.stage)
    this.resizeView()
  }

  // --- observation -------------------------------------------------------

  onChange(fn: () => void): void {
    this.listeners.add(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  // --- document ----------------------------------------------------------

  /** Replace the document with a blank canvas. */
  newDoc(width = BLANK_DOC.width, height = BLANK_DOC.height, background: string | null = BLANK_DOC.background): void {
    this.image = null
    this.imageSource = null
    this.doc = { width, height, background, name: null, objects: [] }
    this.afterDocReplaced()
  }

  /**
   * Replace the document with an image, sized to it. `name` is the file it came
   * from, where it came from one -- a pasted or dropped blob has no name to
   * take, and that document stays unnamed.
   */
  setImage(
    image: HTMLImageElement | ImageBitmap,
    width: number,
    height: number,
    source: Blob,
    name: string | null = null,
  ): void {
    this.image = image
    this.imageSource = source
    this.doc = { width, height, background: null, name, objects: [] }
    this.afterDocReplaced()
  }

  /**
   * Rename the document. Kept out of the undo history on purpose: history is
   * the drawing, and an undo reaching back past a rename to restore the old one
   * would be a surprise, not a convenience.
   */
  setName(name: string): void {
    const trimmed = name.trim()
    this.doc.name = trimmed === '' ? null : name
    this.emit()
  }

  /**
   * Reopen a document that was drawn somewhere else -- the far side of a draft
   * handed over between devices. `image` is null for one started from the blank
   * canvas; the bitmap and the bytes it was decoded from travel together,
   * because a document with one and not the other cannot be handed on again.
   *
   * Ids are reissued here. They come from a counter, so two devices that both
   * started at zero would otherwise hand back colliding ids the moment anything
   * new is drawn on top -- and this is also where a draft carrying duplicate
   * ids of its own gets normalised, import being where untrusted data lands.
   */
  restoreDraft(doc: Doc, image: { bitmap: ImageBitmap; source: Blob } | null): void {
    this.image = image?.bitmap ?? null
    this.imageSource = image?.source ?? null
    this.doc = { ...doc, objects: doc.objects.map((o) => ({ ...o, id: newId() })) }
    this.afterDocReplaced()
  }

  hasImage(): boolean {
    return this.image !== null
  }

  /** The bytes the open image was decoded from, for a draft to carry along. */
  sourceImage(): Blob | null {
    return this.imageSource
  }

  private afterDocReplaced(): void {
    this.selectedId = null
    this.past = []
    this.future = []
    this.present = this.snapshot()
    this.resizeScene()
    this.zoomToFit()
    this.requestRender()
    this.emit()
  }

  private resizeScene(): void {
    this.scene.width = this.doc.width
    this.scene.height = this.doc.height
  }

  // --- history -----------------------------------------------------------

  private snapshot(): string {
    return JSON.stringify(this.doc.objects)
  }

  /**
   * Record the current state as an undo step. Call once per finished edit.
   *
   * `mergeKey` folds a burst of related edits into a single step: dragging a
   * size slider fires on every tick, and undo should step over the whole drag
   * rather than replaying it one pixel at a time.
   */
  commit(mergeKey?: string): void {
    const next = this.snapshot()
    if (next === this.present) return
    const now = performance.now()
    const merge =
      mergeKey !== undefined &&
      this.lastMerge !== null &&
      this.lastMerge.key === mergeKey &&
      now - this.lastMerge.at < MERGE_WINDOW_MS &&
      this.past.length > 0
    if (!merge) {
      this.past.push(this.present)
      if (this.past.length > HISTORY_LIMIT) this.past.shift()
    }
    this.present = next
    this.future = []
    this.lastMerge = mergeKey === undefined ? null : { key: mergeKey, at: now }
    this.requestRender()
    this.emit()
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  undo(): void {
    this.lastMerge = null
    const prev = this.past.pop()
    if (prev === undefined) return
    this.future.push(this.present)
    this.restore(prev)
  }

  redo(): void {
    this.lastMerge = null
    const next = this.future.pop()
    if (next === undefined) return
    this.past.push(this.present)
    this.restore(next)
  }

  private restore(state: string): void {
    this.endTextEditing(false)
    this.present = state
    this.doc.objects = JSON.parse(state) as Obj[]
    if (!this.doc.objects.some((o) => o.id === this.selectedId)) this.selectedId = null
    this.requestRender()
    this.emit()
  }

  // --- selection ---------------------------------------------------------

  selected(): Obj | null {
    return this.doc.objects.find((o) => o.id === this.selectedId) ?? null
  }

  select(id: string | null): void {
    if (this.selectedId === id) return
    this.endTextEditing(true)
    this.selectedId = id
    this.requestViewRender()
    this.emit()
  }

  deleteSelected(): void {
    if (!this.selectedId) return
    this.endTextEditing(false)
    this.doc.objects = this.doc.objects.filter((o) => o.id !== this.selectedId)
    this.selectedId = null
    this.commit()
  }

  clearObjects(): void {
    if (this.doc.objects.length === 0) return
    this.endTextEditing(false)
    this.doc.objects = []
    this.selectedId = null
    this.commit()
  }

  setTool(tool: ToolId): void {
    if (this.tool === tool) return
    this.endTextEditing(true)
    this.tool = tool
    // Keeping a selection alive under a drawing tool is confusing: the options
    // bar would show that object's settings while you draw a different one.
    if (tool !== 'select') this.selectedId = null
    this.updateCursor()
    this.requestViewRender()
    this.emit()
  }

  /**
   * Update tool settings, mirroring the change onto the selected object so the
   * options bar edits what you can see.
   */
  updateSettings(patch: Partial<Settings>): void {
    Object.assign(this.settings, patch)
    const o = this.selected()
    if (o) {
      applySettings(o, this.settings)
      // Renders too; the inline text editor is restyled by that render.
      this.commit(`settings:${o.id}`)
    }
    // The settings changed even when the object did not, so the options bar is
    // told either way. A redundant refresh is cheap: it early-outs unchanged.
    this.emit()
  }

  // --- viewport ----------------------------------------------------------

  get zoom(): number {
    return this.scale
  }

  zoomToFit(): void {
    const { clientWidth: w, clientHeight: h } = this.opts.stage
    const pad = 32
    // Guard against a stage that has not been laid out yet: a zero size would
    // otherwise leave the scale NaN and blank the canvas for good.
    const fit = w > pad && h > pad ? Math.min((w - pad) / this.doc.width, (h - pad) / this.doc.height) : 1
    // Never blow a small image up on load; fitting down is what people expect.
    this.scale = clamp(Math.min(fit, 1), MIN_SCALE, MAX_SCALE)
    this.centerDoc()
    this.requestViewRender()
    this.emit()
  }

  zoomTo(scale: number): void {
    const stage = this.opts.stage
    this.zoomAt(scale, { x: stage.clientWidth / 2, y: stage.clientHeight / 2 })
  }

  zoomBy(factor: number): void {
    this.zoomTo(this.scale * factor)
  }

  /** Zoom while keeping the document point under `screen` in place. */
  private zoomAt(scale: number, screen: Pt): void {
    const next = clamp(scale, MIN_SCALE, MAX_SCALE)
    const doc = this.toDoc(screen)
    this.scale = next
    this.tx = screen.x - doc.x * next
    this.ty = screen.y - doc.y * next
    this.requestViewRender()
    this.emit()
  }

  private centerDoc(): void {
    this.tx = (this.opts.stage.clientWidth - this.doc.width * this.scale) / 2
    this.ty = (this.opts.stage.clientHeight - this.doc.height * this.scale) / 2
  }

  private toDoc(p: Pt): Pt {
    return { x: (p.x - this.tx) / this.scale, y: (p.y - this.ty) / this.scale }
  }

  private toScreen = (x: number, y: number): Pt => ({ x: x * this.scale + this.tx, y: y * this.scale + this.ty })

  private eventPoint(e: PointerEvent | WheelEvent): Pt {
    const r = (this.canvasRect ??= this.opts.canvas.getBoundingClientRect())
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  // --- rendering ---------------------------------------------------------

  /** Schedule a repaint that also rebuilds the scene from the document. */
  requestRender(): void {
    this.sceneDirty = true
    this.schedule()
  }

  /**
   * Schedule a repaint for a change the scene canvas does not care about --
   * pan, zoom, selection, a resized viewport. Redrawing the scene for those
   * would re-run every region effect (a `getImageData`/wasm/`putImageData`
   * round trip each) for a pixel-identical result.
   */
  private requestViewRender(): void {
    this.schedule()
  }

  private schedule(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.render()
    })
  }

  private resizeView(): void {
    const dpr = window.devicePixelRatio || 1
    const { clientWidth: w, clientHeight: h } = this.opts.stage
    this.opts.canvas.width = Math.max(1, Math.round(w * dpr))
    this.opts.canvas.height = Math.max(1, Math.round(h * dpr))
    this.opts.canvas.style.width = `${w}px`
    this.opts.canvas.style.height = `${h}px`
    this.canvasRect = null
  }

  private render(): void {
    if (this.sceneDirty) {
      renderScene(this.sceneCtx, this.doc, this.image, this.editingId)
      this.sceneDirty = false
    }

    const ctx = this.viewCtx
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, this.opts.canvas.width / dpr, this.opts.canvas.height / dpr)

    const w = this.doc.width * this.scale
    const h = this.doc.height * this.scale

    // A checkerboard behind the page makes erased regions obviously transparent
    // rather than "white".
    if (this.checker) {
      ctx.save()
      ctx.fillStyle = this.checker
      ctx.fillRect(this.tx, this.ty, w, h)
      ctx.restore()
    }

    // Crisp pixels when zoomed in, smooth ones when scaled down.
    ctx.imageSmoothingEnabled = this.scale < 1
    ctx.drawImage(this.scene, this.tx, this.ty, w, h)

    ctx.save()
    ctx.strokeStyle = 'rgba(0,0,0,.35)'
    ctx.lineWidth = 1
    ctx.strokeRect(this.tx - 0.5, this.ty - 0.5, w + 1, h + 1)
    ctx.restore()

    const sel = this.selected()
    if (sel && this.editingId !== sel.id) drawSelection(ctx, selectionChrome(sel, this.measure, this.toScreen))
    if (this.editingId) this.positionTextarea()
  }

  // --- export ------------------------------------------------------------

  /** Render at 1:1 and hand back a PNG. Selection chrome is never included. */
  async toBlob(): Promise<Blob> {
    renderScene(this.sceneCtx, this.doc, this.image)
    // An open text edit is the only thing that render draws differently, so it
    // is the only case where the scene now needs rebuilding.
    if (this.editingId !== null) this.sceneDirty = true
    return new Promise((resolve, reject) => {
      this.scene.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('aka: PNG encoding failed'))), 'image/png')
    })
  }

  // --- pointer input -----------------------------------------------------

  private bindPointer(): void {
    const canvas = this.opts.canvas
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    // The browser's own pan/zoom would fight ours on touch devices.
    canvas.style.touchAction = 'none'
  }

  private onPointerDown = (e: PointerEvent): void => {
    // Right-click is the browser's; leave it alone entirely.
    if (e.button === 2) return

    // One layout read per gesture, reused by every move event that follows.
    this.canvasRect = this.opts.canvas.getBoundingClientRect()
    const p = this.eventPoint(e)
    this.pointers.set(e.pointerId, p)
    this.opts.canvas.setPointerCapture(e.pointerId)

    if (this.pointers.size === 2) {
      this.abortDrag()
      this.beginPinch()
      return
    }
    if (this.pointers.size > 2) return

    // A click on the canvas is what confirms a modal edit, and is consumed by
    // doing so rather than also starting the next object.
    if (this.confirmPendingEdit()) return
    // Middle-click pans, as it does in every other canvas tool.
    if (e.button === 1) {
      this.drag = { kind: 'pan', origin: p, tx: this.tx, ty: this.ty }
      return
    }
    if (this.tool === 'text') {
      // Suppress the compatibility `mousedown`, whose default action would move
      // focus to the body and blur the editor we are about to open.
      e.preventDefault()
    }

    const doc = this.toDoc(p)
    if (!this.beginChromeDrag(doc, p)) {
      if (this.tool === 'select') this.beginSelectDrag(doc, p)
      else this.beginCreate(doc)
    }
    this.requestRender()
  }

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.eventPoint(e)
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p)

    if (this.drag.kind === 'pinch') {
      this.updatePinch()
      return
    }
    if (this.drag.kind === 'none') {
      this.updateCursor(p)
      return
    }
    if (this.drag.kind === 'pan') {
      this.tx = this.drag.tx + (p.x - this.drag.origin.x)
      this.ty = this.drag.ty + (p.y - this.drag.origin.y)
      this.requestViewRender()
      return
    }

    const doc = this.toDoc(p)
    switch (this.drag.kind) {
      case 'create':
        this.updateCreate(this.drag.obj, this.drag.start, doc, e.shiftKey)
        break
      case 'move':
        translate(this.drag.obj, this.drag.before, doc.x - this.drag.origin.x, doc.y - this.drag.origin.y)
        break
      case 'resize':
        resize(this.drag.obj, this.drag.before, this.drag.handle, doc, e.shiftKey)
        break
    }
    this.requestRender()
  }

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId)
    if (this.opts.canvas.hasPointerCapture(e.pointerId)) this.opts.canvas.releasePointerCapture(e.pointerId)

    if (this.drag.kind === 'pinch') {
      if (this.pointers.size < 2) this.drag = { kind: 'none' }
      else this.beginPinch()
      return
    }
    const drag = this.drag
    this.drag = { kind: 'none' }

    if (drag.kind === 'create') this.finishCreate(drag.obj)
    else if (drag.kind === 'move' || drag.kind === 'resize') this.commit()

    this.updateCursor()
    this.requestViewRender()
  }

  private abortDrag(): void {
    if (this.drag.kind === 'create') {
      this.remove(this.drag.obj)
      this.selectedId = null
    } else if (this.drag.kind === 'move' || this.drag.kind === 'resize') {
      Object.assign(this.drag.obj, this.drag.before)
    }
    this.drag = { kind: 'none' }
    this.requestRender()
  }

  private byId(id: string): Obj | undefined {
    return this.doc.objects.find((o) => o.id === id)
  }

  private remove(o: Obj): void {
    this.doc.objects = this.doc.objects.filter((x) => x.id !== o.id)
  }

  // --- pinch -------------------------------------------------------------

  private beginPinch(): void {
    const [a, b] = [...this.pointers.values()]
    this.drag = {
      kind: 'pinch',
      distance: Math.hypot(b.x - a.x, b.y - a.y),
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      scale: this.scale,
      tx: this.tx,
      ty: this.ty,
    }
  }

  private updatePinch(): void {
    if (this.drag.kind !== 'pinch' || this.pointers.size < 2) return
    const [a, b] = [...this.pointers.values()]
    const distance = Math.hypot(b.x - a.x, b.y - a.y)
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    if (this.drag.distance < 1) return

    const scale = clamp((this.drag.scale * distance) / this.drag.distance, MIN_SCALE, MAX_SCALE)
    // Anchor the document point that was under the original midpoint, then add
    // however far the midpoint itself travelled -- pinch and pan in one gesture.
    const anchor = {
      x: (this.drag.center.x - this.drag.tx) / this.drag.scale,
      y: (this.drag.center.y - this.drag.ty) / this.drag.scale,
    }
    this.scale = scale
    this.tx = center.x - anchor.x * scale
    this.ty = center.y - anchor.y * scale
    this.requestViewRender()
    this.emit()
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      // Pinch-zoom on a trackpad arrives as ctrl+wheel.
      this.canvasRect ??= this.opts.canvas.getBoundingClientRect()
      this.zoomAt(this.scale * Math.exp(-e.deltaY / 200), this.eventPoint(e))
    } else {
      this.tx -= e.deltaX
      this.ty -= e.deltaY
      this.requestViewRender()
    }
  }

  // --- select / move / resize -------------------------------------------

  /**
   * Which piece of the selection's chrome is under a screen point: a handle, or
   * the dashed box (`handle: null`), or nothing.
   *
   * The precedence lives here alone, so pointer handling and the hover cursor
   * cannot disagree about what a click will do. The chrome stays live under
   * every tool, not just the select tool: it is drawn the moment something is
   * selected -- including the object you have just finished drawing -- and a
   * control that is visible but inert is worse than losing the occasional new
   * stroke that happens to start on one. The object's body is deliberately not
   * chrome: it is large and ambiguous, and claiming it would make drawing over
   * an existing shape impossible.
   */
  private chromeAt(screen: Pt): { sel: Obj; handle: Handle | null } | null {
    const sel = this.selected()
    if (!sel) return null
    const chrome = selectionChrome(sel, this.measure, this.toScreen)
    const handle = chrome.handles.find(
      (h) => Math.abs(h.x - screen.x) <= HANDLE_GRAB && Math.abs(h.y - screen.y) <= HANDLE_GRAB,
    )
    if (handle) return { sel, handle }
    // Screen pixels, like the box itself, so the grab strip stays the same
    // width at any zoom.
    return onRectBorder(screen, chrome.box, GRAB_SLOP) ? { sel, handle: null } : null
  }

  /** Start a drag on the selection's chrome: a handle resizes, the box moves. */
  private beginChromeDrag(doc: Pt, screen: Pt): boolean {
    const hit = this.chromeAt(screen)
    if (!hit) return false
    this.drag = hit.handle
      ? { kind: 'resize', obj: hit.sel, handle: hit.handle.id, before: structuredClone(hit.sel) }
      : { kind: 'move', obj: hit.sel, origin: doc, before: structuredClone(hit.sel) }
    return true
  }

  private beginSelectDrag(doc: Pt, screen: Pt): void {
    const hit = this.topmostAt(doc)
    if (hit) {
      syncSettingsFrom(hit, this.settings)
      this.drag = { kind: 'move', obj: hit, origin: doc, before: structuredClone(hit) }
    } else {
      this.drag = { kind: 'pan', origin: screen, tx: this.tx, ty: this.ty }
    }
    this.selectedId = hit?.id ?? null
    this.emit()
  }

  private topmostAt(doc: Pt): Obj | undefined {
    // The grab tolerance is a constant number of screen pixels at any zoom.
    const slop = GRAB_SLOP / this.scale
    for (let i = this.doc.objects.length - 1; i >= 0; i--) {
      if (hitTest(this.doc.objects[i], doc, this.measure, slop)) return this.doc.objects[i]
    }
    return undefined
  }

  private updateCursor(screen?: Pt): void {
    // The chrome advertises itself whatever the tool is, matching what clicking
    // there will actually do.
    const chrome = screen ? this.chromeAt(screen) : null
    if (chrome) this.opts.canvas.style.cursor = chrome.handle?.cursor ?? 'move'
    else if (this.tool !== 'select') this.opts.canvas.style.cursor = this.tool === 'text' ? 'text' : 'crosshair'
    else this.opts.canvas.style.cursor = screen && this.topmostAt(this.toDoc(screen)) ? 'move' : 'default'
  }

  // --- creation ----------------------------------------------------------

  private beginCreate(doc: Pt): void {
    const obj = this.blankObject(doc)
    if (!obj) return

    this.doc.objects.push(obj)
    this.selectedId = obj.id

    if (obj.type === 'text') {
      // Text has no drag phase: place the caret and let the user type.
      this.beginTextEditing(obj)
      this.emit()
    } else if (this.tool === 'emoji') {
      this.commit()
    } else {
      this.drag = { kind: 'create', obj, start: structuredClone(obj) }
    }
  }

  /** The zero-size object the active tool starts from, in current settings. */
  private blankObject(doc: Pt): Obj | null {
    const s = this.settings
    const id = newId()
    switch (this.tool) {
      case 'text':
        return { id, type: 'text', x: doc.x, y: doc.y - s.fontSize / 2, text: '', size: s.fontSize, color: s.color }
      case 'emoji':
        return { id, type: 'emoji', x: doc.x - s.emojiSize / 2, y: doc.y - s.emojiSize / 2, size: s.emojiSize, char: s.emoji }
      case 'marker':
        return { id, type: 'marker', points: [doc], color: s.color, width: s.markerWidth }
      case 'arrow':
        return { id, type: 'arrow', x1: doc.x, y1: doc.y, x2: doc.x, y2: doc.y, color: s.color, width: s.arrowWidth, style: s.arrowStyle }
      case 'region':
        return { id, type: 'region', x: doc.x, y: doc.y, w: 0, h: 0, mode: s.regionMode, strength: s.regionStrength[s.regionMode] }
      case 'rect':
      case 'circle':
      case 'ellipse':
        return {
          id,
          type: this.tool === 'rect' ? 'rect' : 'ellipse',
          x: doc.x,
          y: doc.y,
          w: 0,
          h: 0,
          stroke: s.color,
          strokeWidth: s.strokeWidth,
          fill: s.fill,
          lockAspect: this.tool === 'circle',
        }
      case 'select':
        return null
    }
  }

  /**
   * Drawing a shape is the same operation as dragging its bottom-right handle
   * out of a zero-size original, so it goes through `resize` -- which is also
   * where the shift modifier (square, circle, 45-degree arrows) lives.
   */
  private updateCreate(obj: Obj, start: Obj, doc: Pt, shift: boolean): void {
    if (obj.type === 'marker') {
      const last = obj.points[obj.points.length - 1]
      // Thin out the stream: sub-pixel samples only bloat the document.
      if (Math.hypot(doc.x - last.x, doc.y - last.y) * this.scale >= 2) obj.points.push(doc)
      return
    }
    resize(obj, start, obj.type === 'arrow' ? 'p2' : 'se', doc, shift)
  }

  private finishCreate(obj: Obj): void {
    // A click with no drag leaves a degenerate object; drop it rather than
    // littering the document with invisible items.
    if (isDegenerate(obj)) {
      this.remove(obj)
      this.selectedId = null
      this.requestRender()
      this.emit()
      return
    }
    this.commit()
  }

  // --- text editing ------------------------------------------------------

  private setupTextarea(): void {
    const ta = this.textarea
    ta.className = 'aka-text-input'
    ta.spellcheck = false
    ta.hidden = true
    ta.addEventListener('input', () => {
      const o = this.editingText()
      if (!o) return
      o.text = ta.value
      // The render that follows resizes the overlay to match.
      this.requestRender()
    })
    ta.addEventListener('blur', () => this.endTextEditing(true))
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault()
        this.endTextEditing(true)
      }
      // Editing text must not reach the app-wide shortcuts.
      e.stopPropagation()
    })
    this.opts.stage.appendChild(ta)
  }

  /**
   * Confirm whatever is mid-edit, if anything, and report whether there was
   * something to confirm.
   *
   * Text is the only tool with a modal edit today: every other tool commits the
   * moment its drag ends, so there is nothing left hanging. When one does
   * exist, clicking away from it means "done" -- so the click commits and drops
   * back to the select tool instead of creating another object. After finishing
   * a label you almost always want to move or restyle it, not type a second one.
   *
   * Choosing a tool from the toolbar is left alone: `setTool` confirms the edit
   * too, but an explicit tool choice must win over this default.
   */
  private confirmPendingEdit(): boolean {
    if (this.editingId === null) return false
    this.endTextEditing(true)
    this.setTool('select')
    return true
  }

  private editingText(): TextObj | null {
    if (!this.editingId) return null
    const o = this.byId(this.editingId)
    return o?.type === 'text' ? o : null
  }

  /** Open the inline editor. A real `<textarea>` keeps IME input working. */
  beginTextEditing(o: TextObj): void {
    this.editingId = o.id
    this.selectedId = o.id
    this.textarea.hidden = false
    this.textarea.value = o.text
    this.positionTextarea()
    // Synchronous, and so still inside the user gesture -- which is what makes
    // the on-screen keyboard open on iOS.
    this.textarea.focus()
    this.textarea.setSelectionRange(o.text.length, o.text.length)
    this.requestRender()
  }

  private endTextEditing(keep: boolean): void {
    const o = this.editingText()
    if (!o) return
    this.editingId = null
    this.textarea.hidden = true
    if (!keep || o.text.trim() === '') {
      this.remove(o)
      if (this.selectedId === o.id) this.selectedId = null
    }
    // The scene skipped this object while the overlay stood in for it, so a
    // render is due even when the text came back unchanged and `commit` no-ops.
    this.requestRender()
    this.commit()
  }

  private styleTextarea(o: TextObj): void {
    const ta = this.textarea
    ta.style.font = textFont(o.size * this.scale)
    ta.style.lineHeight = `${o.size * this.scale * TEXT_LINE_HEIGHT}px`
    ta.style.color = o.color
  }

  /** Keep the overlay on top of the text it stands in for. */
  private positionTextarea(): void {
    const o = this.editingText()
    if (!o) return
    const p = this.toScreen(o.x, o.y)
    this.textarea.style.left = `${p.x}px`
    this.textarea.style.top = `${p.y}px`
    this.styleTextarea(o)

    const b = bounds(o, this.measure)
    // Room for the caret past the last glyph.
    this.textarea.style.width = `${(b.w + o.size * 0.6) * this.scale}px`
    this.textarea.style.height = `${b.h * this.scale}px`
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** Write the current tool settings onto an existing object. */
function applySettings(o: Obj, s: Settings): void {
  const target = o as unknown as Record<string, unknown>
  const source = s as unknown as Record<string, unknown>
  for (const [objKey, settingKey] of STYLE_FIELDS[o.type]) target[objKey as string] = source[settingKey]
  // Strength is stored per mode, so it cannot come from the table.
  if (o.type === 'region') o.strength = s.regionStrength[s.regionMode]
}

/** Pull a clicked object's style into the toolbar so edits continue from it. */
function syncSettingsFrom(o: Obj, s: Settings): void {
  const source = o as unknown as Record<string, unknown>
  const target = s as unknown as Record<string, unknown>
  for (const [objKey, settingKey] of STYLE_FIELDS[o.type]) target[settingKey] = source[objKey as string]
  if (o.type === 'region') s.regionStrength[o.mode] = o.strength
}

function makeChecker(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const tile = document.createElement('canvas')
  tile.width = 16
  tile.height = 16
  const c = tile.getContext('2d')
  if (!c) return null
  c.fillStyle = '#ffffff'
  c.fillRect(0, 0, 16, 16)
  c.fillStyle = '#e6e8ec'
  c.fillRect(0, 0, 8, 8)
  c.fillRect(8, 8, 8, 8)
  return ctx.createPattern(tile, 'repeat')
}
