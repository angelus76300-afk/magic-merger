// Checks for the one spell rewrite tool (scripts/rewrite-one.mjs): one name and a reason, never a
// list, and nothing past 80% of the month's budget.
import { allowedBySpend, checkArgs } from "./rewrite-one.mjs";

let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed++;
};
check("a name and a reason", checkArgs(["Frost Nova", "its thaw burns the village"])?.name === "Frost Nova");
check("no reason is refused", checkArgs(["Frost Nova"]) === null);
check("two names are refused", checkArgs(["Frost Nova", "why", "Light"]) === null);
check("a comma list is refused", checkArgs(["Frost Nova, Light", "why"]) === null);
check("a semicolon list is refused", checkArgs(["Frost Nova; Light", "why"]) === null);
check("a blank name is refused", checkArgs(["  ", "why"]) === null);
check("spend under 80% is allowed", allowedBySpend({ month: 15.7, budget: 48 }));
check("exactly 80% is allowed", allowedBySpend({ month: 38.4, budget: 48 }));
check("over 80% is refused", !allowedBySpend({ month: 38.5, budget: 48 }));
check("an unknown budget is refused", !allowedBySpend({ month: 1 }) && !allowedBySpend(null) && !allowedBySpend({ month: "1", budget: 48 }));
console.log(failed ? `${failed} failed` : "all rewrite-one checks passed");
process.exit(failed ? 1 : 0);
