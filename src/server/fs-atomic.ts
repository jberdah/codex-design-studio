import { rename } from "node:fs/promises";

// Windows antivirus and indexing services take short-lived locks on freshly
// written files, so a bare rename can fail with EPERM/EBUSY/EACCES even though
// the same operation succeeds moments later. Every atomic temp-then-rename
// write in the server goes through this retry so the pattern stays reliable
// on all supported platforms.
const RETRYABLE_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

export async function renameWithRetry(source: string, destination: string, attempts = 10, baseDelayMs = 100) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await rename(source, destination);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (attempt >= attempts || !RETRYABLE_CODES.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
}
