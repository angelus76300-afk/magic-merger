// 4.5: public/changelog.json, one line per merged update, newest first
// (src/whatsnew.ts shows it). The dates, kept apart from the page so Node
// tests read them the same way.

export interface ChangelogEntry {
  date: string;
  text: string;
  pr?: number;
  version?: string;
  // The Ideas tab id it built, when it came from one.
  idea?: number;
}

// The day an entry was merged, as a time: the end of that day, so an entry
// of today counts as new for someone who last looked this morning.
export const entryTime = (e: ChangelogEntry) => Date.parse(`${e.date}T23:59:59`);

// What "seen" records when a player looks (or arrives for the first time):
// now, or the end of the newest entry's day if that is later. 4.5.1 (audit,
// A.W1): recording now alone left today's entry newer than the read, so the
// dot and "1 new since your last visit" came back on every visit until
// midnight, and greeted a player who had just arrived.
export function seenStamp(entries: ChangelogEntry[], now = Date.now()): number {
  return Math.max(now, ...entries.map(entryTime).filter(Number.isFinite));
}
