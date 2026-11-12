// The real Worker (wrangler dev, a fresh local D1, a stub Claude) serving the built game in dist/,
// for scripts that play it in a browser (scripts/watch-frames.mjs). Run `npm run build` first.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export async function startLocalGame() {
  const ROOT = resolve(new URL("..", import.meta.url).pathname);
  const ADMIN = "admin-local-game";
  const STATE = mkdtempSync(join(tmpdir(), "mm-local-"));
  const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost", WRANGLER_SEND_METRICS: "false", CI: "1" };
  let calls = 0;
  const stub = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const n = ++calls;
      const system = (JSON.parse(raw || "{}").system ?? []).map((b) => b.text).join("");
      let text;
      if (system.startsWith("You write the grimoire")) text = "A soft white cloud drifts over the island.";
      else if (system.includes("Say what this item promises")) text = JSON.stringify({ intents: ["other"] });
      else if (system.startsWith("You write the spells")) {
        // The four first elements land as themselves (fire burns, water floods, earth lays rock, air
        // blows), so a browser check can die by its own Fire; anything else is a patch of sand.
        const asked = JSON.stringify(JSON.parse(raw || "{}").messages ?? "");
        const own = {
          Fire: "w.ignite(w.x, w.y, 2.5);",
          Water: "w.flood(w.x, w.y, 2, 'water', 1);",
          Earth: "w.paint(w.x, w.y, 2, 'rock', 1);",
          Air: "w.wind(1, 0); w.flash('#dff', 0.2);",
        };
        const name = Object.keys(own).find((k) => new RegExp(`\\b${k}\\b`).test(asked));
        text = JSON.stringify({
          summary: "A flash.",
          code: `const spell = { *cast(w) { ${name ? own[name] : "w.flash('#fff', 0.2); w.paint(w.x, w.y, 2, 'sand', 1);"} } };`,
          missing: "",
        });
      } else text = JSON.stringify({ name: `Thing ${n}`, emoji: "✨", kind: "spell", tier: "minor" });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: `m${n}`,
          type: "message",
          role: "assistant",
          model: "stub",
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 100 },
        }),
      );
    });
  });
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  const migrate = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "magic-merger", "--local", "--persist-to", STATE], {
    env,
    encoding: "utf8",
    cwd: ROOT,
  });
  if (migrate.status !== 0) throw new Error(migrate.stderr || migrate.stdout);
  const port = 8950 + Math.floor(Math.random() * 19);
  const vars = {
    ANTHROPIC_API_KEY: "sk-test",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${stub.address().port}`,
    ADMIN_TOKEN: ADMIN,
    BUDGET_USD: "50",
    INVITE_CAP_USD: "5",
  };
  const dev = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "--port",
      String(port),
      "--ip",
      "127.0.0.1",
      "--persist-to",
      STATE,
      "--show-interactive-dev-session=false",
      "--log-level",
      "error",
      ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`]),
    ],
    { env, stdio: ["ignore", "inherit", "inherit"], detached: true, cwd: ROOT },
  );
  const BASE = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {
      // not up yet
    }
    if (i > 120) throw new Error("wrangler dev did not start");
    await new Promise((r) => setTimeout(r, 500));
  }
  return {
    BASE,
    ADMIN,
    stop() {
      try {
        process.kill(-dev.pid);
      } catch {
        // already gone
      }
      stub.close();
      rmSync(STATE, { recursive: true, force: true });
    },
  };
}
