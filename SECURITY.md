# Security policy

## What is in scope

Akashi's central claim is that nothing you open leaves your device. A report
that breaks that claim is the one we most want to hear about:

- Anything on <https://akashi.jmatsu.dev> that makes a network request with the
  content of a file you opened, or with anything derived from it.
- A way past the Content-Security-Policy in `src/csp.ts`, or past the service
  worker's cache, that gets script or a request onto the page.
- Data left where the next user of the browser can read it — a draft, an image,
  or an undo history that outlives the tab it was opened in.
- Memory-safety or panic-driven bugs in the Rust core (`crate/`) that a crafted
  image or video clip can reach.

Self-hosted deployments are out of scope: see [DISCLAIMER](DISCLAIMER.md).

## Reporting

Report privately through GitHub — [open a security
advisory](https://github.com/jmatsu/akashi/security/advisories/new). Please do
not open a public issue for a vulnerability.

Tell us what an attacker gets, and how to reproduce it: a browser and version,
the steps, and a file that triggers it if one is needed. A proof of concept is
welcome; an exploit ready to use against other people is not.

## What to expect

This is a personal project, not a staffed product. Reports are read and
answered on a best-effort basis, and there is no bounty. Fixes ship to
`main` and reach <https://akashi.jmatsu.dev> on the next deploy; the advisory
is published once the fix is live.

## Supported versions

Only `main`, and the build currently deployed at <https://akashi.jmatsu.dev>.
There are no maintained release branches, and older builds are not patched.
