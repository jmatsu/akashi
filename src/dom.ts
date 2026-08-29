/**
 * The few DOM chores both apps have: finding the elements the markup promises,
 * saying something briefly, and handing a file to the browser.
 */

export function must<T extends Element>(selector: string, root: ParentNode = document): T {
  const node = root.querySelector<T>(selector)
  if (!node) throw new Error(`aka: missing element ${selector}`)
  return node
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
