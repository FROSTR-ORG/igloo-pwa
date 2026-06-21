// Shared client-side file-save helpers. Used by both the distribution "save"
// flow (store) and the export modal so confirmed-write semantics are consistent.

import { downloadText } from 'igloo-ui';

// Re-exported so existing consumers (store, export modal) keep importing it here.
export { downloadText };

type SaveFilePicker = (options?: {
  suggestedName?: string;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}) => Promise<{
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
}>;

// Save text to a real file. Prefers the File System Access API so the resulting
// promise resolves only after a confirmed write (used to advance a share to the
// `saved` status); returns false when the user cancels the native save dialog.
// Falls back to an anchor download (optimistic) where the picker is unavailable.
export async function saveTextToFile(filename: string, value: string): Promise<boolean> {
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (typeof picker === 'function') {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [{ description: 'FROSTR package', accept: { 'text/plain': ['.txt'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(value);
      await writable.close();
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return false;
      }
      // Fall through to the anchor download for any non-cancellation failure.
    }
  }
  downloadText(filename, value);
  return true;
}
