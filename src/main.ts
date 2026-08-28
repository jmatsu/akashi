import { Editor } from './editor'
import { buildUI, TOOLS } from './ui'
import { initWasm } from './wasm'
import './style.css'

async function boot(): Promise<void> {
  // Nothing below needs wasm, so let it load while the editor is built.
  const wasmReady = initWasm()

  const stage = must<HTMLElement>('#stage')
  const editor = new Editor({ stage, canvas: must<HTMLCanvasElement>('#canvas') })
  buildUI(editor, { tools: must<HTMLElement>('#tools'), options: must<HTMLElement>('#options') })
  wireHeader(editor)
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
    save: () => void savePng(editor),
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-act]')) {
    const act = actions[button.dataset.act ?? '']
    if (act) button.addEventListener('click', act)
  }

  file.addEventListener('change', () => {
    const chosen = file.files?.[0]
    if (chosen) void loadImage(editor, chosen)
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
  return window.confirm('編集中の内容が破棄されます。よろしいですか?')
}

// --- image in / out ----------------------------------------------------

async function loadImage(editor: Editor, source: Blob): Promise<void> {
  try {
    const bitmap = await createImageBitmap(source)
    editor.setImage(bitmap, bitmap.width, bitmap.height)
    toast(`${bitmap.width} × ${bitmap.height} を読み込みました`)
  } catch {
    toast('画像を読み込めませんでした')
  }
}

function fileName(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `aka-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`
}

/** Save the document as a PNG file. Copy to the clipboard is the other half. */
async function savePng(editor: Editor): Promise<void> {
  const blob = await editor.toBlob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName()
  a.click()
  // Revoking straight after `click()` can cut the download off before the
  // browser has read the blob; one task later is safely past that.
  setTimeout(() => URL.revokeObjectURL(url), 0)
  toast('PNG を保存しました')
}

async function copyPng(editor: Editor): Promise<void> {
  try {
    const blob = await editor.toBlob()
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    toast('クリップボードにコピーしました')
  } catch {
    toast('このブラウザではコピーできません。PNG 保存を使ってください')
  }
}

// --- input -------------------------------------------------------------

function wireInput(editor: Editor): void {
  window.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
    const blob = item?.getAsFile()
    if (!blob) return
    e.preventDefault()
    if (confirmDiscard(editor)) void loadImage(editor, blob)
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
    if (blob?.type.startsWith('image/') && confirmDiscard(editor)) void loadImage(editor, blob)
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
    s: () => void savePng(editor),
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
