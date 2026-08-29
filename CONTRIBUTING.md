# Contributing

## Issues are welcome; open one before you write code

Bug reports and ideas are the most useful thing you can send. Use the
[issue templates](https://github.com/jmatsu/akashi/issues/new/choose) — a bug
that can be reproduced is a bug that gets fixed.

Pull requests are read, but **open an issue first and let it be discussed**
before writing one. Akashi is deliberately small, and a change that is right
for someone else's fork is often wrong here; agreeing on the shape first saves
you from writing something that cannot be merged. An unannounced pull request
may be closed with nothing said against the code in it.

A vulnerability is not an issue: see [SECURITY](SECURITY.md).

## What a change is held to

The [Principles](README.md#principles) come first, and they are not negotiable
in a pull request:

- **No network.** Akashi makes no request with anything you open. `biome.json`
  denies the globals that could, `src/csp.ts` states the policy the browser
  enforces, and `test/offline.test.ts` checks the built bundle. A change that
  needs any of the three relaxed will not be merged.
- **No backend, no account, no telemetry.**
- **Minimum dependencies.** Vite, TypeScript and vite-plugin-pwa are the whole
  list, and adding to it needs a reason that a hundred lines of our own code
  cannot answer.
- **Every platform.** Windows, macOS, Linux, Android and iOS, in the browser.

Beyond that, follow the code already there: see the architecture map in the
[README](README.md#architecture) for where a file belongs.

## Working on it

Setup is in the [README](README.md#setup) — Node, a Rust toolchain with the
wasm target, and `npm install`.

Run what CI runs before you push:

```sh
npm run format:check   # Biome + rustfmt
npm run lint           # Biome + clippy
npm run build          # wasm, tsc --noEmit, and the bundle
npm test               # Rust tests + the web tests (one reads dist/)
```

`npm test` needs a build first: `test/offline.test.ts` reads `dist/`.

Commit messages follow [Conventional
Commits](https://www.conventionalcommits.org) — `feat:`, `fix:`, `docs:`,
`refactor:`, `chore:`. Keep the subject in the imperative and under ~72
characters.

Behaviour that can be tested without a DOM is tested: the pure modules
(`geom.ts`, `plan.ts`, `apps.ts`, `filename.ts`, the locales, the crate) carry
the tests, and a change to one is expected to bring its own.

## Licensing

Akashi is under the [Apache License 2.0](LICENSE). Contributions are accepted
under the same license, per section 5 of it — by opening a pull request you
agree your work is licensed that way.
