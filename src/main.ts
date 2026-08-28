import { PROBE_BYTES, decodeDraft, encodeDraft, mayCarryDraft } from './draft'
import { Editor } from './editor'
import { LOCALES, initI18n, isLocale, locale, localeName, setLocale, t } from './i18n'
import { buildUI, TOOLS } from './ui'
import { initWasm } from './wasm'
import './style.css'

async function boot(): Promise<void> {
  // Nothing below needs wasm, so let it load while the editor is built.
  const wasmReady = initWasm()

  // Before anything reads a string: this fills in the markup's `data-i18n`
  // keys, so the chrome is never shown in the wrong language.
  initI18n()

  const stage = must<HTMLElement>('#stage')
  const editor = new Editor({ stage, canvas: must<HTMLCanvasElement>('#canvas') })
  buildUI(editor, { tools: must<HTMLElement>('#tools'), options: must<HTMLElement>('#options') })
  wireHeader(editor)
  wireLanguage()
  wireInput(editor)
  wireKeyboard(editor)

  // Redactions are rendered by the wasm core, so the editor is not handed to
  // the user until it is up -- a half-initialised one could show unredacted
  // pixels.
  await wasmReady
  editor.newDoc()
  registerServiceWorker()

  must<HTMLElement>('#loading').remove()
}

function must<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector)
  if (!node) throw new Error(`aka: missing element ${selector}`)
  return node
}

// --- header ------------------------------------------------------------

function wireHeader(editor: Editor): void {
  const file = must<HTMLInputElement>('#file')
  const zoomLabel = must<HTMLElement>('#zoom-label')
  const undo = must<HTMLButtonElement>('[data-act="undo"]')
  const redo = must<HTMLButtonElement>('[data-act="redo"]')
  const stage = must<HTMLElement>('#stage')

  const actions: Record<string, () => void> = {
    open: () => file.click(),
    blank: () => {
      if (confirmDiscard(editor)) editor.newDoc()
    },
    clear: () => editor.clearObjects(),
    undo: () => editor.undo(),
    redo: () => editor.redo(),
    zoomin: () => editor.zoomBy(1.25),
    zoomout: () => editor.zoomBy(1 / 1.25),
    fit: () => editor.zoomToFit(),
    copy: () => void copyPng(editor),
    draft: () => void shareDraft(editor),
    save: () => void savePng(editor),
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-act]')) {
    const act = actions[button.dataset.act ?? '']
    if (act) button.addEventListener('click', act)
  }

  file.addEventListener('change', () => {
    const chosen = file.files?.[0]
    if (chosen) void openFile(editor, chosen)
    // Reset so picking the same file twice still fires `change`.
    file.value = ''
  })

  editor.onChange(() => {
    zoomLabel.textContent = `${Math.round(editor.zoom * 100)}%`
    undo.disabled = !editor.canUndo
    redo.disabled = !editor.canRedo
    // The paste/drop hint retires once there is something to look at.
    stage.classList.toggle('has-content', editor.hasImage() || editor.doc.objects.length > 0)
  })
}

function confirmDiscard(editor: Editor): boolean {
  if (editor.doc.objects.length === 0) return true
  return window.confirm(t('confirm.discard'))
}

// --- language ----------------------------------------------------------

function wireLanguage(): void {
  const select = must<HTMLSelectElement>('#lang')
  for (const l of LOCALES) {
    const option = document.createElement('option')
    option.value = l
    // Each language names itself, so this text is not translated.
    option.textContent = localeName(l)
    select.appendChild(option)
  }
  select.value = locale()
  select.addEventListener('change', () => {
    if (isLocale(select.value)) setLocale(select.value)
  })
}

// --- image in / out ----------------------------------------------------

/**
 * Open whatever the user handed us: a file, a drop, a paste.
 *
 * A draft carries its session inside the PNG (see `draft.ts`), so this is also
 * the door a draft from another device comes in through -- paste and drag-drop
 * included, with no separate import step.
 *
 * The two rungs are tried in order, and a draft that will not open falls to the
 * one below it: the file is still a PNG of the annotated screenshot, which is
 * exactly what `draft.ts` promises when a session cannot be recovered.
 */
async function openFile(editor: Editor, source: Blob): Promise<void> {
  if (await openDraft(editor, source)) return
  try {
    const bitmap = await createImageBitmap(source)
    // The blob is kept so a draft made from this image can carry the original
    // pixels rather than a re-encode of the annotated ones.
    editor.setImage(bitmap, bitmap.width, bitmap.height, source)
    toast(t('toast.imageLoaded', { width: bitmap.width, height: bitmap.height }))
  } catch {
    toast(t('toast.imageFailed'))
  }
}

