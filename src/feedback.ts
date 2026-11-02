import { BODY_MAX, BRIEF_MAX, STATUS_LABEL, TITLE_MAX, type FeedbackResponse, type Suggestion } from "../shared/feedback";
import * as api from "./api";
import { ago } from "./people";
import { session } from "./session";
import { toast } from "./toast";

// 3.4.1, the Feedback tab: post an idea, vote for others, see what became of
// each one. The admin also gets Send to Claude (an editable brief), Decline,
// Reopen and Delete, and the link to the Claude Code session working on it.

let root: HTMLElement | null = null;
let sendDialog: HTMLDialogElement | null = null;
let current: Suggestion | null = null;

function ensureRoot(): HTMLElement {
  if (root) return root;
  root = document.getElementById("feedback-view")!;
  root.innerHTML = `
    <div class="feedback-inner">
      <form class="feedback-new">
        <h2>Ideas and bugs</h2>
        <input name="title" maxlength="${TITLE_MAX}" placeholder="Your idea in a few words" autocomplete="off" required />
        <textarea name="body" maxlength="${BODY_MAX}" rows="3" placeholder="What should change, and why? For a bug: what you did, and what happened."></textarea>
        <div class="feedback-new-foot">
          <p class="feedback-hint">Everyone invited sees ideas and can vote. If one is picked, Claude builds it, and its text (not your name) goes on the game's GitHub page.</p>
          <button type="submit">Post</button>
        </div>
      </form>
      <div class="feedback-admin" hidden></div>
      <div class="feedback-list"><p class="feedback-empty">Loading ideas...</p></div>
    </div>
  `;
  const form = root.querySelector<HTMLFormElement>(".feedback-new")!;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = form.querySelector<HTMLInputElement>("input")!;
    const body = form.querySelector<HTMLTextAreaElement>("textarea")!;
    if (!title.value.trim()) return;
    const button = form.querySelector<HTMLButtonElement>("button")!;
    button.disabled = true;
    void api
      .postIdea(title.value, body.value)
      .then(() => {
        title.value = "";
        body.value = "";
        toast("Idea posted");
        return refresh();
      })
      .catch((err: unknown) => toast(err instanceof Error ? err.message : "Could not post the idea", "error"))
      .finally(() => (button.disabled = false));
  });
  return root;
}

// Called when the tab opens: the list is read again each time.
export function showFeedback(): void {
  ensureRoot();
  void refresh();
}

async function refresh(): Promise<void> {
  const data = await api.feedback();
  if (!root) return;
  if (!data) {
    root.querySelector(".feedback-list")!.innerHTML = `<p class="feedback-empty">Ideas could not be loaded.</p>`;
    return;
  }
  render(data);
}

// Claude's work first, then open ideas by votes, then what is done, then the rest.
function render(data: FeedbackResponse): void {
  const r = root!;
  renderAdmin(r.querySelector<HTMLElement>(".feedback-admin")!, data);
  const list = r.querySelector<HTMLElement>(".feedback-list")!;
  list.textContent = "";
  const all = data.suggestions;
  if (!all.length) {
    list.innerHTML = `<p class="feedback-empty">No ideas yet. Be the first.</p>`;
    return;
  }
  const working = all.filter((s) => s.status === "sent" || s.status === "review");
  const open = all.filter((s) => s.status === "open").sort((a, b) => b.votes - a.votes || b.createdAt - a.createdAt);
  const shipped = all.filter((s) => s.status === "shipped");
  const declined = all.filter((s) => s.status === "declined");
  group(list, "Claude is working on", working);
  group(list, "Open ideas", open);
  group(list, "Done", shipped);
  if (declined.length) {
    const details = document.createElement("details");
    details.className = "feedback-group";
    const summary = document.createElement("summary");
    summary.textContent = `Not this time (${declined.length})`;
    details.append(summary, ...declined.map(item));
    list.append(details);
  }
}

function group(list: HTMLElement, title: string, items: Suggestion[]): void {
  if (!items.length) return;
  const section = document.createElement("section");
  section.className = "feedback-group";
  const h = document.createElement("h3");
  h.textContent = title;
  section.append(h, ...items.map(item));
  list.append(section);
}

function renderAdmin(box: HTMLElement, data: FeedbackResponse): void {
  box.hidden = !session.admin;
  if (!session.admin) return;
  box.textContent = "";
  const p = document.createElement("p");
  p.textContent = data.missing?.length
    ? `To send ideas to Claude, set ${data.missing.join(", ")} (docs/SETUP.md, "Feedback").`
    : "Send to Claude opens a GitHub issue and starts the feedback routine. Statuses follow GitHub every ten minutes.";
  const check = document.createElement("button");
  check.textContent = "Check GitHub now";
  check.disabled = !!data.missing?.length;
  check.onclick = () => {
    check.disabled = true;
    void api
      .syncIdeas()
      .then((r) => {
        toast(r.changed ? `${r.changed} updated` : "Nothing new on GitHub");
        return refresh();
      })
      .catch((err: unknown) => toast(err instanceof Error ? err.message : "Could not read GitHub", "error"))
      .finally(() => (check.disabled = false));
  };
  box.append(p, check);
}

