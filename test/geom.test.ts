import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  bounds,
  handlesOf,
  hitTest,
  isDegenerate,
  normalize,
  onRectBorder,
  resize,
  translate,
} from '../src/apps/editor/geom.ts'
import type { Measure } from '../src/apps/editor/geom.ts'
import type { ArrowObj, EmojiObj, MarkerObj, RegionObj, ShapeObj, TextObj } from '../src/apps/editor/types.ts'

/** Ten units per character, so expected widths are obvious by eye. */
const measure: Measure = (lines) => Math.max(0, ...lines.map((l) => l.length * 10))

const rect: ShapeObj = {
  id: 'r',
  type: 'rect',
  x: 10,
  y: 10,
  w: 100,
  h: 50,
  stroke: '#000',
  strokeWidth: 4,
  fill: null,
  lockAspect: false,
}

test('normalize flips a right-to-left drag', () => {
  assert.deepEqual(normalize({ x: 30, y: 40, w: -10, h: -20 }), { x: 20, y: 20, w: 10, h: 20 })
})

test('the border test catches the outline and not the interior', () => {
  const r = { x: 0, y: 0, w: 100, h: 40 }
  assert.equal(onRectBorder({ x: 50, y: 2 }, r, 5), true) // just inside the top edge
  assert.equal(onRectBorder({ x: 50, y: -3 }, r, 5), true) // just outside it
  assert.equal(onRectBorder({ x: 50, y: 20 }, r, 5), false) // the middle
  assert.equal(onRectBorder({ x: 50, y: -20 }, r, 5), false) // well clear
  // A rect thinner than the tolerance is all border, never interior.
  assert.equal(onRectBorder({ x: 50, y: 2 }, { x: 0, y: 0, w: 100, h: 4 }, 5), true)
})

test('an outlined rect is grabbed on its border, not through its middle', () => {
  assert.equal(hitTest(rect, { x: 10, y: 30 }, measure), true)
  assert.equal(hitTest(rect, { x: 60, y: 30 }, measure), false)
})

test('a filled rect is grabbed anywhere inside', () => {
  assert.equal(hitTest({ ...rect, fill: '#f00' }, { x: 60, y: 30 }, measure), true)
})

test('a region is grabbed anywhere inside, filled or not', () => {
  const region: RegionObj = {
    id: 'g',
    type: 'region',
    x: 0,
    y: 0,
    w: 50,
    h: 50,
    mode: 'mosaic',
    strength: 12,
  }
  assert.equal(hitTest(region, { x: 25, y: 25 }, measure), true)
})

test('an ellipse hit follows its curve, not its bounding box', () => {
  const e: ShapeObj = { ...rect, type: 'ellipse', fill: '#f00' }
  assert.equal(hitTest(e, { x: 60, y: 35 }, measure), true)
  assert.equal(hitTest(e, { x: 12, y: 12 }, measure), false)
})

test('an arrow is grabbed near its shaft', () => {
  const a: ArrowObj = {
    id: 'a',
    type: 'arrow',
    x1: 0,
    y1: 0,
    x2: 100,
    y2: 100,
    color: '#000',
    width: 4,
    style: 'solid',
  }
  assert.equal(hitTest(a, { x: 50, y: 52 }, measure), true)
  assert.equal(hitTest(a, { x: 50, y: 90 }, measure), false)
})

test('a marker left by a tap still has bounds and can be selected', () => {
  const m: MarkerObj = { id: 'm', type: 'marker', points: [{ x: 20, y: 20 }], color: '#ff0', width: 10 }
  assert.deepEqual(bounds(m, measure), { x: 15, y: 15, w: 10, h: 10 })
  assert.equal(hitTest(m, { x: 22, y: 22 }, measure), true)
})

test('text bounds use the measured width and the line count', () => {
  const t: TextObj = { id: 't', type: 'text', x: 5, y: 5, text: 'ab\ncdef', size: 20, color: '#000' }
  assert.deepEqual(bounds(t, measure), { x: 5, y: 5, w: 40, h: 50 })
})

test('translate moves every geometry kind, recomputed from the drag start', () => {
  const before: ArrowObj = {
    id: 'a',
    type: 'arrow',
    x1: 0,
    y1: 0,
    x2: 10,
    y2: 10,
    color: '#000',
    width: 2,
    style: 'line',
  }
  const a: ArrowObj = { ...before }
  translate(a, before, 5, -5)
  assert.deepEqual([a.x1, a.y1, a.x2, a.y2], [5, -5, 15, 5])
  // Re-applying a different delta from the same start replaces it, not adds.
  translate(a, before, 1, 1)
  assert.deepEqual([a.x1, a.y1, a.x2, a.y2], [1, 1, 11, 11])

  const mBefore: MarkerObj = { id: 'm', type: 'marker', points: [{ x: 1, y: 1 }], color: '#000', width: 2 }
  const m: MarkerObj = { ...mBefore, points: [{ x: 1, y: 1 }] }
  translate(m, mBefore, 2, 3)
  assert.deepEqual(m.points, [{ x: 3, y: 4 }])
})

