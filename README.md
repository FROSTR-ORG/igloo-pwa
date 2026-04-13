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

## Project Docs

- [TESTING.md](./TESTING.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
