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

## Deployment

The public-beta deployment is a static GitHub Pages origin fronted by
Cloudflare. The PWA ships a strict `Content-Security-Policy` meta tag in
`index.html`; Cloudflare injects the cross-origin isolation headers on HTML
responses:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Resource-Policy: same-origin`

The app does not currently depend on `SharedArrayBuffer` or threaded WASM, so
these headers are hardening and future-runtime readiness rather than a
functional dependency. The Vite dev server sets them automatically for local
development (see `vite.config.ts`); GitHub Pages cannot set them directly, so
the beta domain uses the Cloudflare front layer described in
[DEPLOYMENT.md](./DEPLOYMENT.md).

The shipped CSP rejects plaintext `ws://` / `http://` to non-loopback hosts;
remote relays must use `wss://`. Loopback plaintext (`localhost`, `127.0.0.1`)
is permitted so the local dev-relay and demo harness work out of the box.

## Project Docs

- [DEPLOYMENT.md](./DEPLOYMENT.md)
- [docs/USER_GUIDE.md](./docs/USER_GUIDE.md)
- [TESTING.md](./TESTING.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
