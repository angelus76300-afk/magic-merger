import { defineConfig } from "vite";

// `npm run dev` serves the frontend with hot reload and forwards /api to
// `wrangler dev`, which must run alongside it (see docs/SETUP.md).
export default defineConfig({
  server: {
    proxy: { "/api": "http://localhost:8787" },
  },
});
