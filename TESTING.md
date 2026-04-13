# Testing

`igloo-pwa` owns the browser-host validation surface for the PWA app.

## Fast Baseline

```bash
npm run test:unit
```

## Workspace E2E

Use the shared Playwright harness for real browser-flow coverage:

```bash
make igloo-pwa-test-e2e
```

If you are working only inside this repo, `npm run test:e2e` now routes through the
shared workspace prep path before invoking the same Playwright suite.

That suite is the primary validation for:

- stored profiles on the landing page
- `bfprofile` import
- `bfshare` recovery
- `bfonboard` onboarding
- operator rotation flows
- logged-in `rotate share`

## Expected Validation Split

- repo-local checks:
  - prep-first local build/unit coverage via `npm run build` and `npm run test:unit`
- workspace test harness:
  - browser end-to-end product flows
