/// <reference types="vite/client" />

declare global {
  interface Window {
    /**
     * DEV-only seam used by the visual test harness to render the recover-success
     * screen with a FAKE recovered key. Never set in production.
     */
    __IGLOO_TEST_RECOVERED_KEY__?: { nsec: string; signingKeyHex: string };
  }
}

export {};
