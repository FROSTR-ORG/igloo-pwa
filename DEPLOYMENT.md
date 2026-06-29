# Deploying igloo-pwa

igloo-pwa is a static, single-page web app. It keeps all signer state in one
page context (no service worker) and relies on **cross-origin isolation** for
forward-looking WebAssembly/threading work. This guide describes the canonical
public-beta deployment: **GitHub Pages as the origin, fronted by Cloudflare** to
supply the response headers Pages cannot set.

> **Why Cloudflare in front?** GitHub Pages cannot set custom HTTP response
> headers, and igloo-pwa wants `Cross-Origin-Opener-Policy` /
> `Cross-Origin-Embedder-Policy` / `Cross-Origin-Resource-Policy` on every HTML
> response. The app *functions* without them today (no `SharedArrayBuffer` use
> yet), but serving them preserves cross-origin isolation and the hardening it
> provides for a signing app. A Cloudflare Transform Rule injects them while
> Pages stays the origin — and avoids reintroducing a service worker (the
> `coi-serviceworker` shim), which this app deliberately does not use.

## 1. Build

```bash
make igloo-pwa-build      # from the workspace root — runs the Vite production build
# output: repos/igloo-pwa/dist/
```

The build emits a static `dist/` (hashed JS/CSS, `index.html` with a strict CSP
meta tag, the PWA manifest, icons, and the two integrity-checked WASM modules).

## 2. Publish to GitHub Pages (origin)

Serve the contents of `dist/` from a GitHub Pages site (project or dedicated
repo). Pages provides HTTPS and git-native versioning. No build step runs on
Pages — publish the prebuilt `dist/` (e.g. via a `gh-pages` branch or an actions
workflow that uploads the artifact).

## 3. Front with Cloudflare (custom domain + headers)

1. Add the site's custom domain to Cloudflare and point it at the Pages origin
   (CNAME to the `*.github.io` host; enable proxying — the orange cloud).
2. Add a **Transform Rule → Modify Response Header** that sets, on all HTML
   responses for the domain:

   | Header | Value |
   |--------|-------|
   | `Cross-Origin-Opener-Policy` | `same-origin` |
   | `Cross-Origin-Embedder-Policy` | `require-corp` |
   | `Cross-Origin-Resource-Policy` | `same-origin` |

3. Enforce HTTPS (Always Use HTTPS) and HSTS.

## 4. Verify the live deploy

```bash
curl -sI https://<your-domain>/ | grep -i 'cross-origin'
```

Expected: all three `Cross-Origin-*` headers present. In the browser console,
`crossOriginIsolated` should be `true`. If it is `false`, the headers are not
reaching HTML responses — re-check the Transform Rule scope.

## 5. Publish public-beta support pages

Serve the user-facing docs from the same HTTPS domain so beta users and later
Chrome Web Store reviewers have stable links:

- user guide: `docs/USER_GUIDE.md` rendered as the public "Getting Started" /
  troubleshooting page;
- privacy policy: explains that profiles and shares remain local to the browser
  unless the user exports or shares them;
- security contact: points to GitHub Private Vulnerability Reporting or the
  maintainer security address.

## Content-Security-Policy notes

`index.html` ships a strict CSP meta tag. It **rejects plaintext `ws://` /
`http://` to non-loopback hosts** — remote relays must use `wss://`. Loopback
plaintext (`localhost`, `127.0.0.1`) is permitted so the local dev-relay and
demo harness work; this does not affect production, which only ever talks to
`wss://` relays.

## What this app does NOT need

- **No server-side runtime** — it is fully static.
- **No service worker** — signer state lives in a single page context by design;
  do not add `coi-serviceworker` or any SW to obtain the COOP/COEP headers. Use
  the Cloudflare layer above instead.
- **No backend / database** — encrypted profiles live in the browser's local
  storage on the user's device (see [the user guide](docs/USER_GUIDE.md)).
