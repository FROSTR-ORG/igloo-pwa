/// <reference types="vite/client" />

declare global {
  interface Window {
    /**
     * DEV-only seam used by the visual test harness to render the recover-success
     * screen with a FAKE recovered key. Never set in production.
     */
    __IGLOO_TEST_RECOVERED_KEY__?: { nsec: string; signingKeyHex: string };
    /**
     * DEV-only seam used by the visual test harness to render transient
     * replace-share states that intentionally cannot survive reload.
     */
    __IGLOO_TEST_REPLACE_SHARE_STATE__?: unknown;
    /**
     * DEV-only seam used by the visual test harness to render Import Save
     * Profile without persisting passphrase-bearing pending import state.
     */
    __IGLOO_TEST_IMPORT_SAVE_STATE__?: unknown;
    /**
     * DEV-only seam used by the visual test harness to render Onboard Save
     * Profile without persisting passphrase-bearing pending onboard state.
     */
    __IGLOO_TEST_ONBOARD_SAVE_STATE__?: unknown;
    /**
     * DEV-only seam used by the visual test harness to render active signer
     * permission state, which is in-memory only and intentionally not restored
     * from persisted app state.
     */
    __IGLOO_TEST_PERMISSION_STATE__?: unknown;
    /**
     * DEV-only seam used by the visual test harness to render Settings Onboard
     * Device package handoff state, which is in-memory only and intentionally
     * not persisted.
     */
    __IGLOO_TEST_SETTINGS_ONBOARD_STATE__?: unknown;
  }
}

export {};