test('resizing from a handle pins the opposite corner', () => {
  const o: ShapeObj = { ...rect }
  resize(o, rect, 'nw', { x: 30, y: 20 }, false)
  assert.deepEqual([o.x, o.y, o.w, o.h], [30, 20, 80, 40])
  assert.deepEqual([o.x + o.w, o.y + o.h], [rect.x + rect.w, rect.y + rect.h])
})

test('a circle stays circular when a corner is dragged', () => {
  const start: ShapeObj = { ...rect, type: 'ellipse', w: 60, h: 60, lockAspect: true }
  const o: ShapeObj = { ...start }
  resize(o, start, 'se', { x: 200, y: 90 }, false)
  assert.equal(o.w, o.h)
})

test('drawing a shape is a south-east resize of a zero-size original', () => {
  const start: ShapeObj = { ...rect, x: 40, y: 40, w: 0, h: 0 }
  const o: ShapeObj = { ...start }
  // Dragging up and to the left still produces a positive rect.
  resize(o, start, 'se', { x: 10, y: 20 }, false)
  assert.deepEqual([o.x, o.y, o.w, o.h], [10, 20, 30, 20])
})

test('shift squares off a shape and snaps an arrow to 45 degrees', () => {
  const start: ShapeObj = { ...rect, x: 0, y: 0, w: 0, h: 0 }
  const o: ShapeObj = { ...start }
  resize(o, start, 'se', { x: 100, y: 20 }, true)
  assert.deepEqual([o.w, o.h], [100, 100])

  const aStart: ArrowObj = {
    id: 'a',
    type: 'arrow',
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 0,
    color: '#000',
    width: 2,
    style: 'line',
  }
  const a: ArrowObj = { ...aStart }
  resize(a, aStart, 'p2', { x: 100, y: 10 }, true)
  assert.equal(Math.round(a.y2), 0)
  assert.ok(a.x2 > 99)
})

test('an emoji scales uniformly from its fixed corner', () => {
  const start: EmojiObj = { id: 'e', type: 'emoji', x: 10, y: 10, size: 40, char: '👍' }
  const o: EmojiObj = { ...start }
  resize(o, start, 'se', { x: 110, y: 30 }, false)
  assert.deepEqual([o.x, o.y, o.size], [10, 10, 100])
})

test('a resize never collapses a shape to nothing', () => {
  const o: ShapeObj = { ...rect }
  resize(o, rect, 'se', { x: 10, y: 10 }, false)
  assert.ok(o.w >= 4 && o.h >= 4)
})

test('a click that never became a drag is degenerate', () => {
  assert.equal(isDegenerate({ ...rect, w: 0, h: 0 }), true)
  assert.equal(isDegenerate(rect), false)
  const arrow: ArrowObj = {
    id: 'a',
    type: 'arrow',
    x1: 5,
    y1: 5,
    x2: 5,
    y2: 5,
    color: '#000',
    width: 2,
    style: 'line',
  }
  assert.equal(isDegenerate(arrow), true)
  assert.equal(isDegenerate({ ...arrow, x2: 60 }), false)
  // A tap with the marker leaves a deliberate dot, not a stray object.
  const dot: MarkerObj = { id: 'm', type: 'marker', points: [{ x: 1, y: 1 }], color: '#000', width: 8 }
  assert.equal(isDegenerate(dot), false)
})

test('each type exposes the handles it can actually be dragged by', () => {
  const emoji: EmojiObj = { id: 'e', type: 'emoji', x: 0, y: 0, size: 10, char: '👍' }
  const arrow: ArrowObj = {
    id: 'a',
    type: 'arrow',
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 1,
    color: '#000',
    width: 1,
    style: 'line',
  }
  const text: TextObj = { id: 't', type: 'text', x: 0, y: 0, text: 'x', size: 10, color: '#000' }
  const handles = (o: Parameters<typeof bounds>[0]): number => handlesOf(o, bounds(o, measure)).length
  assert.equal(handles(rect), 8)
  assert.equal(handles(emoji), 4)
  assert.equal(handles(arrow), 2)
  assert.equal(handles(text), 0)
})
