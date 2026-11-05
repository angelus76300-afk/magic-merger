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

  // Claude names things: a player who finds a name offensive or wrong tells the admin.
  const report = d.querySelector<HTMLButtonElement>(".card-report")!;
  report.hidden = element.depth === 0 || session.admin || session.mock;
  report.disabled = false;
  report.textContent = "Report this name";
  report.onclick = () => {
    const reason = window.prompt(`What is wrong with the name "${element.name}"? (optional)`, "");
    if (reason === null) return;
    report.disabled = true;
    api
      .report(element.name, reason)
      .then(() => {
        report.textContent = "Reported, thank you";
        toast("Thanks: the admin will look at it");
      })
      .catch((err: unknown) => {
        report.disabled = false;
        toast(err instanceof Error ? err.message : "The report did not go through", "error");
      });
  };

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

  // View source: the program itself, for anyone curious how a spell works.
  const source = d.querySelector<HTMLElement>(".card-source")!;
  const sourceButton = d.querySelector<HTMLButtonElement>(".card-view-source")!;
  source.hidden = true;
  sourceButton.hidden = !program;
  sourceButton.textContent = "View source";
  sourceButton.setAttribute("aria-expanded", "false");
  sourceButton.onclick = () => {
    const current = store.spell(key);
    if (!current) return;
    const open = source.hidden;
    source.hidden = !open;
    sourceButton.textContent = open ? "Hide source" : "View source";
    sourceButton.setAttribute("aria-expanded", String(open));
    if (open) {
      source.querySelector(".card-source-meta")!.textContent = sourceMeta(current);
      source.querySelector("code")!.textContent = current.code;
    }
  };

  const admin = d.querySelector<HTMLElement>(".card-admin")!;
  admin.hidden = !session.admin;
  const written = d.querySelector<HTMLElement>(".card-written")!;
  written.textContent = writtenText(program);
  const versions = d.querySelector<HTMLElement>(".card-versions")!;
  versions.textContent = "";
  if (session.admin && program) {
    void api.programInfo(element.name).then((list) => {
      if (serial !== openSerial || !list) return;
      versions.textContent = list.map(versionText).join("\n");
    });
  }
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
        sourceButton.hidden = false;
        if (!source.hidden) source.querySelector("code")!.textContent = fresh.code;
      }
      toast(`${element.name} was rewritten`);
    } finally {
      newSpell.disabled = false;
      newSpell.textContent = label;
    }
  };

  d.showModal();
}

// Version, writer and summary above the code.
function sourceMeta(program: { version: number; model?: string; id?: number; summary: string }): string {
  const by = program.model ? ` by ${shortModel(program.model)}` : "";
  return `${program.id ? `Version #${program.id}, ` : ""}World API v${program.version}${by}. ${program.summary}`;
}

function shortModel(model: string): string {
  return model
    .replace(/^claude-/, "")
    .replace(/-\d.*$/, "")
    .replace(/^./, (c) => c.toUpperCase());
}

// One line per version for the admin: status, origin, votes, test run, judge.
function versionText(v: {
  id: number;
  status: string;
  origin: string;
  model: string;
  up: number;
  down: number;
  library: boolean;
  checked: unknown;
  judged: unknown;
}): string {
  const checked = v.checked as { ok?: boolean; problem?: string } | null;
  const judged = v.judged as { score?: number; reason?: string; alive?: string } | null;
  const parts = [`#${v.id} ${v.status}`, `${v.origin}, ${shortModel(v.model)}`, `${v.up} up ${v.down} down${v.library ? " (library)" : ""}`];
  if (checked) parts.push(checked.ok ? "test ok" : `test ${checked.problem ?? "failed"}`);
  if (judged) parts.push(`judge ${judged.score}/5 ${judged.reason}${judged.alive === "no" ? ", creatures not alive" : ""}`);
  return parts.join(" · ");
}

// "Written for API v3 by Haiku": tells the admin whether a rewrite could help.
function writtenText(program: { version: number; model?: string } | undefined): string {
  if (!program) return "No program yet";
  const by = program.model ? ` by ${shortModel(program.model)}` : "";
  const age = program.version < PROGRAM_VERSION ? ` (current API is v${PROGRAM_VERSION})` : "";
  return `Written for API v${program.version}${by}${age}`;
}

// Measured in November 2026: Haiku spells cost about $0.002, Opus ones $0.06.
function costHint(tier: Tier): string {
  return TIERS.indexOf(tier) > TIERS.indexOf("grand") ? "Opus writes it, about 8 cents." : "Haiku writes it, a fraction of a cent.";
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
    <button class="card-view-source" type="button">View source</button>
    <div class="card-source" hidden>
      <p class="card-source-meta"></p>
      <pre><code></code></pre>
    </div>
    <button class="card-report" type="button">Report this name</button>
    <div class="card-admin">
      <span class="card-admin-label">Admin</span>
      <span class="card-written"></span>
      <button class="card-new-description">New description</button>
      <button class="card-new-spell">Rewrite this spell</button>
      <pre class="card-versions"></pre>
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
