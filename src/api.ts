import type { ApiError, DescribeResponse, MergeResponse } from "../shared/types";

const TOKEN_KEY = "magic-merger.token";

export class ApiRequestError extends Error {}

export function merge(a: string, b: string): Promise<MergeResponse> {
  return post<MergeResponse>("/api/merge", { a, b });
}

export function describe(name: string): Promise<DescribeResponse> {
  return post<DescribeResponse>("/api/describe", { name });
}

export async function health(): Promise<{ ok: boolean; mock: boolean } | null> {
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
      try {
        localStorage.setItem(TOKEN_KEY, token.trim());
      } catch {
        sessionToken = token.trim();
      }
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

function authHeaders(): Record<string, string> {
  let token = sessionToken;
  try {
    token = localStorage.getItem(TOKEN_KEY) ?? token;
  } catch {
    // Storage blocked: fall back to the in-memory token.
  }
  return token ? { "x-access-token": token } : {};
}
