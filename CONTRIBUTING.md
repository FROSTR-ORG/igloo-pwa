# Contributing

This file explains the local editing boundaries for `igloo-pwa`.

## Repo Shape

`igloo-pwa` is a browser host built from:

- `src/`
  - React app shell and PWA workflows
- `scripts/`
  - bridge-WASM sync helpers

## Ownership Rules

`igloo-pwa` owns:

- the PWA application shell
- browser-host workflow composition
- local browser state and PWA-specific UI behavior

It does not own:

- shared UI component implementations
- shared browser/runtime adapter contracts
- Rust signer/router/bridge behavior

## Editing Guidance

- Keep host-specific workflow decisions in the PWA repo.
- Keep shared runtime/package logic in `igloo-shared`.
- Prefer `igloo-ui` for reusable presentational components.
- Update `README.md` and `TESTING.md` when the build/test contract changes.
