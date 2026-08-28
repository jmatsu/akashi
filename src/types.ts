/** The document model. Everything here is plain JSON so history snapshots and
 *  session persistence are a `structuredClone` / `JSON.stringify` away. */

import { ACCENT, PAPER } from './brand'

export type ToolId =
  | 'select'
  | 'text'
  | 'rect'
  | 'circle'
  | 'ellipse'
  | 'arrow'
  | 'marker'
  | 'emoji'
  | 'region'

/** Three arrow heads, which is as much as an annotation needs. */
export type ArrowStyle = 'line' | 'solid' | 'double'

export type RegionMode = 'mosaic' | 'blackout' | 'transparent'

export interface Pt {
  x: number
  y: number
}

interface ObjBase {
  id: string
}

export interface TextObj extends ObjBase {
  type: 'text'
  x: number
  /** Top edge of the first line, not the baseline. */
  y: number
  text: string
  size: number
  color: string
}

/** Rectangles and ellipses share every field; `lockAspect` is what the circle
 *  tool sets so a circle stays a circle when it is resized. */
export interface ShapeObj extends ObjBase {
  type: 'rect' | 'ellipse'
  x: number
  y: number
  w: number
  h: number
  stroke: string
  strokeWidth: number
  /** `null` means no fill. */
  fill: string | null
  lockAspect: boolean
}

export interface ArrowObj extends ObjBase {
  type: 'arrow'
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  width: number
  style: ArrowStyle
}

export interface MarkerObj extends ObjBase {
  type: 'marker'
  points: Pt[]
  color: string
  width: number
}

export interface EmojiObj extends ObjBase {
  type: 'emoji'
  x: number
  y: number
  size: number
  char: string
}

export interface RegionObj extends ObjBase {
  type: 'region'
  x: number
  y: number
  w: number
  h: number
  mode: RegionMode
  /** Block edge in px for `mosaic`; opacity 0..1 for the other two modes. */
  strength: number
}

export type Obj = TextObj | ShapeObj | ArrowObj | MarkerObj | EmojiObj | RegionObj

export type ObjType = Obj['type']

/** Object types that are edited through an axis-aligned bounding box. */
export type BoxObj = ShapeObj | RegionObj

export interface Doc {
  width: number
  height: number
  /** Paper colour behind everything. `null` renders as transparent. */
  background: string | null
  objects: Obj[]
}

/** A new document with no image: something to draw on straight away. */
export const BLANK_DOC: { width: number; height: number; background: string } = {
  width: 1280,
  height: 720,
  background: PAPER,
}

/** Current tool settings. New objects are created from these, and editing a
 *  selected object writes back through the same fields. */
export interface Settings {
  color: string
  fill: string | null
  strokeWidth: number
  fontSize: number
  markerWidth: number
  arrowStyle: ArrowStyle
  arrowWidth: number
  emoji: string
  emojiSize: number
  regionMode: RegionMode
  /** Remembered per mode, because the units differ between them. */
  regionStrength: Record<RegionMode, number>
}

/** The drawing palette. The accent leads it, and is the default. */
export const PALETTE: readonly string[] = [
  ACCENT,
  '#f59e0b',
  '#facc15',
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
  '#111827',
  PAPER,
]

export const DEFAULT_SETTINGS: Settings = {
  color: ACCENT,
  fill: null,
  strokeWidth: 4,
  fontSize: 32,
  markerWidth: 16,
  arrowStyle: 'solid',
  arrowWidth: 6,
  emoji: '👍',
  emojiSize: 64,
  regionMode: 'mosaic',
  regionStrength: { mosaic: 14, blackout: 1, transparent: 1 },
}

/**
 * Which object field each tool setting drives, per object type.
 *
 * This is the single statement of "what is stylable about a `text`" and so on.
 * Three things read it: writing settings onto a selected object, reading a
 * clicked object's style back into the toolbar, and deciding which controls the
 * options bar shows. Stating it once is what keeps those three in agreement --
 * a control that edits a field nothing applies, or a field with no control, is
 * otherwise a silent failure.
 *
 * Only `region.strength` is left out: it is stored per mode, so it is copied by
 * hand at the two sites that need it.
 */
type StyleField<T extends Obj> = readonly [Exclude<keyof T, 'id' | 'type'>, keyof Settings]

export const STYLE_FIELDS: {
  readonly [K in ObjType]: readonly StyleField<Extract<Obj, { type: K }>>[]
} = {
  text: [
    ['color', 'color'],
    ['size', 'fontSize'],
  ],
  rect: [
    ['stroke', 'color'],
    ['fill', 'fill'],
    ['strokeWidth', 'strokeWidth'],
  ],
  ellipse: [
    ['stroke', 'color'],
    ['fill', 'fill'],
    ['strokeWidth', 'strokeWidth'],
  ],
  arrow: [
    ['color', 'color'],
    ['style', 'arrowStyle'],
    ['width', 'arrowWidth'],
  ],
  marker: [
    ['color', 'color'],
    ['width', 'markerWidth'],
  ],
  emoji: [
    ['char', 'emoji'],
    ['size', 'emojiSize'],
  ],
  region: [['mode', 'regionMode']],
}
