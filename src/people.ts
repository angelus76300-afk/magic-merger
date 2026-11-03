import { credits } from "../shared/credits";
import type { PeopleResponse, PersonInfo } from "../shared/types";
import * as api from "./api";
import { toast } from "./toast";

// 3.4, admin only: who is invited, what each person spent this month, how
// many things they discovered, when they last came, and what is left of the
// month. Opened from the admin badge.

let dialog: HTMLDialogElement | null = null;

function ensureDialog(): HTMLDialogElement {
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.className = "card people";
  dialog.innerHTML = `
    <div class="card-head">
      <span class="card-emoji">🧙</span>
      <div><h2 class="card-name">People</h2><div class="card-meta people-month"></div></div>
      <button class="card-close" aria-label="Close">×</button>
    </div>
    <form class="people-new">
      <input name="name" placeholder="Name of the person" maxlength="40" autocomplete="off" required />
      <button type="submit">Create invite</button>
    </form>
    <div class="people-link" hidden>
      <p class="people-link-label"></p>
      <input class="people-link-url" readonly />
      <button type="button" class="people-copy">Copy link</button>
    </div>
    <div class="people-list"></div>
    <p class="people-others"></p>
    <div class="people-reports"></div>
    <div class="people-trims"></div>
    <p class="people-calls"></p>
  `;
  dialog.querySelector(".card-close")!.addEventListener("click", () => dialog!.close());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog!.close();
  });
  dialog.querySelector<HTMLFormElement>(".people-new")!.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = dialog!.querySelector<HTMLInputElement>(".people-new input")!;
    const name = input.value.trim();
    if (!name) return;
    void api
      .createInvite(name)
      .then((r) => {
        input.value = "";
        showLink(`Invite for ${r.name} (${credits(r.cap)} credits, $${r.cap}, a month). Send it to them only: whoever opens it plays as ${r.name}.`, r.link);
        void refresh();
      })
      .catch((err: unknown) => toast(err instanceof Error ? err.message : "Could not create the invite", "error"));
  });
  dialog.querySelector(".people-copy")!.addEventListener("click", () => {
    const url = dialog!.querySelector<HTMLInputElement>(".people-link-url")!;
    url.select();
    void navigator.clipboard?.writeText(url.value).then(
      () => toast("Link copied"),
      () => toast("Select the link and copy it by hand"),
    );
  });
  document.body.append(dialog);
  return dialog;
}

function showLink(label: string, link: string): void {
  const box = dialog!.querySelector<HTMLElement>(".people-link")!;
  box.hidden = false;
  box.querySelector(".people-link-label")!.textContent = label;
  box.querySelector<HTMLInputElement>(".people-link-url")!.value = link;
}

export function openPeople(callsByModel: string): void {
  const d = ensureDialog();
  d.querySelector<HTMLElement>(".people-link")!.hidden = true;
  d.querySelector(".people-calls")!.textContent = callsByModel ? `This month by call:\n${callsByModel}` : "";
  if (!d.open) d.showModal();
  void refresh();
}

async function refresh(): Promise<void> {
  const data = await api.people();
  if (!data || !dialog) return;
  render(data);
  renderTrim(await api.trims());
}

// The trim of the library (3.7): near duplicates and senseless merges, one
// at a time. Approve a duplicate and it becomes an alias of the kept item
// (nothing is deleted); approve a senseless merge and its pair is asked again.
function renderTrim(t: { next: api.Trim | null; left: number } | null): void {
  const box = dialog!.querySelector<HTMLElement>(".people-trims")!;
  box.textContent = "";
  if (!t?.next) return;
  const n = t.next;
  const title = document.createElement("h3");
  title.textContent = `Tidy the library (${t.left} to decide)`;
  const what = document.createElement("p");
  what.textContent =
    n.kind === "duplicate"
      ? `${n.b} looks like a duplicate of ${n.a}: ${n.why}. Approve: ${n.b} becomes another name for ${n.a}, everywhere.`
      : `${n.a} + ${n.b} = ${n.result ?? "?"} makes no sense: ${n.why}. Approve: the pair is asked again on its next merge; ${n.result ?? "the old result"} stays in inventories.`;
  const yes = document.createElement("button");
  yes.textContent = "Approve";
  const no = document.createElement("button");
  no.textContent = "Leave it";
  const decide = (approve: boolean) =>
    void api.decideTrim(n.id, approve).then(renderTrim, (err: unknown) => toast(err instanceof Error ? err.message : "Could not decide", "error"));
  yes.onclick = () => decide(true);
  no.onclick = () => decide(false);
  box.append(title, what, yes, no);
}

