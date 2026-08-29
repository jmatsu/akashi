import { PAPER } from '../../brand'
import type { Editor } from './editor'
import { EMOJI } from './emoji'
import { onLocaleChange, t } from '../../i18n'
import type { MessageKey } from '../../i18n'
import { PALETTE, STYLE_FIELDS } from './types'
import type { ArrowStyle, ObjType, RegionMode, Settings, ToolId } from './types'

interface ToolSpec {
  id: ToolId
  label: MessageKey
  key: string
  icon: string
}

/** `key` doubles as the keyboard shortcut and is shown in the tooltip. */
export const TOOLS: readonly ToolSpec[] = [
  { id: 'select', label: 'tool.select', key: 'v', icon: svg('<path d="M5 3l14 8.5-6.2 1.4L9.6 19z"/>') },
  {
    id: 'text',
    label: 'tool.text',
    key: 't',
    icon: svg('<path d="M5 5h14M12 5v14M9 19h6" fill="none" stroke="currentColor" stroke-width="2"/>'),
  },
  {
    id: 'rect',
    label: 'tool.rect',
    key: 'r',
    icon: svg(
      '<rect x="4" y="6" width="16" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="2"/>',
    ),
  },
  {
    id: 'circle',
    label: 'tool.circle',
    key: 'o',
    icon: svg('<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/>'),
  },
  {
    id: 'ellipse',
    label: 'tool.ellipse',
    key: 'e',
    icon: svg('<ellipse cx="12" cy="12" rx="9" ry="6" fill="none" stroke="currentColor" stroke-width="2"/>'),
  },
  {
    id: 'arrow',
    label: 'tool.arrow',
    key: 'a',
    icon: svg('<path d="M5 19L19 5M11 5h8v8" fill="none" stroke="currentColor" stroke-width="2"/>'),
  },
  {
    id: 'marker',
    label: 'tool.marker',
    key: 'm',
    icon: svg(
      '<path d="M4 20l3-1 10-10-2-2L5 17z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 5l2-2 4 4-2 2z"/>',
    ),
  },
  { id: 'emoji', label: 'tool.emoji', key: 's', icon: '<span class="emoji-icon">😀</span>' },
  {
    id: 'region',
    label: 'tool.region',
    key: 'g',
    icon: svg(
      '<rect x="4" y="6" width="16" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"/><path d="M7 9h3v3H7zM14 12h3v3h-3z"/>',
    ),
  },
]

function svg(inner: string): string {
  return `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">${inner}</svg>`
}

/**
 * What the options bar is currently editing: the selected object's type, or the
 * active drawing tool. Rectangles and ellipses share one set of controls, and
 * the circle tool draws an ellipse, so those three collapse to `shape`.
 */
type Context = 'none' | 'text' | 'shape' | 'arrow' | 'marker' | 'emoji' | 'region'

const CONTEXT_ALIAS: Partial<Record<ToolId | ObjType, Context>> = {
  rect: 'shape',
  circle: 'shape',
  ellipse: 'shape',
}

const CONTEXT_TYPE: Record<Exclude<Context, 'none'>, ObjType> = {
  text: 'text',
  shape: 'rect',
  arrow: 'arrow',
  marker: 'marker',
  emoji: 'emoji',
  region: 'region',
}

/**
 * Which control groups a context shows -- derived from `STYLE_FIELDS` so a
 * control can never edit a field nothing applies, and a field can never be
 * left unreachable.
 */
function groupsFor(context: Context): ReadonlySet<keyof Settings> {
  if (context === 'none') return new Set()
  const type = CONTEXT_TYPE[context]
  const keys = new Set<keyof Settings>(STYLE_FIELDS[type].map(([, settingKey]) => settingKey))
  // Region strength is stored per mode, so it is not in the field table.
  if (type === 'region') keys.add('regionStrength')
  return keys
}

