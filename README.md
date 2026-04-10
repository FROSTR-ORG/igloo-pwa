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
bunx tsc --noEmit
npm run test:unit
```

Workspace E2E coverage:

```bash
npm --prefix ../../test run test:e2e:igloo-pwa
```

## Project Docs

- [TESTING.md](./TESTING.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
