import type { Tier } from "../shared/tiers";
import type { FeedbackAction, FeedbackResponse } from "../shared/feedback";
import type {
  ApiError,
  CastResponse,
  ErrorCode,
  CheckRequest,
  DescribeResponse,
  HealthResponse,
  LiveResponse,
  MergeResponse,
  PeopleResponse,
  PerfSample,
  ProgramInfo,
  SpellResponse,
  SpendResponse,
  VoteRequest,
  VoteResponse,
} from "../shared/types";

// The admin token (five taps on the title), and this person's invite link.
const TOKEN_KEY = "magic-merger.token";
const INVITE_KEY = "magic-merger.invite";
const PLAYER_KEY = "magic-merger.player";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code?: ErrorCode,
    // The HTTP status, 0 when the Worker could not be reached.
    readonly status = 0,
  ) {
    super(message);
  }
}

// Told when the Worker says this browser has no valid invite (or it was
// revoked), so the page can say so instead of failing request by request.
export let onLockedOut: (code: "invite" | "revoked", message: string) => void = () => undefined;
export function setLockedOut(fn: typeof onLockedOut): void {
  onLockedOut = fn;
}

// An invite link is /#invite=<secret>. The secret is kept by this browser and
// taken out of the address bar, so it is not shared by copying the URL or
// left in the history. Returns true when the page was opened from a link.
export function captureInvite(): boolean {
  const m = /(?:^#|&)invite=([A-Za-z0-9_-]{20,64})/.exec(location.hash);
  if (!m) return false;
  store(INVITE_KEY, m[1]);
  history.replaceState(null, "", location.pathname + location.search);
  return true;
}

export function hasInvite(): boolean {
  return !!read(INVITE_KEY);
}

// A player reports a name as offensive or wrong; the admin sees it.
export function report(name: string, reason: string): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>("/api/report", { name, reason });
}

