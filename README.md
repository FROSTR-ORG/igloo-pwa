# igloo-pwa

Progressive web app host for FROSTR.

`igloo-pwa` is the browser-based host for profile management, onboarding, recovery, and simplified operator flows on the web.

## Status

- Beta.

## Owns

- PWA application shell and browser UX
- browser-host profile import, recovery, onboarding, and rotation flows
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
