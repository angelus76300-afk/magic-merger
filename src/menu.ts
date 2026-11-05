import type { HealthResponse } from "../shared/types";
import * as api from "./api";
import { createPasskey, openAccount, signIn, signOut } from "./account";
import type { Sync } from "./sync";
import { toast } from "./toast";
import { openNews, unread } from "./whatsnew";

// 4.4.6: the ? menu. Who is signed in and whether the progress is saved,
// always first; then sign in (on any device, even one with a link or a
// save), make a passkey, sync now, the account page, switch account, sign
// out; the welcome and the privacy note last.

export function openMenu(status: HealthResponse | null, sync: Sync, about: () => void): void {
  document.querySelector("dialog.menu")?.remove();
  const d = document.createElement("dialog");
  d.className = "card menu";
  d.innerHTML = `
    <div class="card-head">
      <span class="card-emoji">✨</span>
      <div><h2 class="card-name">Magic Merger</h2><div class="card-meta menu-who"></div></div>
      <button class="card-close" aria-label="Close">×</button>
    </div>
    <p class="menu-sync"></p>
    <div class="menu-actions">
      <button class="menu-news"></button>
      <button class="card-cast menu-signin" hidden>Sign in with a passkey</button>
      <button class="card-cast menu-create" hidden>Make a passkey: keep your progress</button>
      <button class="card-cast menu-syncnow" hidden>Sync now</button>
      <button class="menu-island" hidden></button>
      <button class="menu-account" hidden>Your account</button>
      <button class="menu-switch" hidden>Switch account</button>
      <button class="menu-signout" hidden>Sign out</button>
      <button class="menu-about">About the game and privacy</button>
    </div>
  `;
  const account = status?.account;
  const signedIn = !!account?.signedIn;
  const who = d.querySelector<HTMLElement>(".menu-who")!;
  who.textContent = signedIn
    ? `Signed in as ${account!.name}${account!.admin ? " (the owner, with the admin powers)" : ""}`
    : account && !account.claimed && !account.admin
      ? `Playing with ${account.name}'s link, not signed in`
      : status?.admin
        ? "The admin, by token on this device, not signed in"
        : "Not signed in";
  const syncLine = d.querySelector<HTMLElement>(".menu-sync")!;
  const island = d.querySelector<HTMLButtonElement>(".menu-island")!;
  const refresh = () => {
    syncLine.textContent = sync.status();
    island.hidden = !signedIn || !sync.islandNews;
    if (sync.islandNews) island.textContent = `Load the newer island from ${sync.islandNews.device ?? "another device"}`;
  };
  refresh();
  const show = (sel: string, on: boolean) => (d.querySelector<HTMLElement>(sel)!.hidden = !on);
  show(".menu-signin", !signedIn);
  // A link not yet an account, or the owner's account not made yet (the token).
  show(".menu-create", !signedIn && !!account && !account.claimed);
  for (const sel of [".menu-syncnow", ".menu-account", ".menu-switch", ".menu-signout"]) show(sel, signedIn);
  const newsButton = d.querySelector<HTMLButtonElement>(".menu-news")!;
  newsButton.textContent = unread() ? `What's new (${unread()})` : "What's new";
  newsButton.classList.toggle("menu-news-fresh", unread() > 0);
  newsButton.addEventListener("click", () => {
    close();
    openNews();
  });
  const stop = sync.listen(refresh);
  const close = () => {
    stop();
    d.close();
    d.remove();
  };
  d.querySelector(".menu-signin")!.addEventListener("click", () => {
    close();
    void signIn();
  });
  d.querySelector(".menu-create")!.addEventListener("click", () => {
    close();
    void createPasskey();
  });
  d.querySelector(".menu-syncnow")!.addEventListener("click", () => {
    const b = d.querySelector<HTMLButtonElement>(".menu-syncnow")!;
    b.disabled = true;
    b.textContent = "Syncing…";
    void sync.now(true).then((ok) => {
      b.disabled = false;
      b.textContent = "Sync now";
      refresh();
      toast(ok ? "Saved to your account" : sync.status(), ok ? "info" : "error");
    });
  });
  island.addEventListener("click", () => {
    close();
    void sync.loadNews();
  });
  d.querySelector(".menu-account")!.addEventListener("click", () => {
    close();
    void openAccount();
  });
  d.querySelector(".menu-switch")!.addEventListener("click", () => {
    close();
    void signOut("signin");
  });
  d.querySelector(".menu-signout")!.addEventListener("click", () => {
    close();
    void signOut();
  });
  d.querySelector(".menu-about")!.addEventListener("click", () => {
    close();
    about();
  });
  d.querySelector(".card-close")!.addEventListener("click", close);
  d.addEventListener("cancel", close);
  document.body.append(d);
  d.showModal();
  // Not signed in with a token: nothing to sync, but say whether the admin token is here.
  if (!signedIn && api.hasToken() && account?.admin && account.claimed) syncLine.textContent += " Sign in with your passkey to keep the admin's progress.";
}
