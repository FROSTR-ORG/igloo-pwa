# igloo-pwa

Browser app host for FROSTR.

`igloo-pwa` is the browser-based host for profile management, onboarding, recovery, and simplified operator flows on the web. The signer runtime lives in page memory; there is no service-worker runtime host.

## Status

- Beta.

## Owns

- browser app shell and browser UX
- browser-host profile import, recovery, onboarding, and rotation flows
- page-memory runtime hosting for the signer session
- bridge-WASM sync and browser runtime wiring
- repo-local unit tests for the PWA host

## Does Not Own

- shared UI primitives
- shared browser/runtime adapter contracts
- core signer, router, bridge, or cryptographic behavior

## Build

Workspace-owned entrypoints are the default for cross-repo flows:

```bash
make igloo-pwa-build
make igloo-pwa-dev
make igloo-pwa-test-e2e
```

For repo-local work inside `repos/igloo-pwa`, use the prep-first scripts:

```bash
npm install
npm run build
```

For local development:

```bash
npm run dev
```

`npm run dev` uses checked-in browser WASM artifacts and does not rebuild the
Rust WASM crates. Use `make browser-wasm-sync` only when intentionally
refreshing those artifacts; that path requires `wasm-pack`.

## Test

Repo-local checks:

```bash
npm run test:unit
```

Workspace E2E coverage:

```bash
make igloo-pwa-test-e2e
```

Low-level maintenance/debug commands still exist:
- `npm run build:browser-wasm`
- `npm run build:ui`

## Deployment

The PWA ships a strict `Content-Security-Policy` meta tag in `index.html` and
relies on cross-origin isolation for future WebAssembly/threading features.
Production hosting **must** serve the following response headers on every
HTML response alongside the bundled app:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Resource-Policy: same-origin`

The Vite dev server sets these automatically (see `vite.config.ts`). Static
hosts (e.g. nginx, Cloudflare Pages, Netlify) need equivalent header rules.
Without them, `crossOriginIsolated` will be `false` and cross-origin window
references will not be blocked by the browser.

The shipped CSP rejects plaintext `ws://` / `http://` to non-loopback hosts;
remote relays must use `wss://`. Loopback plaintext (`localhost`, `127.0.0.1`)
is permitted so the local dev-relay and demo harness work out of the box.

## Project Docs

- [TESTING.md](./TESTING.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
