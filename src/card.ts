import * as api from "./api";
import type { Store } from "./store";

let dialog: HTMLDialogElement | null = null;
// Each opening gets a number, so a slow description never lands on the wrong card.
let openSerial = 0;

// The spell card: what an element is, how it was made, and (from v1) the button
// that turns a spell into something castable in the World tab.
export function openCard(store: Store, key: string): void {
  const discovery = store.get(key);
  if (!discovery) return;
  const { element, recipe } = discovery;
  const serial = ++openSerial;
  const d = ensureDialog();

  d.querySelector(".card-emoji")!.textContent = element.emoji;
  d.querySelector(".card-name")!.textContent = element.name;
  const kind = d.querySelector<HTMLElement>(".card-kind")!;
  kind.textContent = element.kind;
  kind.dataset.kind = element.kind;
  d.querySelector(".card-depth")!.textContent = element.depth === 0 ? "Primal force" : `Depth ${element.depth}`;
  d.querySelector(".card-recipe")!.textContent = recipe ? `${recipe[0]} + ${recipe[1]}` : "One of the eight primal forces";

  const cast = d.querySelector<HTMLButtonElement>(".card-cast")!;
  cast.hidden = element.kind !== "spell";

  const text = d.querySelector<HTMLElement>(".card-description")!;
  const cached = store.description(key);
  if (cached) {
    text.textContent = cached;
    text.classList.remove("loading");
  } else {
    text.textContent = "Reading the grimoire…";
    text.classList.add("loading");
    api
      .describe(element.name)
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
  }

  d.showModal();
}

function ensureDialog(): HTMLDialogElement {
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.className = "card";
  dialog.innerHTML = `
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
    <button class="card-cast" disabled>Cast in the World (coming in v1)</button>
  `;
  dialog.querySelector(".card-close")!.addEventListener("click", () => dialog!.close());
  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog!.close();
  });
  document.body.append(dialog);
  return dialog;
}