const ARROW_STYLES: { id: ArrowStyle; label: MessageKey; icon: string }[] = [
  {
    id: 'line',
    label: 'arrow.line',
    icon: svg('<path d="M3 12h16M13 7l6 5-6 5" fill="none" stroke="currentColor" stroke-width="2"/>'),
  },
  {
    id: 'solid',
    label: 'arrow.solid',
    icon: svg('<path d="M3 12h11" stroke="currentColor" stroke-width="3"/><path d="M21 12l-9-5v10z"/>'),
  },
  {
    id: 'double',
    label: 'arrow.double',
    icon: svg(
      '<path d="M7 12h10" stroke="currentColor" stroke-width="3"/><path d="M22 12l-8-4.5v9zM2 12l8-4.5v9z"/>',
    ),
  },
]

const REGION_MODES: { id: RegionMode; label: MessageKey }[] = [
  { id: 'mosaic', label: 'regionMode.mosaic' },
  { id: 'blackout', label: 'regionMode.blackout' },
  { id: 'transparent', label: 'regionMode.transparent' },
]

interface Range {
  min: number
  max: number
  step: number
  unit: string
  /** Stored value × this = the number on the slider. */
  uiScale: number
}

/** Opacity-style strengths share one range; mosaic is a block size in pixels. */
const PERCENT: Range = { min: 10, max: 100, step: 5, unit: '%', uiScale: 100 }

const REGION_RANGE: Record<RegionMode, Range> = {
  mosaic: { min: 4, max: 60, step: 1, unit: 'px', uiScale: 1 },
  blackout: PERCENT,
  transparent: PERCENT,
}

/** One option in a row where exactly one entry is active. */
interface Choice<T> {
  value: T
  cls: string
  html?: string
  /** Translated label, re-read on every locale change. `html` is the literal
   *  alternative, for swatches and emoji that say the same in any language. */
  htmlKey?: MessageKey
  bg?: string
  title?: string
  titleKey?: MessageKey
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (html !== undefined) node.innerHTML = html
  return node
}

/**
 * Builds the toolbar and the contextual options bar, and keeps them in sync
 * with the editor. Controls are created once and hidden rather than rebuilt,
 * so dragging a slider is never interrupted by a re-render.
 */
