import { must } from './dom'
import { LOCALES, initI18n, isLocale, locale, localeName, setLocale } from './i18n'
import { wireMenus } from './menu'
import { startRouter } from './router'
import { wasmReady } from './wasm'
import './style.css'

/**
 * Boot: settle the language, then hand the page to whichever app the URL asks
 * for (`src/router.ts`). Everything else lives in the app that needs it --
 * including the wasm core, which is started here only so that it loads
 * alongside the app's own chunk, and awaited by whichever app needs it.
 */
async function boot(): Promise<void> {
  void wasmReady()

  // Before anything reads a string, so the chrome is never shown in the wrong
  // language.
  initI18n()
  wireMenus()
  wireLanguage()

  await startRouter()

  must<HTMLElement>('#loading').remove()
}

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

function registerServiceWorker(): void {
  // Registered lazily so a failing SW never blocks an app from starting.
  void import('virtual:pwa-register')
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => {
      /* Offline support is a bonus; the apps work without it. */
    })
}

void boot().then(registerServiceWorker)
