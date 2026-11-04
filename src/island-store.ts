// Where this browser keeps the player's island (4.0), and since 4.4 how: a
// save past GZIP_FROM characters is kept gzipped, so a huge or giant island
// (2.5M characters of JSON, 0.6M gzipped) fits beside the discoveries. Both
// forms are read back; the account's copy is always gzipped (sync.ts).

export const WORLD_KEY = "magic-merger.world2";
export const WORLD_AT_KEY = "magic-merger.world2.at";
const GZ = "gz:";
export const GZIP_FROM = 400_000;

export async function gzip(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function gunzip(b64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

function stored(): string | null {
  try {
    return localStorage.getItem(WORLD_KEY);
  } catch {
    return null;
  }
}

export function hasIsland(): boolean {
  return !!stored();
}

// The island's JSON, unpacked if it was kept gzipped.
export async function readIslandText(): Promise<string | null> {
  const raw = stored();
  if (!raw) return null;
  try {
    return raw.startsWith(GZ) ? await gunzip(raw.slice(GZ.length)) : raw;
  } catch {
    return null;
  }
}

// The island as the account keeps it: gzipped, base64.
export async function readIslandGz(): Promise<string | null> {
  const raw = stored();
  if (!raw) return null;
  return raw.startsWith(GZ) ? raw.slice(GZ.length) : gzip(raw);
}

// What to store for a save: itself, or gzipped when big.
export async function packIsland(json: string): Promise<string> {
  return json.length > GZIP_FROM ? GZ + (await gzip(json)) : json;
}

// The account's island, kept as it came (throws when storage is full).
export function storeIslandGz(gz: string, at: number): void {
  localStorage.setItem(WORLD_KEY, GZ + gz);
  localStorage.setItem(WORLD_AT_KEY, String(at));
}
