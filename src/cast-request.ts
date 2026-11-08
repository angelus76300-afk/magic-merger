import { formOf, isForm } from "../shared/forms";
import type { SpellProgram } from "../shared/spellcode";
import { tierFromDepth } from "../shared/tiers";
import type { GameElement } from "../shared/types";
import type { CastRequest } from "./sim/runtime";

// What the World is sent to cast a stored program. 4.7 item 2: it carries
// the item's form, which sets its reach on this island (runtime.ts,
// castReach): the form its program was written and tested as, else the
// element's own. Before, a cast carried only key, name, tier and code, so
// every item was drawn at the island's scale instead of its test run's.
export function castRequest(key: string, element: Pick<GameElement, "name" | "kind" | "form" | "tier" | "depth">, program: SpellProgram): CastRequest {
  const form = isForm(program.form) ? program.form : formOf(element);
  return { key, name: element.name, tier: element.tier ?? tierFromDepth(element.depth), code: program.code, form, giant: program.giant === true };
}
