import type { HealthResponse } from "../shared/types";

// 3.4: what a friend sees first. One paragraph on the game, a short privacy
// note, and, without a valid link, a page that says the game is invite only.

const WELCOMED_KEY = "magic-merger.welcomed";

const WELCOME = `Magic Merger is a game about combining magic. You start with eight primal forces: drop one onto another and something new appears. Claude, an AI by Anthropic, decides what each pair makes the first time anyone tries it, and that answer is then kept for everyone, so the recipe book is shared with the friends who play too. Every spell can be cast on a floating island in the World tab, where tiny villagers live: Claude writes each spell there as a small program the first time someone picks it, so nobody hand-made what you will see. After a cast you can say whether it was good; spells voted down get written again.`;

const PRIVACY = `Privacy: everyone plays with their own link, which the game knows by the name the person who invited them gave it. It keeps what you discover, cast and vote, when you last played and what your magic cost, to share discoveries and stay within the monthly budget. The names of the items you merge are sent to Claude through Anthropic's API; nothing about you is. Cloudflare, which hosts the game, keeps ordinary request logs for a few days. No ads, no tracking, no cookies: your browser only keeps your link and your progress. To have your data deleted, ask the person who invited you.`;

let dialog: HTMLDialogElement | null = null;

function ensureDialog(): HTMLDialogElement {
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.className = "card welcome";
  dialog.innerHTML = `
    <div class="card-head">
      <span class="card-emoji">✨</span>
      <div><h2 class="card-name">Welcome to Magic Merger</h2></div>
      <button class="card-close" aria-label="Close">×</button>
    </div>
    <p class="welcome-text"></p>
    <p class="welcome-month" hidden></p>
    <button class="card-cast welcome-start">Start playing</button>
    <p class="welcome-privacy"></p>
  `;
  dialog.querySelector(".welcome-text")!.textContent = WELCOME;
  dialog.querySelector(".welcome-privacy")!.textContent = PRIVACY;
  const close = () => {
    try {
      localStorage.setItem(WELCOMED_KEY, "1");
    } catch {
      // shown again next time, no harm
    }
    dialog!.close();
  };
  dialog.querySelector(".card-close")!.addEventListener("click", close);
  dialog.querySelector(".welcome-start")!.addEventListener("click", close);
  dialog.addEventListener("cancel", close);
  document.body.append(dialog);
  return dialog;
}

// The welcome, with this month's magic when the Worker said it.
export function showWelcome(status: HealthResponse | null): void {
  const d = ensureDialog();
  const month = d.querySelector<HTMLElement>(".welcome-month")!;
  const invite = status?.invite;
  month.hidden = !invite;
  if (invite) {
    const left = Math.max(0, invite.cap - invite.spent);
    month.textContent =
      invite.status === "paused"
        ? `Hello ${invite.name}. Your invite is paused for now: everything already discovered still works.`
        : `Hello ${invite.name}. Your magic this month: $${left.toFixed(2)} left of $${invite.cap.toFixed(2)}. New merges and new spells use it; anything already in the shared library is free.`;
  }
  if (!d.open) d.showModal();
}

export function welcomedBefore(): boolean {
  try {
    return localStorage.getItem(WELCOMED_KEY) === "1";
  } catch {
    return false;
  }
}

// No valid link: the game stays behind this page. The title still takes five
// taps for the admin.
export function showGate(code: "invite" | "revoked", message: string): void {
  let gate = document.getElementById("gate");
  if (!gate) {
    gate = document.createElement("section");
    gate.id = "gate";
    gate.className = "gate";
    gate.innerHTML = `<div class="gate-box"><p class="gate-emoji">🔮</p><h2>Magic Merger is invite only</h2><p class="gate-text"></p><p class="gate-privacy"></p></div>`;
    document.querySelector(".topbar")!.after(gate);
  }
  gate.querySelector(".gate-text")!.textContent =
    code === "revoked"
      ? `${message} If you think it is a mistake, ask the person who invited you.`
      : "Ask the person who told you about it for your own link, then open it on this device.";
  gate.querySelector(".gate-privacy")!.textContent = PRIVACY;
  gate.hidden = false;
  for (const view of document.querySelectorAll<HTMLElement>(".view")) view.hidden = true;
  document.querySelector<HTMLElement>(".tabs")!.hidden = true;
}

export function hideGate(): void {
  const gate = document.getElementById("gate");
  if (!gate || gate.hidden) return;
  gate.hidden = true;
  document.querySelector<HTMLElement>(".tabs")!.hidden = false;
}
