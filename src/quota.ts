import { toast } from "./toast";

// The browser's storage is full, or a save is too big for it (4.0 review
// M13): the player hears it once per page, instead of losing everything since
// the last write on the next reload without a word.
let warned = false;

export function isQuotaError(err: unknown): boolean {
  if (!(err instanceof DOMException)) return false;
  // Chrome and Safari name it; old Firefox used its own name; code 22 is the legacy one.
  return err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED" || err.code === 22;
}

export function warnStorageFull(): void {
  if (warned) return;
  warned = true;
  toast(
    "This browser's storage for the game is full: new progress is not saved here. Free some space, or make an account (the ? button) so your island is kept online.",
    "error",
  );
}
