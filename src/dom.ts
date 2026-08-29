/**
 * The DOM chores both apps have: finding the elements the markup promises,
 * saying something briefly, taking a file in and handing one back.
 *
 * The file-intake helpers are here rather than in each app because the
 * awkward parts -- resetting the picker so the same file opens twice, letting
 * a paste reach only the app on screen -- are the same wherever a file comes
 * in, and are the parts easiest to leave out.
 */

export function must<T extends Element>(selector: string, root: ParentNode = document): T {
  const node = root.querySelector<T>(selector)
  if (!node) throw new Error(`aka: missing element ${selector}`)
  return node
}

/** Wire every `[<attr>]` button to the action its value names. */
export function wireActions(attr: string, actions: Record<string, () => void>): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(`[${attr}]`)) {
    const act = actions[button.getAttribute(attr) ?? '']
    if (act) button.addEventListener('click', act)
  }
}

/** The file chosen from a picker, and the same file again if it is chosen twice. */
export function onFilePicked(input: HTMLInputElement, open: (file: File) => void): void {
  input.addEventListener('change', () => {
    const chosen = input.files?.[0]
    if (chosen) open(chosen)
    // Reset so picking the same file twice still fires `change`.
    input.value = ''
  })
}

/** Files dropped on `zone`, which is outlined while one is over it. */
export function onFileDropped(zone: HTMLElement, type: string, open: (file: File) => void): void {
  zone.addEventListener('dragover', (e) => {
    e.preventDefault()
    zone.classList.add('dropping')
  })
  zone.addEventListener('dragleave', () => zone.classList.remove('dropping'))
  zone.addEventListener('drop', (e) => {
    e.preventDefault()
    zone.classList.remove('dropping')
    const file = e.dataTransfer?.files?.[0]
    if (file?.type.startsWith(type)) open(file)
  })
}

/**
 * Files pasted anywhere in the window. The paste is offered only while
 * `active` says this app is the one on screen -- the listener is on the
 * window, which both apps share.
 */
export function onFilePasted(type: string, active: () => boolean, open: (file: File) => void): void {
  window.addEventListener('paste', (e) => {
    if (!active()) return
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith(type))
    const file = item?.getAsFile()
    if (!file) return
    e.preventDefault()
    open(file)
  })
}

let toastTimer = 0

export function toast(message: string): void {
  const node = must<HTMLElement>('#toast')
  node.textContent = message
  node.classList.add('on')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => node.classList.remove('on'), 2400)
}

/** Save a blob to the user's disk under `name`. */
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // Revoking straight after `click()` can cut the download off before the blob
  // is read; one task later is safely past that.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
