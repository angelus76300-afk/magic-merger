// The Daily tab's finds (2026-11-10): how long a challenge waited before it
// was found, read from the two Toronto days the Worker sends.
import { waitedDays, waitedLabel } from "../shared/daily";

type Check = (name: string, ok: boolean, detail?: string) => void;

export function dailyChecks(check: Check): void {
  const cases: [string, string | null, number | null, string][] = [
    ["2026-11-05", "2026-11-05", 0, "the same day"],
    ["2026-11-05", "2026-11-06", 1, "after 1 day"],
    ["2026-10-30", "2026-11-02", 3, "after 3 days"],
    // A forced second challenge carries "#2" after its date.
    ["2026-11-05#2", "2026-11-07", 2, "after 2 days"],
    // Across the change from summer time (Toronto, 1 November 2026).
    ["2026-10-31", "2026-11-02", 2, "after 2 days"],
    ["2026-11-05", null, null, ""],
    ["not a day", "2026-11-05", null, ""],
  ];
  for (const [day, found, days, label] of cases) {
    const got = waitedDays(day, found);
    const text = waitedLabel(day, found);
    check(`daily waited ${day} to ${found}`, got === days && text === label, `${got} "${text}", expected ${days} "${label}"`);
  }
}
