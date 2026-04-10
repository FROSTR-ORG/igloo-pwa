import { configureWasmBridgeLoader, configureWasmProfileLoader } from 'igloo-shared';

let configured = false;

export function ensureIglooSharedConfigured() {
  if (configured) {
    return;
  }

  if (typeof window === 'undefined' || !window.location?.origin) {
    return;
  }

  configureWasmBridgeLoader({
    loaderImportUrl: new URL('/wasm/bifrost_bridge_wasm.js', window.location.origin).toString(),
    wasmBinaryUrl: new URL('/wasm/bifrost_bridge_wasm_bg.wasm', window.location.origin).toString(),
  });
  configureWasmProfileLoader({
    loaderImportUrl: new URL('/wasm/bifrost_profile_wasm.js', window.location.origin).toString(),
    wasmBinaryUrl: new URL('/wasm/bifrost_profile_wasm_bg.wasm', window.location.origin).toString(),
  });
  configured = true;
}
