import type {
  ApiError,
  CastResponse,
  CheckRequest,
  DescribeResponse,
  HealthResponse,
  LiveResponse,
  MergeResponse,
  PerfSample,
  ProgramInfo,
  SpellResponse,
  SpendResponse,
  VoteRequest,
  VoteResponse,
} from "../shared/types";

const TOKEN_KEY = "magic-merger.token";
const PLAYER_KEY = "magic-merger.player";

export class ApiRequestError extends Error {}

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
  try {
    localStorage.setItem(TOKEN_KEY, token.trim());
  } catch {
    sessionToken = token.trim();
  }
}

export async function health(): Promise<HealthResponse | null> {
  try {
    const res = await fetch("/api/health", { headers: authHeaders() });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function post<T>(path: string, body: unknown, retried = false): Promise<T> {
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

  // The Worker can be locked with ACCESS_TOKEN. Ask once, then remember it.
  if (res.status === 401 && !retried) {
    const token = window.prompt("Access token for this Magic Merger server:");
    if (token) {
      setToken(token);
      return post<T>(path, body, true);
    }
  }

  const data = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok || !data) {
    throw new ApiRequestError((data as ApiError | null)?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

let sessionToken: string | null = null;
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
  let token = sessionToken;
  try {
    token = localStorage.getItem(TOKEN_KEY) ?? token;
  } catch {
    // Storage blocked: fall back to the in-memory token.
  }
  const headers: Record<string, string> = { "x-player": playerId() };
  if (token) headers["x-access-token"] = token;
  return headers;
}
