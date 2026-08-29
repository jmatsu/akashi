/**
 * The header's drop menus. Each is a `[popover]` panel named by the button
 * that opens it, so opening, light dismiss, Escape and the top layer are the
 * browser's -- the header scrolls sideways, and a panel laid out inside it
 * would be clipped by that.
 *
 * What is left to us is where the panel lands, and closing it once the item
 * clicked has been chosen.
 */

import { must } from './dom'

export function wireMenus(root: ParentNode = document): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[popovertarget]')) {
    const menu = must<HTMLElement>(`#${button.getAttribute('popovertarget')}`)

    menu.addEventListener('beforetoggle', (e) => {
      if ((e as ToggleEvent).newState === 'open') place(menu, button)
    })

    // Captured, so the panel is out of the way before an action that opens a
    // dialog of its own runs.
    menu.addEventListener(
      'click',
      (e) => {
        if ((e.target as HTMLElement).closest('.menu-item')) menu.hidePopover()
      },
      true,
    )
  }
}

/**
 * Under the button, and aligned with the edge of it nearer the edge of the
 * window -- which keeps a panel wider than its button on screen without having
 * to measure one that is not laid out yet.
 */
function place(menu: HTMLElement, button: HTMLElement): void {
  const box = button.getBoundingClientRect()
  const fromRight = box.left + box.width / 2 > window.innerWidth / 2
  menu.style.top = `${box.bottom + 6}px`
  menu.style.left = fromRight ? 'auto' : `${box.left}px`
  menu.style.right = fromRight ? `${window.innerWidth - box.right}px` : 'auto'
}
