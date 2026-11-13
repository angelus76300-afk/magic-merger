// Dev only: the reaction checks of scripts/reactions-test.ts on their own, without the rest of npm test.
//   npx esbuild scripts/reactions-run.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/reactions-run.mjs --log-level=warning
//   node node_modules/.cache/reactions-run.mjs
import { Runtime } from "../src/sim/runtime";
import { reactionChecks } from "./reactions-test";

Runtime.slowMs = Infinity;
let failed = 0;
reactionChecks((name, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
});
console.log(failed ? `${failed} failed` : "all passed");
