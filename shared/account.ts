// 4.0: accounts, as the page and the Worker see them (worker/accounts.ts,
// src/account.ts). An account is an invite that was claimed with a passkey;
// it has the invite's id, name and monthly allowance.

export const PROGRESS_KINDS = ["discoveries", "board", "island"] as const;
export type ProgressKind = (typeof PROGRESS_KINDS)[number];
// 4.4.6: the island another device's replaced, kept so a choice between two
// islands never loses one. Read with ?kind=island_previous, never by default.
export type StoredKind = ProgressKind | "island_previous";

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
  // 4.4: huge and giant islands, kept on the account like the others.
  size: "small" | "medium" | "large" | "huge" | "giant";
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
  // 4.4.6: the account this device's save belongs to (the page tags its save
  // with it). A save that belongs to another account is refused; a page from
  // before 4.4.6 sends none.
  owner?: string | null;
  // 4.4.6: an island kept as the previous one (this device's, before it
  // loads the newer island of another device), not as the current one.
  previous?: boolean;
}

// What a sign in answers (a passkey, a link): the device's session and the
// account it belongs to, so the page tags its save with that id.
export interface SignedIn {
  token: string;
  name: string;
  id: string;
  admin: boolean;
}

export interface ProgressDoc {
  kind: StoredKind;
  data: unknown;
  updatedAt: number;
  device: string | null;
}

export interface AccountInfo {
  id: string;
  name: string;
  claimedAt: number;
  // 4.4.6: the owner's account, which has the admin powers.
  admin: boolean;
  // Masked, for the account page.
  email: string | null;
  // Whether sign in by email is set up on this Worker.
  emailOffered: boolean;
  passkeys: { id: string; createdAt: number; lastUsed: number | null; synced: boolean }[];
  // lastSync: when that device last saved to the account (4.4.6).
  devices: { hash: string; device: string; since: number; lastSeen: number | null; lastSync: number | null; current: boolean }[];
  progress: { kind: StoredKind; updatedAt: number; device: string | null; size: number }[];
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
