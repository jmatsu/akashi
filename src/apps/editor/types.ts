/** The document model. Everything here is plain JSON so history snapshots and
 *  session persistence are a `structuredClone` / `JSON.stringify` away. */

import { ACCENT, PAPER } from '../../brand'

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

/**
 * A contrasting halo drawn behind an object, or `null` for none: what keeps an
 * annotation readable over a screenshot it happens to share a colour with. Its
 * thickness is derived from the object's own weight, so it needs no control of
 * its own -- see `OUTLINE_SHARE` in `render.ts`.
 */
type Outline = string | null

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
  outline: Outline
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
  outline: Outline
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
  outline: Outline
}

export interface MarkerObj extends ObjBase {
  type: 'marker'
  points: Pt[]
  color: string
  width: number
  outline: Outline
}

export interface EmojiObj extends ObjBase {
  type: 'emoji'
  x: number
  y: number
  size: number
  char: string
  outline: Outline
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

/**
 * The object type behind a tag. `Extract<Obj, { type: K }>` does not work here:
 * `ShapeObj` is tagged `'rect' | 'ellipse'`, and extracting either one asks for
 * a member tagged exactly that. This keeps `ShapeObj` for both of its tags.
 */
export type ObjOf<K extends ObjType, O = Obj> = O extends { type: infer T }
  ? K extends T
    ? O
    : never
  : never

/** Object types that are edited through an axis-aligned bounding box. */
export type BoxObj = ShapeObj | RegionObj

export interface Doc {
  width: number
  height: number
  /** Paper colour behind everything. `null` renders as transparent. */
  background: string | null
  /**
   * What the exports are named. `null` falls back to a timestamp. It travels
   * inside a draft, so it is a name and never a path -- see `cleanName`.
   */
  name: string | null
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
  outline: Outline
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
  outline: null,
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
 * Which object field each tool setting drives, per object type -- the single
 * statement of what is stylable about a `text`, and so on. Three things derive
 * from it: writing settings onto a selected object, reading a clicked object's
 * style back into the toolbar, and which controls the options bar shows. Stated
 * once, none of the three can drift into a control that edits nothing.
 *
 * Only `region.strength` is left out; it is stored per mode.
 */
type StyleField<T extends Obj> = readonly [Exclude<keyof T, 'id' | 'type'>, keyof Settings]

export const STYLE_FIELDS: {
  readonly [K in ObjType]: readonly StyleField<ObjOf<K>>[]
} = {
  text: [
    ['color', 'color'],
    ['size', 'fontSize'],
    ['outline', 'outline'],
  ],
  rect: [
    ['stroke', 'color'],
    ['fill', 'fill'],
    ['strokeWidth', 'strokeWidth'],
    ['outline', 'outline'],
  ],
  ellipse: [
    ['stroke', 'color'],
    ['fill', 'fill'],
    ['strokeWidth', 'strokeWidth'],
    ['outline', 'outline'],
  ],
  arrow: [
    ['color', 'color'],
    ['style', 'arrowStyle'],
    ['width', 'arrowWidth'],
    ['outline', 'outline'],
  ],
  marker: [
    ['color', 'color'],
    ['width', 'markerWidth'],
    ['outline', 'outline'],
  ],
  emoji: [
    ['char', 'emoji'],
    ['size', 'emojiSize'],
    ['outline', 'outline'],
  ],
  region: [['mode', 'regionMode']],
}
