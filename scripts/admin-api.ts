// The game's admin API, for the runners in scripts/ that talk to a deployed
// Worker with MM_URL and MM_TOKEN (4.1, review L4: the helper was written four
// times, one of them with retries). A 5xx is tried again after 3 s, up to
// `retries` times; anything else, or a body that is not JSON, throws with the
// Worker's error.
export function adminApi(url: string, token: string, { retries = 0 } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON from the Worker, each runner reads it field by field
  return async function api<T = any>(path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(new URL(path, url), {
        method: body ? "POST" : "GET",
        headers: { "content-type": "application/json", "x-access-token": token },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
      if (res.ok && data !== null) return data;
      if (attempt >= retries || res.status < 500) throw new Error(`${path}: ${data?.error ?? res.status}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  };
}
