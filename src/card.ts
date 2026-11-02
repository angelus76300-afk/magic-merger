import { PROGRAM_VERSION } from "../shared/version";
import { TIERS, TIER_LABEL, tierFromDepth, type Tier } from "../shared/tiers";
import * as api from "./api";
import { session } from "./session";
import type { Store } from "./store";
import { toast } from "./toast";

let dialog: HTMLDialogElement | null = null;
// Each opening gets a number, so a slow answer never lands on the wrong card.
let openSerial = 0;

export interface CardActions {
  // Switches to the World tab with this spell ready to cast.
  cast(key: string): void;
  // Admin only: writes this one spell again from scratch.
  regenerateSpell(key: string): Promise<void>;
}

let actions: CardActions | null = null;

export function setCardActions(a: CardActions): void {
  actions = a;
}

// The spell card: what an element is, how it was made, and for spells the
// button that sends it to the World tab.
// `first` marks a first discovery ever: the card opens with a little ceremony.
export function openCard(store: Store, key: string, first = false): void {
  const discovery = store.get(key);
  if (!discovery) return;
  const { element, recipe } = discovery;
  const serial = ++openSerial;
  const d = ensureDialog();

  d.classList.toggle("card-first", first);
  d.querySelector(".card-emoji")!.textContent = element.emoji;
  d.querySelector(".card-name")!.textContent = element.name;
  const kind = d.querySelector<HTMLElement>(".card-kind")!;
  kind.textContent = element.kind;
  kind.dataset.kind = element.kind;
  const tier = TIER_LABEL[element.tier ?? tierFromDepth(element.depth)];
  d.querySelector(".card-depth")!.textContent = element.depth === 0 ? `Primal force · ${tier}` : `${tier} · depth ${element.depth}`;
  d.querySelector(".card-recipe")!.textContent = recipe ? `${recipe[0]} + ${recipe[1]}` : "One of the eight primal forces";

  const isSpell = element.kind === "spell";
  const summary = d.querySelector<HTMLElement>(".card-summary")!;
  const program = store.spell(key);
  summary.hidden = !program?.summary;
  summary.textContent = program?.summary ?? "";

  const cast = d.querySelector<HTMLButtonElement>(".card-cast")!;
  cast.textContent = isSpell ? "Cast in the World" : "Place in the World";
  cast.onclick = () => {
    d.close();
    actions?.cast(key);
  };

  const text = d.querySelector<HTMLElement>(".card-description")!;
  const showDescription = (regenerate: boolean) => {
    text.textContent = regenerate ? "Rewriting the grimoire…" : "Reading the grimoire…";
    text.classList.add("loading");
    api
      .describe(element.name, regenerate)
      .then((res) => {
        if (!res.mock) store.setDescription(key, res.description);
        if (serial !== openSerial) return;
        text.textContent = res.description;
        text.classList.remove("loading");
      })
      .catch((err: unknown) => {
        if (serial !== openSerial) return;
        text.textContent = err instanceof Error ? err.message : "The grimoire is unreadable right now.";
        text.classList.remove("loading");
      });
  };
  const cached = store.description(key);
  if (cached) {
    text.textContent = cached;
    text.classList.remove("loading");
  } else showDescription(false);

  const admin = d.querySelector<HTMLElement>(".card-admin")!;
  admin.hidden = !session.admin;
  const written = d.querySelector<HTMLElement>(".card-written")!;
  written.textContent = writtenText(program);
  d.querySelector<HTMLButtonElement>(".card-new-description")!.onclick = () => showDescription(true);
  // The only way a stored spell is ever written again: one at a time, by the
  // admin, after seeing what it costs. A version bump never does it.
  const label = isSpell ? "Rewrite this spell" : "Rewrite this artifact";
  const newSpell = d.querySelector<HTMLButtonElement>(".card-new-spell")!;
  newSpell.textContent = label;
  newSpell.onclick = async () => {
    const elementTier = element.tier ?? tierFromDepth(element.depth);
    if (!window.confirm(`Write ${element.name} again? ${costHint(elementTier)} The current program is replaced.`)) return;
    newSpell.disabled = true;
    newSpell.textContent = "Writing…";
    try {
      await actions?.regenerateSpell(key);
      const fresh = store.spell(key);
      if (serial === openSerial && fresh) {
        summary.hidden = false;
        summary.textContent = fresh.summary;
        written.textContent = writtenText(fresh);
      }
      toast(`${element.name} was rewritten`);
    } finally {
      newSpell.disabled = false;
      newSpell.textContent = label;
    }
  };

  d.showModal();
}

// "Written for API v3 by Haiku": tells the admin whether a rewrite could help.
function writtenText(program: { version: number; model?: string } | undefined): string {
  if (!program) return "No program yet";
  const by = program.model ? ` by ${program.model.replace(/^claude-/, "").replace(/-\d.*$/, "").replace(/^./, (c) => c.toUpperCase())}` : "";
  const age = program.version < PROGRAM_VERSION ? ` (current API is v${PROGRAM_VERSION})` : "";
  return `Written for API v${program.version}${by}${age}`;
}

// Measured in November 2026: Haiku spells cost about $0.002, Opus ones $0.06.
function costHint(tier: Tier): string {
  return TIERS.indexOf(tier) > TIERS.indexOf("grand") ? "Opus writes it, about 6 cents." : "Haiku writes it, a fraction of a cent.";
}

function ensureDialog(): HTMLDialogElement {
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.className = "card";
  dialog.innerHTML = `
    <p class="card-ribbon">First discovery! No one had ever made this.</p>
    <div class="card-head">
      <span class="card-emoji"></span>
      <div>
        <h2 class="card-name"></h2>
        <div class="card-meta"><span class="card-kind"></span><span class="card-depth"></span></div>
      </div>
      <button class="card-close" aria-label="Close">×</button>
    </div>
    <p class="card-recipe"></p>
    <p class="card-description"></p>
    <p class="card-summary"></p>
    <button class="card-cast">Cast in the World</button>
    <div class="card-admin">
      <span class="card-admin-label">Admin</span>
      <span class="card-written"></span>
      <button class="card-new-description">New description</button>
      <button class="card-new-spell">Rewrite this spell</button>
    </div>
  `;
  dialog.querySelector(".card-close")!.addEventListener("click", () => dialog!.close());
  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog!.close();
  });
  document.body.append(dialog);
  return dialog;
}
