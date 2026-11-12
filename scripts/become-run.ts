// Runs the become checks alone (scripts/become-test.ts), as npm test runs them inside sim-test:
// npx esbuild scripts/become-run.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/become-run.mjs && node node_modules/.cache/become-run.mjs
import { becomeChecks } from "./become-test";

let failures = 0;
becomeChecks((name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
});
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