function render(data: PeopleResponse): void {
  const d = dialog!;
  d.querySelector(".people-month")!.textContent =
    `${usd(data.spent)} spent${data.held ? `, ${usd(data.held)} held by calls running` : ""}: ${usd(data.left)} left of $${data.budget}`;
  const list = d.querySelector<HTMLElement>(".people-list")!;
  list.textContent = "";
  if (!data.people.length) list.textContent = "Nobody invited yet.";
  for (const p of data.people) list.append(row(p));
  d.querySelector(".people-others")!.textContent = data.others.length
    ? `Not from an invite: ${data.others.map((o) => `${o.who} ${usd(o.spent)}`).join(", ")}`
    : "";
  const reports = d.querySelector<HTMLElement>(".people-reports")!;
  reports.textContent = "";
  if (data.reports.length) {
    const title = document.createElement("h3");
    title.textContent = "Reported names";
    reports.append(title);
  }
  for (const r of data.reports) {
    const line = document.createElement("div");
    line.className = "people-report";
    const text = document.createElement("span");
    text.textContent = `${r.name}${r.reason ? `: "${r.reason}"` : ""} (${r.by ?? "admin"}, ${ago(r.at)})`;
    const dismiss = document.createElement("button");
    dismiss.textContent = "Dismiss";
    dismiss.onclick = () => void api.closeReport(r.id).then(refresh);
    line.append(text, dismiss);
    reports.append(line);
  }
}

function row(p: PersonInfo): HTMLElement {
  const el = document.createElement("div");
  el.className = `people-row people-${p.status}`;
  const allowance = p.cap + p.topup;
  const info = document.createElement("div");
  info.className = "people-info";
  const name = document.createElement("strong");
  name.textContent = p.name;
  const facts = document.createElement("span");
  const status = p.status === "active" ? "" : ` · ${p.status}`;
  const account = p.deletedAt ? " · account deleted" : p.claimedAt ? " · account" : "";
  const refused = p.refusals ? ` · ${p.refusals} refused by the bug guard` : "";
  const found = `${p.discoveries} ${p.discoveries === 1 ? "discovery" : "discoveries"}`;
  facts.textContent = `${usd(p.spent)} of ${usd(allowance)} (${credits(p.spent)} of ${credits(allowance)} credits) · ${found} · ${p.lastSeen ? `seen ${ago(p.lastSeen)}` : "never came"}${status}${account}${refused}`;
  const bar = document.createElement("span");
  bar.className = "people-bar";
  bar.style.setProperty("--used", `${Math.min(100, (p.spent / Math.max(0.01, allowance)) * 100)}%`);
  info.append(name, facts, bar);
  el.append(info);
  if (p.status === "revoked") return el;

  const actions = document.createElement("div");
  actions.className = "people-actions";
  const act = (label: string, fn: () => Promise<unknown>) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => {
      b.disabled = true;
      void fn()
        .then(refresh)
        .catch((err: unknown) => toast(err instanceof Error ? err.message : "That did not work", "error"))
        .finally(() => (b.disabled = false));
    };
    actions.append(b);
  };
  act(p.status === "paused" ? "Resume" : "Pause", () => api.changeInvite(p.id, p.status === "paused" ? "resume" : "pause"));
  act("Top up", async () => {
    const usd = Number(window.prompt(`Credits to add to ${p.name}'s magic for this month (100 credits = $1):`, "500")) / 100;
    if (usd > 0) await api.changeInvite(p.id, "topup", usd);
  });
  act("New link", async () => {
    const claimed = !!p.claimedAt;
    if (
      !window.confirm(
        claimed
          ? `Make a sign in link for ${p.name}? It signs their account in once, on the device that opens it.`
          : `Make a new link for ${p.name}? The old one stops working at once.`,
      )
    )
      return;
    const r = await api.changeInvite(p.id, "relink");
    if (r.link) showLink(claimed ? `Sign in link for ${p.name}: it works once, then dies.` : `New link for ${p.name}. The old one no longer works.`, r.link);
  });
  act("Revoke", async () => {
    if (!window.confirm(`Revoke ${p.name}'s invite for good? Their link stops working; what they discovered stays.`)) return;
    await api.changeInvite(p.id, "revoke");
  });
  el.append(actions);
  return el;
}

// Cents, or a tenth of a cent under ten cents: a merge costs $0.001.
function usd(v: number): string {
  return v > 0 && v < 0.1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`;
}

export function ago(at: number): string {
  const s = (Date.now() - at) / 1000;
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
