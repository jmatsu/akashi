import { APPS, appFromUrl, appSpec, urlForApp } from './apps'
import type { AppId, AppModule } from './apps'
import { must } from './dom'
import { onLocaleChange, t } from './i18n'

/**
 * Shows one app at a time, and keeps the address bar saying which.
 *
 * An app is loaded and mounted the first time it is shown and then left in
 * place, so switching away and back keeps whatever was on screen. Everything
 * an app owns -- its panel and its share of the header -- is marked
 * `data-app="<id>"` in the markup and hidden with it.
 */

const mounted = new Map<AppId, AppModule>()

let current: AppId | null = null

/**
 * Which app is on screen. The apps ask, rather than reading the `hidden`
 * attributes back, so that how an app is hidden stays the router's business.
 */
export function isShowing(id: AppId): boolean {
  return current === id
}

export async function startRouter(): Promise<void> {
  buildSwitcher()

  // Back and forward move between apps, since a switch is a history entry.
  window.addEventListener('popstate', () => {
    const wanted = appFromUrl(location.href)
    if (wanted !== current) void show(wanted)
  })

  await show(appFromUrl(location.href))
}

function buildSwitcher(): void {
  const nav = must<HTMLElement>('#apps')
  const relabel: (() => void)[] = []
  for (const spec of APPS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'app-tab'
    button.dataset.appTab = spec.id
    button.innerHTML = `${spec.icon}<span class="app-label"></span>`
    button.addEventListener('click', () => void switchTo(spec.id))
    nav.appendChild(button)

    const label = must<HTMLElement>('.app-label', button)
    relabel.push(() => {
      label.textContent = t(spec.label)
      button.title = t(spec.label)
    })
  }

  for (const fn of relabel) fn()
  onLocaleChange(() => {
    for (const fn of relabel) fn()
  })
}

async function switchTo(id: AppId): Promise<void> {
  if (id === current) return
  history.pushState(null, '', urlForApp(id, location.href))
  await show(id)
}

async function show(id: AppId): Promise<void> {
  current = id
  for (const node of document.querySelectorAll<HTMLElement>('[data-app]')) {
    node.hidden = node.dataset.app !== id
  }
  for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-app-tab]')) {
    const on = tab.dataset.appTab === id
    tab.classList.toggle('on', on)
    tab.setAttribute('aria-current', on ? 'page' : 'false')
  }

  if (mounted.has(id)) return
  const app = await appSpec(id).load()
  // Two clicks in a row can land here twice; only the first mount counts.
  if (mounted.has(id)) return
  mounted.set(id, app)
  await app.mount()
}
