// 4.0: accounts, as the page and the Worker see them (worker/accounts.ts,
// src/account.ts). An account is an invite that was claimed with a passkey;
// it has the invite's id, name and monthly allowance.

export const PROGRESS_KINDS = ["discoveries", "board", "island"] as const;
export type ProgressKind = (typeof PROGRESS_KINDS)[number];

// Characters of JSON each document may hold on the server. A large island
// is about 700k characters raw and under 200k gzipped and base64 encoded.
export const PROGRESS_LIMITS: Record<ProgressKind, number> = { discoveries: 600_000, board: 60_000, island: 1_500_000 };

export interface ProgressDiscovery {
  key: string;
  at: number;
  recipe: [string, string] | null;
}

export interface ProgressBoard {
  chips: { id: number; key: string; x: number; y: number }[];
  next: number;
}

export interface ProgressIsland {
  // The world save, gzipped and base64 encoded.
  gz: string;
  size: "small" | "medium" | "large";
  // When the island was saved on the device, for the warning.
  at: number;
}

export interface ProgressPut {
  kind: ProgressKind;
  data: ProgressDiscovery[] | ProgressBoard | ProgressIsland;
  // The server's updatedAt this device last saw; a newer save from another
  // device is refused (409) unless force is set.
  since?: number;
  force?: boolean;
  device?: string;
}

export interface ProgressDoc {
  kind: ProgressKind;
  data: unknown;
  updatedAt: number;
  device: string | null;
}

export interface AccountInfo {
  id: string;
  name: string;
  claimedAt: number;
  // Masked, for the account page.
  email: string | null;
  // Whether sign in by email is set up on this Worker.
  emailOffered: boolean;
  passkeys: { id: string; createdAt: number; lastUsed: number | null; synced: boolean }[];
  devices: { hash: string; device: string; since: number; lastSeen: number | null; current: boolean }[];
  progress: { kind: ProgressKind; updatedAt: number; device: string | null; size: number }[];
}

// Discoveries from two devices: the union by key, the earliest time wins,
// and the recipe of whichever found it first.
export function mergeDiscoveries(a: ProgressDiscovery[], b: ProgressDiscovery[]): ProgressDiscovery[] {
  const out = new Map<string, ProgressDiscovery>();
  for (const d of [...a, ...b]) {
    const known = out.get(d.key);
    if (!known || (d.at > 0 && (known.at === 0 || d.at < known.at))) out.set(d.key, { key: d.key, at: d.at, recipe: d.recipe ?? known?.recipe ?? null });
  }
  return [...out.values()].sort((x, y) => x.at - y.at);
}
