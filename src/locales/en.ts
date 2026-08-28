/**
 * The English catalog, and the shape every other locale is checked against.
 *
 * Only strings that carry a language belong here. The brand name, the emoji
 * palette, colour swatch titles, units (`px`, `%`), the zoom readout and key
 * names such as `Ctrl/Cmd+Z` read the same in every locale, so they stay at
 * their point of use instead of being funnelled through a catalog that would
 * only ever hold one spelling of them.
 *
 * `{name}` placeholders are filled in by `t()`. Values are authored in this
 * repo and never contain user input, which is what makes the few entries
 * carrying markup safe to insert as HTML.
 */
export const en = {
  // --- document head ----------------------------------------------------
  'app.title': 'aka — lightweight annotation tool',
  'app.description':
    'A lightweight tool for annotating, mosaicking and redacting screenshots. No install, works offline.',
  'app.loading': 'Loading…',

  // --- web manifest -----------------------------------------------------
  'manifest.name': 'aka - lightweight annotation tool',
  'manifest.description':
    'Annotate screenshots with text, shapes, arrows, markers, emoji stamps and mosaic/redaction. Works offline.',

  // --- header -----------------------------------------------------------
  'action.open': 'Open image',
  'action.blank': 'Blank',
  'action.undo': 'Undo',
  'action.redo': 'Redo',
  'action.clear': 'Clear all',
  'action.zoomOut': 'Zoom out',
  'action.zoomIn': 'Zoom in',
  'action.fit': 'Fit',
  'action.fitTitle': 'Fit to window',
  'action.copy': 'Copy',
  'action.copyTitle': 'Copy to clipboard',
  'action.save': 'Save',
  'action.saveTitle': 'Save as PNG',
  'action.delete': 'Delete',
  'language.label': 'Language',

  // --- app regions ------------------------------------------------------
  'region.tools': 'Tools',
  'region.options': 'Options',
  'stage.dropHint': 'Drag and drop an image, or paste one with <kbd>Ctrl/Cmd</kbd>+<kbd>V</kbd>',

  // --- tools ------------------------------------------------------------
  'tool.select': 'Select',
  'tool.text': 'Text',
  'tool.rect': 'Rectangle',
  'tool.circle': 'Circle',
  'tool.ellipse': 'Ellipse',
  'tool.arrow': 'Arrow',
  'tool.marker': 'Marker',
  'tool.emoji': 'Stamp',
  'tool.region': 'Redact',

  // --- options bar ------------------------------------------------------
  'option.color': 'Colour',
  'option.colorCustom': 'Custom colour',
  'option.fill': 'Fill',
  'option.fillNone': 'None',
  'option.fontSize': 'Text size',
  'option.strokeWidth': 'Line width',
  'option.arrowWidth': 'Width',
  'option.markerWidth': 'Width',
  'option.emoji': 'Stamp',
  'option.emojiSize': 'Size',
  'option.arrowStyle': 'Style',
  'option.regionMode': 'Effect',
  'option.regionStrength': 'Strength',
  'arrow.line': 'Line',
  'arrow.solid': 'Solid',
  'arrow.double': 'Double',
  'regionMode.mosaic': 'Mosaic',
  'regionMode.blackout': 'Blackout',
  'regionMode.transparent': 'Transparent',
  'hint.canvas': 'Drag the canvas to pan, pinch or Ctrl+wheel to zoom. Click an object to edit it.',

  // --- messages ---------------------------------------------------------
  'confirm.discard': 'The edits in progress will be discarded. Continue?',
  'toast.imageLoaded': 'Loaded {width} × {height}',
  'toast.imageFailed': 'Could not load that image',
  'toast.saved': 'Saved as PNG',
  'toast.copied': 'Copied to the clipboard',
  'toast.copyUnsupported': 'This browser cannot copy images; use Save instead',
}

export type MessageKey = keyof typeof en

/** Every other locale states exactly these keys -- no more, no fewer. */
export type Catalog = Record<MessageKey, string>
