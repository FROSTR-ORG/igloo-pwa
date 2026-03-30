# Testing

`igloo-pwa` owns the browser-host validation surface for the PWA app.

## Fast Baseline

```bash
bunx tsc --noEmit
npm run test:unit
```

## Workspace E2E

Use the shared Playwright harness for real browser-flow coverage:

```bash
npm --prefix ../../test run test:e2e:igloo-pwa
```

That suite is the primary validation for:

- stored profiles on the landing page
- `bfprofile` import
- `bfshare` recovery
- `bfonboard` onboarding
- operator rotation flows
- logged-in `Rotate Key`

## Expected Validation Split

- repo-local checks:
  - TypeScript and unit coverage
- workspace test harness:
  - browser end-to-end product flows