export function buildUI(editor: Editor, root: { tools: HTMLElement; options: HTMLElement }): void {
  /** Everything that writes a translated string. Re-run on a locale change. */
  const text: (() => void)[] = []

  const toolButtons = new Map<ToolId, HTMLButtonElement>()
  for (const spec of TOOLS) {
    const b = el('button', 'tool', `${spec.icon}<span class="tool-label"></span>`)
    const label = b.querySelector('.tool-label') as HTMLElement
    b.type = 'button'
    b.addEventListener('click', () => editor.setTool(spec.id))
    toolButtons.set(spec.id, b)
    root.tools.appendChild(b)
    text.push(() => {
      label.textContent = t(spec.label)
      // The shortcut letter is the same in every language, so it is appended
      // here rather than repeated in each catalog.
      b.title = `${t(spec.label)} (${spec.key.toUpperCase()})`
    })
  }

  const groups = new Map<keyof Settings, HTMLElement>()
  const sync: (() => void)[] = []

  const group = (name: keyof Settings, label: MessageKey): HTMLElement => {
    const g = el('div', 'group')
    const caption = el('span', 'group-label')
    g.appendChild(caption)
    const body = el('div', 'group-body')
    g.appendChild(body)
    groups.set(name, g)
    root.options.appendChild(g)
    text.push(() => {
      caption.textContent = t(label)
    })
    return body
  }

  /** A row of buttons of which exactly one carries `.on`. */
  const choice = <T>(
    name: keyof Settings,
    label: MessageKey,
    items: readonly Choice<T>[],
    get: () => T,
    set: (value: T) => void,
    bodyClass?: string,
  ): HTMLElement => {
    const body = group(name, label)
    if (bodyClass) body.classList.add(bodyClass)
    const buttons = items.map((item) => {
      const b = el('button', item.cls, item.html)
      b.type = 'button'
      if (item.bg) b.style.background = item.bg
      if (item.title) b.title = item.title
      const { htmlKey, titleKey } = item
      if (htmlKey || titleKey) {
        text.push(() => {
          if (htmlKey) b.textContent = t(htmlKey)
          if (titleKey) b.title = t(titleKey)
        })
      }
      b.addEventListener('click', () => set(item.value))
      body.appendChild(b)
      return { item, b }
    })
    sync.push(() => {
      const current = get()
      for (const { item, b } of buttons) b.classList.toggle('on', item.value === current)
    })
    return body
  }

  // A swatch is titled with its own hex, which reads the same in any language.
  const swatches = (): Choice<string>[] => PALETTE.map((c) => ({ value: c, cls: 'swatch', bg: c, title: c }))

  // --- colour -----------------------------------------------------------
  {
    const body = choice<string>(
      'color',
      'option.color',
      swatches(),
      () => editor.settings.color,
      (color) => editor.updateSettings({ color }),
    )
    const picker = el('input', 'picker')
    picker.type = 'color'
    picker.addEventListener('input', () => editor.updateSettings({ color: picker.value }))
    body.appendChild(picker)
    text.push(() => {
      picker.title = t('option.colorCustom')
    })
    sync.push(() => {
      picker.value = editor.settings.color
    })
  }

  // --- fill -------------------------------------------------------------
  choice<string | null>(
    'fill',
    'option.fill',
    [{ value: null, cls: 'chip', htmlKey: 'option.fillNone' }, ...swatches()],
    () => editor.settings.fill,
    (fill) => editor.updateSettings({ fill }),
  )

  // --- outline ----------------------------------------------------------
  {
    const body = choice<string | null>(
      'outline',
      'option.outline',
      [{ value: null, cls: 'chip', htmlKey: 'option.outlineNone' }, ...swatches()],
      () => editor.settings.outline,
      (outline) => editor.updateSettings({ outline }),
    )
    const picker = el('input', 'picker')
    picker.type = 'color'
    picker.addEventListener('input', () => editor.updateSettings({ outline: picker.value }))
    body.appendChild(picker)
    text.push(() => {
      picker.title = t('option.outlineCustom')
    })
    sync.push(() => {
      // The picker cannot say "no outline", so it rests on the paper colour --
      // the one most often wanted -- until a swatch or the picker sets one.
      picker.value = editor.settings.outline ?? PAPER
    })
  }

  // --- numeric sliders --------------------------------------------------
  const slider = (
    name: keyof Settings,
    label: MessageKey,
    range: Omit<Range, 'uiScale'>,
    get: () => number,
    set: (v: number) => void,
  ): void => {
    const body = group(name, label)
    const input = el('input', 'range')
    input.type = 'range'
    input.min = String(range.min)
    input.max = String(range.max)
    input.step = String(range.step)
    const readout = el('span', 'readout')
    input.addEventListener('input', () => set(Number(input.value)))
    body.append(input, readout)
    sync.push(() => {
      const v = get()
      input.value = String(v)
      // `px` and `%` are symbols, not words: no catalog entry needed.
      readout.textContent = `${v}${range.unit}`
    })
  }

  const px = { min: 0, max: 40, step: 1, unit: 'px' }
  slider(
    'fontSize',
    'option.fontSize',
    { ...px, min: 10, max: 200 },
    () => editor.settings.fontSize,
    (v) => editor.updateSettings({ fontSize: v }),
  )
  slider(
    'strokeWidth',
    'option.strokeWidth',
    px,
    () => editor.settings.strokeWidth,
    (v) => editor.updateSettings({ strokeWidth: v }),
  )
  slider(
    'arrowWidth',
    'option.arrowWidth',
    { ...px, min: 1 },
    () => editor.settings.arrowWidth,
    (v) => editor.updateSettings({ arrowWidth: v }),
  )
  slider(
    'markerWidth',
    'option.markerWidth',
    { ...px, min: 2, max: 80 },
    () => editor.settings.markerWidth,
    (v) => editor.updateSettings({ markerWidth: v }),
  )
  slider(
    'emojiSize',
    'option.emojiSize',
    { ...px, min: 16, max: 400, step: 2 },
    () => editor.settings.emojiSize,
    (v) => editor.updateSettings({ emojiSize: v }),
  )

  // --- arrow style, stamps, region mode ---------------------------------
  choice<ArrowStyle>(
    'arrowStyle',
    'option.arrowStyle',
    ARROW_STYLES.map((s) => ({ value: s.id, cls: 'chip icon-chip', html: s.icon, titleKey: s.label })),
    () => editor.settings.arrowStyle,
    (arrowStyle) => editor.updateSettings({ arrowStyle }),
  )

  // The stamps are the characters themselves -- nothing to translate.
  choice<string>(
    'emoji',
    'option.emoji',
    EMOJI.map((char) => ({ value: char, cls: 'emoji', html: char })),
    () => editor.settings.emoji,
    (emoji) => editor.updateSettings({ emoji }),
    'emoji-grid',
  )

  choice<RegionMode>(
    'regionMode',
    'option.regionMode',
    REGION_MODES.map((m) => ({ value: m.id, cls: 'chip', htmlKey: m.label })),
    () => editor.settings.regionMode,
    (regionMode) => editor.updateSettings({ regionMode }),
  )

  // --- region strength --------------------------------------------------
  {
    const body = group('regionStrength', 'option.regionStrength')
    const input = el('input', 'range')
    input.type = 'range'
    const readout = el('span', 'readout')
    input.addEventListener('input', () => {
      const mode = editor.settings.regionMode
      editor.updateSettings({
        regionStrength: {
          ...editor.settings.regionStrength,
          [mode]: Number(input.value) / REGION_RANGE[mode].uiScale,
        },
      })
    })
    body.append(input, readout)
    sync.push(() => {
      const mode = editor.settings.regionMode
      const range = REGION_RANGE[mode]
      const ui = Math.round(editor.settings.regionStrength[mode] * range.uiScale)
      input.min = String(range.min)
      input.max = String(range.max)
      input.step = String(range.step)
      input.value = String(ui)
      readout.textContent = `${ui}${range.unit}`
    })
  }

  // --- selection actions ------------------------------------------------
  const selectionActions = el('div', 'group')
  {
    const del = el('button', 'chip danger')
    del.type = 'button'
    del.addEventListener('click', () => editor.deleteSelected())
    selectionActions.appendChild(del)
    root.options.appendChild(selectionActions)
    text.push(() => {
      del.textContent = t('action.delete')
      del.title = `${t('action.delete')} (Delete)`
    })
  }

  const hint = el('div', 'hint')
  root.options.appendChild(hint)
  text.push(() => {
    hint.textContent = t('hint.canvas')
  })

  // Zoom and pan emit too, and the controls cannot change without one of these
  // changing -- so the ~90 DOM writes below are skipped for a mere repaint.
  let lastState = ''

  const refresh = (): void => {
    const context = contextOf(editor)
    const state = `${editor.tool}|${editor.selectedId}|${context}|${JSON.stringify(editor.settings)}`
    if (state === lastState) return
    lastState = state

    for (const [id, b] of toolButtons) b.classList.toggle('on', id === editor.tool)

    const visible = groupsFor(context)
    for (const [name, g] of groups) g.hidden = !visible.has(name)
    selectionActions.hidden = editor.selected() === null
    hint.hidden = context !== 'none'

    for (const fn of sync) fn()
  }

  const retranslate = (): void => {
    for (const fn of text) fn()
  }

  onLocaleChange(retranslate)
  retranslate()
  editor.onChange(refresh)
  refresh()
}

function contextOf(editor: Editor): Context {
  if (editor.tool !== 'select') return CONTEXT_ALIAS[editor.tool] ?? (editor.tool as Context)
  const selected = editor.selected()
  if (!selected) return 'none'
  return CONTEXT_ALIAS[selected.type] ?? (selected.type as Context)
}