/** Open `source` as a draft, or report that it is not one we could open. */
async function openDraft(editor: Editor, source: Blob): Promise<boolean> {
  try {
    // Only a file that looks like it carries a session is read whole; an
    // ordinary screenshot goes straight to `createImageBitmap`, which decodes
    // it off-thread without it ever landing in the heap here.
    const head = new Uint8Array(await source.slice(0, PROBE_BYTES).arrayBuffer())
    if (!mayCarryDraft(head)) return false
    const draft = decodeDraft(new Uint8Array(await source.arrayBuffer()))
    if (draft === null) return false

    // A draft whose embedded image will not decode throws here and falls to
    // the plain-image path, which still has the annotated PNG to show.
    const embedded = draft.image
    let image: { bitmap: ImageBitmap; source: Blob } | null = null
    if (embedded !== null) {
      const blob = new Blob([embedded.bytes], { type: embedded.mime })
      image = { bitmap: await createImageBitmap(blob), source: blob }
    }
    editor.restoreDraft(draft.doc, image)
    toast(t('toast.draftLoaded', { count: draft.doc.objects.length }))
    return true
  } catch {
    return false
  }
}

function fileName(prefix: string): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${prefix}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`
}

/** Save a blob to the user's disk under `name`. */
function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // Revoking straight after `click()` can cut the download off before the
  // browser has read the blob; one task later is safely past that.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Save the document as a PNG file. Copy to the clipboard is the other half. */
async function savePng(editor: Editor): Promise<void> {
  download(await editor.toBlob(), fileName('aka'))
  toast(t('toast.saved'))
}

/**
 * Hand the whole editing session to another device, as a PNG that carries it
 * (see `draft.ts`). The share sheet is used where the browser has one, and a
 * plain download is the fallback everywhere else.
 */
async function shareDraft(editor: Editor): Promise<void> {
  const source = editor.sourceImage()
  // The render and the read of the original are independent, and the render is
  // the slow half: waiting for them in series would hide the read behind
  // nothing.
  const [flat, bytes] = await Promise.all([
    editor.toBlob().then((blob) => blob.arrayBuffer()),
    source?.arrayBuffer(),
  ])
  const image =
    source === null || bytes === undefined
      ? null
      : { mime: source.type || 'image/png', bytes: new Uint8Array(bytes) }
  const parts = encodeDraft(new Uint8Array(flat), { doc: editor.doc, image })
  const file = new File(parts, fileName('aka-draft'), { type: 'image/png' })

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name })
      return
    } catch (e) {
      // Dismissing the sheet is a cancel, not a failure. Anything else falls
      // through to the download, so a draft is never left with no way out.
      if (e instanceof DOMException && e.name === 'AbortError') return
    }
  }
  download(file, file.name)
  toast(t('toast.draftSaved'))
}

async function copyPng(editor: Editor): Promise<void> {
  try {
    const blob = await editor.toBlob()
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    toast(t('toast.copied'))
  } catch {
    toast(t('toast.copyUnsupported'))
  }
}

// --- input -------------------------------------------------------------

function wireInput(editor: Editor): void {
  window.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
    const blob = item?.getAsFile()
    if (!blob) return
    e.preventDefault()
    if (confirmDiscard(editor)) void openFile(editor, blob)
  })

  const stage = must<HTMLElement>('#stage')
  stage.addEventListener('dragover', (e) => {
    e.preventDefault()
    stage.classList.add('dropping')
  })
  stage.addEventListener('dragleave', () => stage.classList.remove('dropping'))
  stage.addEventListener('drop', (e) => {
    e.preventDefault()
    stage.classList.remove('dropping')
    const blob = e.dataTransfer?.files?.[0]
    if (blob?.type.startsWith('image/') && confirmDiscard(editor)) void openFile(editor, blob)
  })

  // Double-click reopens the inline editor on an existing text object.
  must<HTMLCanvasElement>('#canvas').addEventListener('dblclick', () => {
    const sel = editor.selected()
    if (sel?.type === 'text') editor.beginTextEditing(sel)
  })

  window.addEventListener('beforeunload', (e) => {
    if (editor.doc.objects.length > 0) e.preventDefault()
  })
}

function wireKeyboard(editor: Editor): void {
  const tools = new Map(TOOLS.map((t) => [t.key, t.id]))

  const withModifier: Record<string, (e: KeyboardEvent) => void> = {
    z: (e) => (e.shiftKey ? editor.redo() : editor.undo()),
    y: () => editor.redo(),
    s: (e) => void (e.shiftKey ? shareDraft(editor) : savePng(editor)),
    '0': () => editor.zoomToFit(),
    '1': () => editor.zoomTo(1),
  }

  window.addEventListener('keydown', (e) => {
    // A focused slider, colour well or the inline text editor owns its own
    // keys. (The textarea also stops propagation, so it never reaches here.)
    if (e.target instanceof HTMLElement && e.target.matches('input, textarea, select')) return

    if (e.metaKey || e.ctrlKey) {
      const action = withModifier[e.key.toLowerCase()]
      if (!action) return
      e.preventDefault()
      action(e)
      return
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      editor.deleteSelected()
      return
    }
    if (e.key === 'Escape') {
      editor.select(null)
      return
    }
    const tool = tools.get(e.key.toLowerCase())
    if (tool) editor.setTool(tool)
  })
}

// --- chrome ------------------------------------------------------------

let toastTimer = 0

function toast(message: string): void {
  const node = must<HTMLElement>('#toast')
  node.textContent = message
  node.classList.add('on')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => node.classList.remove('on'), 2400)
}

function registerServiceWorker(): void {
  // Registered lazily so a failing SW never blocks the editor from starting.
  void import('virtual:pwa-register')
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => {
      /* Offline support is a bonus; the editor works without it. */
    })
}

void boot()
