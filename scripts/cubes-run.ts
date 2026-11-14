// Runs the cubes checks alone (they are part of npm test):
//   npx esbuild scripts/cubes-run.ts --bundle --platform=node --format=esm --outfile=/tmp/cr.mjs && node /tmp/cr.mjs
import { cubesChecks } from "./cubes-test";

let failed = 0;
cubesChecks((name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
});
process.exit(failed ? 1 : 0);
