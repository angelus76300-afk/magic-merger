import { defineConfig } from "vite";

// `npm run dev` serves the frontend with hot reload and forwards /api to
// `wrangler dev`, which must run alongside it (see docs/SETUP.md).
// Three pages: the game, world.html which runs inside a sandboxed iframe, and
// check.html, another sandboxed iframe where new programs get their test run.
export default defineConfig({
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
