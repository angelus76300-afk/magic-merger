// Types shared by the browser and the Worker.
import type { SpellProgram } from "./spellcode";
import type { Tier } from "./tiers";
import type { DownReason } from "./votes";

// A spell can be cast in the World tab. An artifact is anything magical that
// cannot be cast: an object, material, creature, place, person or idea.
export type ElementKind = "spell" | "artifact";

export interface GameElement {
  name: string;
  emoji: string;
  kind: ElementKind;
  // Number of merges between this element and the primitives. Primitives are 0.
  depth: number;
  // How powerful it is, chosen once at merge time. Older elements may lack it.
  tier?: Tier;
}

export interface MergeRequest {
  a: string;
  b: string;
}

export interface MergeResponse {
  element: GameElement;
  // True when this merge created the element for the first time ever.
  firstDiscovery: boolean;
  // True when the Worker answered without calling Claude (no API key set).
  mock: boolean;
}

export interface DescribeRequest {
  name: string;
  // Admin only: throw away the stored text and write a new one.
  regenerate?: boolean;
}

export interface DescribeResponse {
  name: string;
  description: string;
  mock: boolean;
}

export interface SpellRequest {
  name: string;
  // Admin only: throw away the stored program and write the spell again.
  regenerate?: boolean;
  // Admin only, for comparing models: who writes it, and how hard it thinks.
  model?: string;
  effort?: string;
}

export interface SpellResponse {
  name: string;
  tier: Tier;
  program: SpellProgram;
  mock: boolean;
}

// The program crashed in the World: ask Claude to fix it.
export interface RepairRequest {
  name: string;
  error: string;
}

// What a program's test run found in the browser (src/sim/check.ts).
export interface CheckRequest {
  name: string;
  id: number;
  ok: boolean;
  problem: "crash" | "nothing" | "wiped" | "promise" | "idle" | null;
  detail: string;
  stats?: Record<string, number>;
  // A live program tested again against a promise it never faced (3.6).
  recheck?: boolean;
}

// The player cast this version: they may vote on it for a while.
export interface CastRecord {
  name: string;
  id: number;
}

export interface CastResponse {
  // False once they voted, or in mock mode.
  canVote: boolean;
}

export interface VoteRequest {
  name: string;
  id: number;
  up: boolean;
  // Required on a down vote.
  reason?: DownReason;
}

export interface VoteResponse {
  up: number;
  down: number;
  // Votes this version needs before players' votes act on it.
  needed: number;
}

// The program each element should have now, by name, so a browser learns of
// rewrites and rollbacks.
export interface LiveResponse {
  // recheck: the intents a live program promises and was never tested on
  // (written before its element had them): the browser tests it again.
  programs: Record<string, { id: number; trial: boolean; recheck?: string[] }>;
}

// Admin only: every version of one element's program.
export interface ProgramInfo {
  id: number;
  status: string;
  origin: string;
  model: string;
  version: number;
  created_at: number;
  up: number;
  down: number;
  library: boolean;
  checked: unknown;
  judged: unknown;
}

// Admin only: what another merge model would answer. Nothing is stored.
export interface MergeTrialRequest {
  a: string;
  b: string;
  model?: string;
  effort?: string;
}

// This month's Claude calls, grouped by call and model.
export interface SpendResponse {
  month: number;
  today: number;
  budget: number;
  calls: { call: string; model: string; n: number; usd: number; avg: number; today: number }[];
}

// One summary of frame times sent by the HUD, from a real device.
export interface PerfSample {
  [key: string]: unknown;
}

export interface HealthResponse {
  ok: boolean;
  mock: boolean;
  admin: boolean;
  // 3.4: false when this browser has no valid invite link (or admin token).
  invited: boolean;
  // The invite's own month, for the player.
  invite?: { name: string; status: "active" | "paused" | "revoked"; spent: number; cap: number };
}

// Why a request was refused, when the game should say it its own way:
// invite (no link), revoked, paused, spent (the invite's allowance), budget
// (everyone's month), burst (the bug guard).
export type ErrorCode = "invite" | "revoked" | "paused" | "spent" | "budget" | "burst";

export interface ApiError {
  error: string;
  code?: ErrorCode;
}

// 3.4 admin: one row per invited person.
export interface PersonInfo {
  id: string;
  name: string;
  status: "active" | "paused" | "revoked";
  cap: number;
  topup: number;
  spent: number;
  discoveries: number;
  refusals: number;
  lastSeen: number | null;
  createdAt: number;
}

export interface PeopleResponse {
  budget: number;
  spent: number;
  held: number;
  left: number;
  people: PersonInfo[];
  // Spend that is not an invite's: the admin, and calls from before 3.4.
  others: { who: string; spent: number }[];
  reports: { id: number; name: string; reason: string | null; by: string | null; at: number }[];
}