// Admin: everyone invited, with spend, discoveries and last visit.
export async function people(): Promise<PeopleResponse | null> {
  try {
    const res = await fetch("/api/admin/people", { headers: authHeaders() });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export function createInvite(name: string): Promise<{ id: string; name: string; cap: number; link: string }> {
  return post("/api/admin/invites", { name });
}

export function changeInvite(id: string, action: "pause" | "resume" | "revoke" | "topup" | "relink", usd?: number): Promise<{ ok: boolean; link?: string }> {
  return post("/api/admin/invite", { id, action, usd });
}

export function closeReport(id: number): Promise<{ ok: boolean }> {
  return post("/api/admin/report", { id });
}

// 3.4.1: the Feedback tab.
export async function feedback(): Promise<FeedbackResponse | null> {
  try {
    const res = await fetch("/api/feedback", { headers: authHeaders() });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export function postIdea(title: string, body: string): Promise<{ id: number }> {
  return post("/api/feedback", { title, body });
}

export function voteIdea(id: number, up: boolean): Promise<{ votes: number; voted: boolean }> {
  return post("/api/feedback/vote", { id, up });
}

// Admin: send an idea to Claude, decline, reopen or delete it.
export function changeIdea(change: FeedbackAction): Promise<{ ok: boolean; sessionUrl?: string | null; issueUrl?: string | null }> {
  return post("/api/admin/feedback", change);
}

// Admin: read GitHub now instead of waiting for the cron.
export function syncIdeas(): Promise<{ checked: number; changed: number }> {
  return post("/api/admin/feedback-sync", {});
}

export function merge(a: string, b: string): Promise<MergeResponse> {
  return post<MergeResponse>("/api/merge", { a, b });
}

export function describe(name: string, regenerate = false): Promise<DescribeResponse> {
  return post<DescribeResponse>("/api/describe", { name, regenerate });
}

export function spell(name: string, regenerate = false): Promise<SpellResponse> {
  return post<SpellResponse>("/api/spell", { name, regenerate });
}

// The program crashed: Claude gets the error and writes a fixed version.
export function repairSpell(name: string, error: string): Promise<SpellResponse> {
  return post<SpellResponse>("/api/spell/repair", { name, error });
}

// What a new program's test run found. The answer is the program to use now:
// the same one, now live, or a rewrite to test in turn.
export function checkSpell(result: CheckRequest): Promise<SpellResponse> {
  return post<SpellResponse>("/api/spell/check", result);
}

// Which program each of these elements has now (rewrites, rollbacks).
// Spells from the shared library by name (3.7), for creatures and artifacts that cast them. Free.
export function libraryPrograms(names: string[]): Promise<{ spells: { key: string; name: string; tier: Tier; code: string; intents: string[] }[] }> {
  return post("/api/library", { names });
}

export function livePrograms(names: string[]): Promise<LiveResponse> {
  return post<LiveResponse>("/api/spells/live", { names });
}

export function recordCast(name: string, id: number): Promise<CastResponse> {
  return post<CastResponse>("/api/cast", { name, id });
}

export function vote(body: VoteRequest): Promise<VoteResponse> {
  return post<VoteResponse>("/api/vote", body);
}

// Admin only: every version of one element's program.
export async function programInfo(name: string): Promise<ProgramInfo[] | null> {
  try {
    const res = await fetch(`/api/spell/info?name=${encodeURIComponent(name)}`, { headers: authHeaders() });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// Admin only: this month's Claude calls.
export async function spend(): Promise<SpendResponse | null> {
  try {
    const res = await fetch("/api/spend", { headers: authHeaders() });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// A frame time summary from the HUD, so a session on a real phone can be read
// back as numbers. Failures are ignored: it is only a measurement.
export function sendPerf(sample: PerfSample): void {
  void fetch("/api/perf", {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(sample),
  }).catch(() => undefined);
}

export function setToken(token: string): void {
  store(TOKEN_KEY, token.trim());
}

// The Worker's view of this browser. A revoked link answers 403.
export async function health(): Promise<HealthResponse | null> {
  try {
    const res = await fetch("/api/health", { headers: authHeaders() });
    if (res.status === 403) {
      const data = (await res.json().catch(() => null)) as ApiError | null;
      onLockedOut("revoked", data?.error ?? "This invite link has been turned off.");
      return null;
    }
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError("No connection to the Worker");
  }

  const data = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok || !data) {
    const error = data as ApiError | null;
    const message = error?.error ?? `Request failed (${res.status})`;
    if (error?.code === "invite" || error?.code === "revoked") onLockedOut(error.code, message);
    throw new ApiRequestError(message, error?.code, res.status);
  }
  return data as T;
}

// Storage can be blocked (private modes): values then live for this page only.
const memory = new Map<string, string>();
function store(key: string, value: string): void {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // kept in memory
  }
}
function read(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

let sessionPlayer: string | null = null;

// An anonymous id for this browser, made up here: it says nothing about the
// player, it only lets the Worker count players and allow one vote each.
export function playerId(): string {
  try {
    let id = localStorage.getItem(PLAYER_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(PLAYER_KEY, id);
    }
    return id;
  } catch {
    sessionPlayer ??= crypto.randomUUID();
    return sessionPlayer;
  }
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "x-player": playerId() };
  const token = read(TOKEN_KEY);
  const invite = read(INVITE_KEY);
  if (token) headers["x-access-token"] = token;
  if (invite) headers["x-invite"] = invite;
  return headers;
}

// 3.7: challenges from nothing.
export interface ChallengeCard {
  id: string;
  title: string;
  brief: string;
  start: string[];
  minTier: Tier | null;
  live: boolean;
  par: number | null;
  best: { merges: number; name: string } | null;
  mine: number | null;
  stars: number;
}

export async function challenges(): Promise<{ challenges: ChallengeCard[] }> {
  const res = await fetch("/api/challenges", { headers: authHeaders() }).catch(() => null);
  if (!res?.ok) throw new ApiRequestError("The challenges could not be loaded");
  return res.json();
}

export function challengeWin(id: string, merges: number, spell: string): Promise<{ stars: number; par: number | null; best: boolean }> {
  return post("/api/challenge/win", { id, merges, spell });
}

// 3.7: the island's chronicle, written once a session (about $0.002).
export function chronicle(digest: unknown): Promise<{ text: string; mock: boolean }> {
  return post("/api/chronicle", { digest });
}

// 3.7: the trim of the library, for the admin, one pair at a time.
export interface Trim {
  id: number;
  kind: "duplicate" | "senseless";
  a: string;
  b: string;
  result: string | null;
  why: string;
  status: string;
}

export async function trims(): Promise<{ next: Trim | null; left: number } | null> {
  try {
    const res = await fetch("/api/admin/trims", { headers: authHeaders() });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export function decideTrim(id: number, approve: boolean): Promise<{ next: Trim | null; left: number }> {
  return post("/api/admin/trim", { id, approve });
}
