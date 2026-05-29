import { configureWasmBridgeLoader, configureWasmProfileLoader } from 'igloo-shared';

let configured = false;

export function ensureIglooSharedConfigured() {
  if (configured) {
    return;
  }

  if (typeof window === 'undefined' || !window.location?.origin) {
    return;
  }

  // PR20: import the self-verifying `_loader.mjs` wrapper (not the raw glue
  // `.js`) so the embedded SHA-384 integrity check runs before the wasm is
  // instantiated. The wrapper fetches `_bg.wasm` via `wasmBinaryUrl` itself.
  configureWasmBridgeLoader({
    loaderImportUrl: new URL('/wasm/bifrost_bridge_wasm_loader.mjs', window.location.origin).toString(),
    wasmBinaryUrl: new URL('/wasm/bifrost_bridge_wasm_bg.wasm', window.location.origin).toString(),
  });
  configureWasmProfileLoader({
    loaderImportUrl: new URL('/wasm/bifrost_profile_wasm_loader.mjs', window.location.origin).toString(),
    wasmBinaryUrl: new URL('/wasm/bifrost_profile_wasm_bg.wasm', window.location.origin).toString(),
  });
  configured = true;
}
