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

// An entry as the page remembers it once read.
export function entryId(e: ChangelogEntry): string {
  return `${e.date}|${e.version ?? ""}|${e.text.slice(0, 60)}`;
}

// What is new for a player (4.5.1, audit A.W1 and B2). The page remembers when
// they last looked (`seen`, a time) and which entries they had then (`read`).
// An entry is new when it was not among those; an idea of theirs is new when
// it shipped after that time. Entries carry a day, not a time: comparing the
// end of their day with `seen` brought "1 new" back after reading, and storing
// the end of the day instead hid an update or an idea that came later that
// day. Without `read` (a page from before 4.5.1), entries fall back to the day.
export function whatIsNew(
  entries: ChangelogEntry[],
  shipped: { title: string; at: number }[],
  seen: number | null,
  read: string[] | null,
): { fresh: ChangelogEntry[]; ideas: { title: string; at: number }[] } {
  if (seen === null) return { fresh: [], ideas: [] };
  const known = read ? new Set(read) : null;
  return {
    fresh: entries.filter((e) => (known ? !known.has(entryId(e)) : entryTime(e) > seen)),
    ideas: shipped.filter((i) => i.at > seen),
  };
}

// 2026-11-08, no shared hot files: a pull request adds its entry as its own file,
// changelog.d/<YYYY-MM-DD>-<slug>.json holding one entry, so two pull requests never
// edit the same lines. The build joins them with public/changelog.json (vite.config.ts),
// newest first: by date, then by file name, last first. A part that is not an entry
// with a date and a text stops the build, so a broken one never reaches players.
export interface ChangelogPart {
  name: string;
  text: string;
}

export function joinChangelog(base: { about?: string; entries: ChangelogEntry[] }, parts: ChangelogPart[]): { about?: string; entries: ChangelogEntry[] } {
  const added = parts
    .map((p) => {
      let e: unknown;
      try {
        e = JSON.parse(p.text);
      } catch {
        throw new Error(`changelog.d/${p.name}: not JSON`);
      }
      const entry = e as ChangelogEntry;
      if (!entry || typeof entry !== "object" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date ?? "") || typeof entry.text !== "string" || !entry.text.trim())
        throw new Error(`changelog.d/${p.name}: an entry needs a date (YYYY-MM-DD) and a text`);
      return { name: p.name, entry };
    })
    .sort((a, b) => (a.entry.date === b.entry.date ? b.name.localeCompare(a.name) : b.entry.date.localeCompare(a.entry.date)))
    .map((p) => p.entry);
  // Newest first overall: a part is never older than the file it joins, but keep the order honest.
  const entries = [...added, ...base.entries].sort((a, b) => b.date.localeCompare(a.date));
  return { ...base, entries };
}