function item(s: Suggestion): HTMLElement {
  const el = document.createElement("article");
  el.className = `idea idea-${s.status}`;

  const vote = document.createElement("button");
  vote.className = "idea-vote";
  vote.setAttribute("aria-pressed", String(s.voted));
  vote.setAttribute("aria-label", s.voted ? `Remove your vote (${s.votes})` : `Vote for this idea (${s.votes})`);
  vote.disabled = s.status !== "open";
  vote.innerHTML = `<span class="idea-arrow">▲</span><span class="idea-count"></span>`;
  vote.querySelector(".idea-count")!.textContent = String(s.votes);
  vote.onclick = () => {
    vote.disabled = true;
    void api
      .voteIdea(s.id, !s.voted)
      .then(refresh)
      .catch((err: unknown) => {
        vote.disabled = false;
        toast(err instanceof Error ? err.message : "The vote did not go through", "error");
      });
  };

  const main = document.createElement("div");
  main.className = "idea-main";
  const title = document.createElement("h4");
  title.textContent = s.title;
  main.append(title);
  if (s.body) {
    const body = document.createElement("p");
    body.className = "idea-body";
    body.textContent = s.body;
    main.append(body);
  }
  const meta = document.createElement("p");
  meta.className = "idea-meta";
  const status = document.createElement("span");
  status.className = "idea-status";
  status.textContent = STATUS_LABEL[s.status];
  meta.append(`${s.mine ? "you" : s.by}, ${ago(s.createdAt)} · `, status);
  for (const [label, href] of [
    ["pull request", s.prUrl],
    ["issue", s.issueUrl],
    ["Claude session", s.sessionUrl],
  ] as const) {
    const a = link(label, href);
    if (a) meta.append(" · ", a);
  }
  main.append(meta);
  if (s.note) {
    const note = document.createElement("p");
    note.className = "idea-note";
    note.textContent = s.note;
    main.append(note);
  }
  if (session.admin) main.append(adminRow(s));
  el.append(vote, main);
  return el;
}

// Only links to the web, whatever the Worker stored.
function link(label: string, href: string | null | undefined): HTMLAnchorElement | null {
  if (!href || !/^https:\/\//.test(href)) return null;
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = label;
  return a;
}

function adminRow(s: Suggestion): HTMLElement {
  const row = document.createElement("div");
  row.className = "idea-admin";
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
    row.append(b);
  };
  if (s.status === "open" || s.status === "sent" || s.status === "declined") {
    const b = document.createElement("button");
    b.className = "idea-send";
    b.textContent = s.status === "open" ? "Send to Claude" : "Send again";
    b.onclick = () => openSend(s);
    row.append(b);
  }
  if (s.status !== "shipped" && s.status !== "declined") {
    act("Decline", async () => {
      const note = window.prompt("Why not, in a few words? Players will read it. (optional)", "");
      if (note === null) return;
      await api.changeIdea({ id: s.id, action: "decline", note });
    });
  }
  if (s.status === "declined") act("Reopen", () => api.changeIdea({ id: s.id, action: "reopen" }));
  act("Delete", async () => {
    if (!window.confirm(`Delete "${s.title}" and its votes? A GitHub issue, if any, stays.`)) return;
    await api.changeIdea({ id: s.id, action: "delete" });
  });
  return row;
}

// The brief starts from the player's words. What Claude builds is exactly
// what is in the box, so the "Done when" list is where the admin adds the most.
function draftBrief(s: Suggestion): string {
  return s.brief ?? [s.title, "", s.body, "", "Done when:", "1. "].join("\n").replace(/\n{3,}/g, "\n\n");
}

function ensureSendDialog(): HTMLDialogElement {
  if (sendDialog) return sendDialog;
  const d = document.createElement("dialog");
  d.className = "card idea-dialog";
  d.innerHTML = `
    <div class="card-head">
      <span class="card-emoji">🛠️</span>
      <div><h2 class="card-name">Send to Claude</h2><div class="card-meta idea-dialog-title"></div></div>
      <button class="card-close" aria-label="Close">×</button>
    </div>
    <p class="idea-dialog-hint">Claude builds this brief, nothing else, on a new branch, runs the checks and opens a draft pull request. Nothing is merged or deployed without you. The GitHub issue shows the brief and the idea, not the player's name.</p>
    <textarea class="idea-brief" rows="12" maxlength="${BRIEF_MAX}"></textarea>
    <div class="idea-dialog-actions">
      <button type="button" class="idea-dialog-cancel">Cancel</button>
      <button type="button" class="idea-dialog-send card-cast">Send to Claude</button>
    </div>
  `;
  d.querySelector(".card-close")!.addEventListener("click", () => d.close());
  d.querySelector(".idea-dialog-cancel")!.addEventListener("click", () => d.close());
  const send = d.querySelector<HTMLButtonElement>(".idea-dialog-send")!;
  send.addEventListener("click", () => {
    const s = current;
    const brief = d.querySelector<HTMLTextAreaElement>(".idea-brief")!.value.trim();
    if (!s || !brief) return;
    send.disabled = true;
    void api
      .changeIdea({ id: s.id, action: "send", brief })
      .then(() => {
        d.close();
        toast("Sent: Claude is on it", "special");
        return refresh();
      })
      .catch((err: unknown) => toast(err instanceof Error ? err.message : "It was not sent", "error"))
      .finally(() => (send.disabled = false));
  });
  document.body.append(d);
  sendDialog = d;
  return d;
}

function openSend(s: Suggestion): void {
  const d = ensureSendDialog();
  current = s;
  d.querySelector(".idea-dialog-title")!.textContent = `${s.title} · ${s.votes} ${s.votes === 1 ? "vote" : "votes"}`;
  d.querySelector<HTMLTextAreaElement>(".idea-brief")!.value = draftBrief(s);
  if (!d.open) d.showModal();
}
