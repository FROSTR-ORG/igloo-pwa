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
  }
}

export {};
