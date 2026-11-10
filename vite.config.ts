import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { joinChangelog } from "./shared/changelog";

// 2026-11-08: public/changelog.json plus one file per pull request in changelog.d/ (shared/changelog.ts).
const CHANGELOG_DIR = "changelog.d";
function changelog(): string {
  const base = JSON.parse(readFileSync("public/changelog.json", "utf8"));
  const parts = existsSync(CHANGELOG_DIR)
    ? readdirSync(CHANGELOG_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((name) => ({ name, text: readFileSync(join(CHANGELOG_DIR, name), "utf8") }))
    : [];
  return JSON.stringify(joinChangelog(base, parts), null, 2) + "\n";
}
const joinedChangelog = (): Plugin => {
  let outDir = "dist";
  return {
    name: "mm-changelog",
    configResolved(c) {
      outDir = c.build.outDir;
    },
    // Fail the build on a broken part, before anything is written.
    buildStart() {
      changelog();
    },
    // After public/ is copied: the joined file replaces its copy.
    closeBundle() {
      writeFileSync(join(outDir, "changelog.json"), changelog());
    },
    configureServer(server) {
      server.middlewares.use("/changelog.json", (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(changelog());
      });
    },
  };
};

// `npm run dev` serves the frontend with hot reload and forwards /api to
// `wrangler dev`, which must run alongside it (see docs/SETUP.md).
// Three pages: the game, world.html which runs inside a sandboxed iframe, and
// check.html, another sandboxed iframe where new programs get their test run.
export default defineConfig({
  plugins: [joinedChangelog()],
  server: {
    proxy: { "/api": "http://localhost:8787" },
    // The sandboxed world iframe has no origin, so its module requests carry
    // `Origin: null` and need CORS, in dev as in production (public/_headers).
    cors: true,
  },
  build: {
    rollupOptions: {
      input: { main: "index.html", world: "world.html", check: "check.html" },
    },
  },
});
