import { credits } from "../shared/credits";
import type { HealthResponse } from "../shared/types";
import { toast } from "./toast";

// 3.4: what a friend sees first. One paragraph on the game, a short privacy
// note, and, without a valid link, a page that says the game is invite only.

const WELCOMED_KEY = "magic-merger.welcomed";

const WELCOME = `Magic Merger is a game about combining magic. You start with eight primal forces: drop one onto another and something new appears. Claude, an AI by Anthropic, decides what each pair makes the first time anyone tries it, and that answer is then kept for everyone, so the recipe book is shared with the friends who play too. Every spell can be cast on a floating island in the World tab, where tiny villagers live: Claude writes each spell there as a small program the first time someone picks it, so nobody hand-made what you will see. After a cast you can say whether it was good; spells voted down get written again.`;

const PRIVACY = `Privacy: everyone plays with their own link, which the game knows by the name the person who invited them gave it. It keeps what you discover, cast and vote, when you last played and how many credits your magic used, to share discoveries and keep the game within its monthly limit. With an account (a passkey, no password) it also keeps your discoveries, your board and your island on the server so you can play from any device, the public half of each passkey, and which devices are signed in; an email address only if you give one for sign in links. Ideas you post in the Ideas tab are shown with your name to everyone invited; if one is picked, its text, without your name, is copied to the game's page on GitHub. The names of the items you merge are sent to Claude through Anthropic's API; nothing about you is. Cloudflare, which hosts the game, keeps ordinary request logs for a few days. No ads, no tracking, no cookies: your browser keeps your link or your session and your progress. From the account page you can export everything or delete it; without an account, ask the person who invited you.`;

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
    <button class="welcome-account" hidden>Your account</button>
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

// The welcome, with this month's magic when the Worker said it, and the
// account page when this device is signed in (4.0).
export function showWelcome(status: HealthResponse | null, account: (() => Promise<void>) | null = null): HTMLDialogElement {
  const d = ensureDialog();
  const button = d.querySelector<HTMLButtonElement>(".welcome-account")!;
  button.hidden = !account;
  button.onclick = () => {
    d.close();
    void account?.();
  };
  const month = d.querySelector<HTMLElement>(".welcome-month")!;
  const invite = status?.invite;
  month.hidden = !invite;
  if (invite) {
    const left = Math.max(0, invite.cap - invite.spent);
    month.textContent =
      invite.status === "paused"
        ? `Hello ${invite.name}. Your invite is paused for now: everything already discovered still works.`
        : `Hello ${invite.name}. Your magic this month: ${credits(left)} credits left of ${credits(invite.cap)}. Only new discoveries and new spells use credits; anything already in the shared library is free.`;
  }
  if (!d.open) d.showModal();
  return d;
}

export function welcomedBefore(): boolean {
  try {
    return localStorage.getItem(WELCOMED_KEY) === "1";
  } catch {
    return false;
  }
}

// No valid link: the game stays behind this page. The title still takes five
// taps for the admin. With an account (4.0) a passkey signs in from here,
// or a one use link by email, when the Worker can send one.
export interface GateActions {
  signIn: () => Promise<boolean>;
  // Null when the Worker cannot send sign in links by email: the form is hidden.
  emailLink: ((email: string) => Promise<unknown>) | null;
}

export function showGate(code: "invite" | "revoked", message: string, actions: GateActions | null = null): void {
  let gate = document.getElementById("gate");
  if (!gate) {
    gate = document.createElement("section");
    gate.id = "gate";
    gate.className = "gate";
    gate.innerHTML = `<div class="gate-box"><p class="gate-emoji">🔮</p><h2>Magic Merger is invite only</h2><p class="gate-text"></p><div class="gate-signin" hidden><button class="card-cast gate-passkey">Sign in with a passkey</button><form class="gate-email"><input type="email" name="email" placeholder="Or your email, for a sign in link" autocomplete="email" /><button type="submit">Send</button></form></div><p class="gate-privacy"></p></div>`;
    document.querySelector(".topbar")!.after(gate);
  }
  gate.querySelector(".gate-text")!.textContent =
    code === "revoked"
      ? `${message} If you think it is a mistake, ask the person who invited you.`
      : "Ask the person who told you about it for your own link, then open it on this device. Already playing on another device? Sign in below.";
  const box = gate.querySelector<HTMLElement>(".gate-signin")!;
  box.hidden = !actions;
  if (actions) {
    gate.querySelector<HTMLButtonElement>(".gate-passkey")!.onclick = () => void actions.signIn();
    const form = gate.querySelector<HTMLFormElement>(".gate-email")!;
    form.hidden = !actions.emailLink;
    form.onsubmit = (e) => {
      e.preventDefault();
      const input = form.querySelector<HTMLInputElement>("input")!;
      if (!input.value || !actions.emailLink) return;
      void actions.emailLink(input.value).then(
        () => toast("If that address belongs to an account, a link is on its way. It works once, for 20 minutes."),
        (err: unknown) => toast(err instanceof Error ? err.message : "The link could not be sent", "error"),
      );
    };
  }
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
