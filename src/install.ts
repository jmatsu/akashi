/**
 * Suggesting the install. The app is already a PWA -- manifest, service worker,
 * everything precached -- and this is the part that says so: a bar under the
 * header the first time the browser reports the app can be installed, and an
 * item in the product menu for whoever turned that bar down.
 *
 * Chromium hands the prompt over in `beforeinstallprompt` and installs on our
 * call. iOS Safari fires nothing and offers no API at all, so there the same
 * affordance explains the Share-sheet route instead.
 */

// Extensions named, as in `src/locales/`: which browsers are left to install
// themselves is a rule worth testing, and Node loads this module to do it.
import { must, toast } from './dom.ts'
import { t } from './i18n.ts'

/** Chromium's own event, which the DOM lib does not describe. */
interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: InstallPrompt
  }
}

const STORAGE_KEY = 'akashi.install.dismissed'

let deferred: InstallPrompt | null = null

export function wireInstall(): void {
  const bar = must<HTMLElement>('#install-bar')
  const item = must<HTMLButtonElement>('#install')
  const help = must<HTMLElement>('#install-help')

  // The menu item stays for as long as installing is possible; the bar is the
  // one-time offer, and stays gone once it has been turned down.
  const suggest = (): void => {
    if (installed()) return
    item.hidden = false
    bar.hidden = dismissed()
  }

  const settle = (): void => {
    deferred = null
    item.hidden = true
    bar.hidden = true
  }

  const install = (): void => {
    if (!deferred) {
      help.showPopover()
      return
    }
    const prompt = deferred
    // Spent either way: the event cannot be raised twice, and a refusal is an
    // answer worth keeping rather than asking again.
    settle()
    remember()
    void prompt.prompt()
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    // Ours to raise, from a control that says what it does.
    e.preventDefault()
    deferred = e
    suggest()
  })

  window.addEventListener('appinstalled', () => {
    settle()
    toast(t('toast.installed'))
  })

  item.addEventListener('click', install)
  must<HTMLButtonElement>('#install-accept').addEventListener('click', install)
  must<HTMLButtonElement>('#install-dismiss').addEventListener('click', () => {
    bar.hidden = true
    remember()
  })
  must<HTMLButtonElement>('#install-help-close').addEventListener('click', () => help.hidePopover())

  // Nothing will announce itself on the browsers below, so there the offer is
  // made on what the user agent says.
  if (manualOnly(navigator.userAgent, navigator.maxTouchPoints)) suggest()
}

/**
 * Whether this browser can be installed to but never offers: on iOS every
 * engine is Safari's, none fires an install event, and each keeps Add to Home
 * Screen in a share menu of its own. Which browser it is does not narrow that
 * down -- Chrome and Edge have the entry as much as Safari does -- so the test
 * is the platform alone.
 */
export function manualOnly(ua: string, touchPoints: number): boolean {
  // iPadOS asks for desktop pages and calls itself a Mac; the touch points are
  // what tell the two apart.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)
}

function installed(): boolean {
  // `standalone` is iOS's answer; the media query is everyone else's.
  const ios = (navigator as Navigator & { standalone?: boolean }).standalone
  return ios === true || window.matchMedia('(display-mode: standalone)').matches
}

function dismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null
  } catch {
    // Storage can be denied (private windows, blocked cookies); the bar is
    // then offered once per visit rather than once.
    return false
  }
}

function remember(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    /* Not remembering the answer is better than failing to take it. */
  }
}
