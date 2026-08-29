/**
 * The English catalog, and the shape every other locale is checked against.
 * Only strings that carry a language belong here: the brand name, emoji, colour
 * codes, units and key names read the same everywhere, so they stay at their
 * point of use.
 *
 * `{name}` placeholders are filled in by `t()`. Values are authored in this
 * repo and never contain user input, so the few carrying markup are safe as HTML.
 */
export const en = {
  // --- document head ----------------------------------------------------
  'app.title': 'Akashi — lightweight screenshot and screen recording tools',
  'app.description':
    'Lightweight tools for annotating screenshots and turning screen recordings into GIFs. No install, works offline.',
  'app.loading': 'Loading…',

  // --- apps -------------------------------------------------------------
  // What the switcher in the corner calls each app.
  'app.editor': 'Annotate',
  'app.gif': 'GIF',

  // --- web manifest -----------------------------------------------------
  'manifest.name': 'Akashi - lightweight screenshot and screen recording tools',
  'manifest.description':
    'Annotate screenshots with text, shapes, arrows, markers, emoji stamps and mosaic/redaction, and turn a screen recording into an animated GIF. Works offline.',

  // --- header -----------------------------------------------------------
  'action.open': 'Open image',
  'action.blank': 'New',
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
  'action.draft': 'Draft',
  'action.draftTitle': 'Hand this session to another device',
  'action.delete': 'Delete',
  'name.label': 'Name for saved files',
  // Shows the shape of what an unnamed document is saved as.
  'name.placeholder': 'akashi-<date>',
  'language.label': 'Language',

  // --- header menus -----------------------------------------------------
  // What the gear opens: the product itself, not any one app.
  'menu.settings': 'Settings',
  'menu.file': 'File',
  'menu.export': 'Export',
  'menu.repo': 'Source code',
  // The date is ISO, so it reads the same in every locale.
  'menu.build': 'Build {sha} · {date}',

  // --- app regions ------------------------------------------------------
  'region.apps': 'Apps',
  'region.tools': 'Tools',
  'region.options': 'Options',
  'region.gifOptions': 'Conversion options',
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
  'option.outline': 'Outline',
  'option.outlineNone': 'None',
  'option.outlineCustom': 'Custom outline colour',
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

  // --- gif converter ----------------------------------------------------
  'gif.open': 'Open video',
  'gif.save': 'Save GIF',
  'gif.saveTitle': 'Save the converted GIF',
  'gif.dropHint':
    'Drag and drop a <kbd>webm</kbd>, <kbd>mov</kbd> or <kbd>mp4</kbd>, or open one from the header',
  'gif.trim': 'Trim',
  'gif.start': 'Start',
  'gif.end': 'End',
  'gif.fps': 'Frame rate',
  'gif.width': 'Width',
  'gif.widthOriginal': 'Original',
  'gif.loop': 'Loop',
  'gif.dither': 'Dither',
  'gif.ditherTitle': 'Mix colours to soften banding, at some cost in size',
  'gif.convert': 'Convert',
  'gif.cancel': 'Stop',
  'gif.resultLabel': 'The converted GIF',
  'gif.summary': '{count} frames · {width} × {height} · {fps} fps · about {size}',
  'gif.sampling': 'Choosing colours…',
  'gif.progress': 'Frame {done} / {total}',
  'gif.result': '{width} × {height} · {count} frames · {size}',

  // --- messages ---------------------------------------------------------
  'confirm.discard': 'The edits in progress will be discarded. Continue?',
  'toast.imageLoaded': 'Loaded {width} × {height}',
  'toast.imageFailed': 'Could not load that image',
  'toast.saved': 'Saved as PNG',
  'toast.copied': 'Copied to the clipboard',
  'toast.copyUnsupported': 'This browser cannot copy images; use Save instead',
  'toast.draftLoaded': 'Draft opened, with {count} annotations',
  'toast.draftSaved': 'Draft saved. Open it on the other device to carry on',
  'toast.videoLoaded': 'Loaded {width} × {height}, {duration}',
  'toast.videoFailed': 'This browser cannot open that video',
  'toast.gifSaved': 'Saved as GIF',
  'toast.gifFailed': 'Could not convert that clip',
}

export type MessageKey = keyof typeof en

/** Every other locale states exactly these keys -- no more, no fewer. */
export type Catalog = Record<MessageKey, string>
