// Only the props checks of npm test (scripts/props-test.ts), for a quick run while working on looks.
//   npx esbuild scripts/props-only.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/props-only.mjs && node node_modules/.cache/props-only.mjs
import { propChecks } from "./props-test";

let failed = 0;
propChecks((name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
});
console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exitCode = 1;
