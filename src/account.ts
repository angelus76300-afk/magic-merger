import { startAuthentication, startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import type { SignedIn } from "../shared/account";
import type { HealthResponse } from "../shared/types";
import * as api from "./api";
import { profileControls } from "./community";
import { clearProgress, freeze, hasProgress, isFrozen, owner, restore, setAside, setOwner, summary } from "./device-save";
import { ago } from "./people";
import type { Sync } from "./sync";
import { toast } from "./toast";

// 4.0: accounts, seen from the page. An invite becomes an account with a
// passkey: the one time "save your progress" offer, sign in on another
// device, the account page (passkeys, devices, email, export, delete).

const OFFERED_KEY = "magic-merger.offered";

let onSignedIn: (r: SignedIn) => Promise<void> = async () => undefined;
let sync: Sync | null = null;
export function setSignedIn(fn: (r: SignedIn) => Promise<void>, s: Sync): void {
  onSignedIn = fn;
  sync = s;
}

// 4.4.6: this device's save follows whoever signs in (device-save.ts). Its
// own account's save stays; another account's is set aside, never merged
// or sent; an untagged one (from before 4.4.6) is offered once. Then the
// session is kept, the admin token dropped once the owner's account holds
// the powers, and the page starts again from the account's progress.
async function signedIn(r: SignedIn, how: "created" | "signin"): Promise<void> {
  const tag = owner();
  if (tag !== r.id) {
    if (tag) {
      if (!(await setAside())) toast("The other account's copy on this device could not be kept aside; its account still holds what it saved.");
      if (!(await restore(r.id))) setOwner(r.id);
    } else if (how === "signin" && hasProgress()) {
      if (await offerUpload(r.name)) setOwner(r.id);
      else {
        await setAside();
        if (!(await restore(r.id))) setOwner(r.id);
      }
    } else if (!(await restore(r.id))) setOwner(r.id);
  }
  api.setSession(r.token);
  if (r.admin) api.setToken(null);
  // A save that moved: the page reloads and syncs from what is stored now.
  if (isFrozen()) {
    window.setTimeout(() => location.reload(), 600);
    return;
  }
  await onSignedIn(r);
}

// A save from before any account, on a device someone signs in on: offered
// once. "Set it aside" keeps it on the device and never sends it.
function offerUpload(name: string): Promise<boolean> {
  const s = summary();
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = "card save-offer";
    d.innerHTML = `
      <div class="card-head">
        <span class="card-emoji">📦</span>
        <div><h2 class="card-name">Progress from before</h2></div>
      </div>
      <p class="offer-text"></p>
      <button class="card-cast offer-add"></button>
      <button class="offer-aside">Set it aside</button>
    `;
    const what = [s.discoveries ? `${s.discoveries} discoveries` : "", s.island ? "an island" : ""].filter(Boolean).join(" and ");
    d.querySelector(".offer-text")!.textContent =
      `This device holds progress made before anyone signed in here: ${what}. If it is yours, add it to ${name}'s account: the discoveries join the account's, and if the account has an island too you choose which one to play. If it is not yours, set it aside: it stays on this device and is never sent.`;
    d.querySelector(".offer-add")!.textContent = `Add it to ${name}'s account`;
    const done = (add: boolean) => {
      d.close();
      d.remove();
      resolve(add);
    };
    d.querySelector(".offer-add")!.addEventListener("click", () => done(true));
    d.querySelector(".offer-aside")!.addEventListener("click", () => done(false));
    d.addEventListener("cancel", (e) => {
      e.preventDefault();
      done(false);
    });
    document.body.append(d);
    d.showModal();
  });
}

// What this page holds is someone else's: set aside, and the page starts
// again (a link played on a device that held an account's save, or a page
// whose session changed in another tab). Returns true when it moved.
export async function followAccount(id: string): Promise<boolean> {
  const tag = owner();
  if (tag === id) return false;
  if (!tag) {
    setOwner(id);
    return false;
  }
  await setAside();
  if (!(await restore(id))) setOwner(id);
  window.setTimeout(() => location.reload(), 300);
  return true;
}

// Sign out: the account holds the progress, so by default it leaves this
// device; "keep a copy" leaves it here, tagged with the account, for the
// next time it signs in here. What is not saved yet goes up first; if it
// cannot (offline), the copy stays whatever the choice. Switch account is
// the same, then a passkey sign in.
export async function signOut(then: "stay" | "signin" = "stay"): Promise<void> {
  let choice = await askSignOut(then === "signin");
  if (!choice) return;
  const saved = sync ? await sync.now(false).catch(() => false) : true;
  if (choice === "remove" && !saved && hasProgress()) {
    toast("Not everything is saved to your account yet (offline?): a copy stays on this device.", "error");
    choice = "keep";
  }
  await api.account.logout().catch(() => undefined);
  api.setSession(null);
  api.setToken(null);
  if (choice === "remove") clearProgress();
  else freeze();
  if (then === "signin" && (await signIn())) return;
  location.reload();
}

function askSignOut(switching: boolean): Promise<"remove" | "keep" | null> {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = "card signout";
    d.innerHTML = `
      <div class="card-head">
        <span class="card-emoji">🚪</span>
        <div><h2 class="card-name"></h2></div>
        <button class="card-close" aria-label="Cancel">×</button>
      </div>
      <p class="signout-text"></p>
      <button class="card-cast signout-remove" autofocus>Remove it from this device</button>
      <button class="signout-keep">Keep a copy on this device</button>
    `;
    d.querySelector(".card-name")!.textContent = switching ? "Switch account" : "Sign out";
    d.querySelector(".signout-text")!.textContent =
      `Your discoveries, board and island are saved to your account. Remove them from this device (anyone using it next starts fresh), or keep a copy here for the next time you sign in on it. ${sync?.status() ?? ""}`;
    const done = (c: "remove" | "keep" | null) => {
      d.close();
      d.remove();
      resolve(c);
    };
    d.querySelector(".signout-remove")!.addEventListener("click", () => done("remove"));
    d.querySelector(".signout-keep")!.addEventListener("click", () => done("keep"));
    d.querySelector(".card-close")!.addEventListener("click", () => done(null));
    d.addEventListener("cancel", (e) => {
      e.preventDefault();
      done(null);
    });
    document.body.append(d);
    d.showModal();
    d.querySelector<HTMLButtonElement>(".signout-remove")!.focus();
  });
}

// Makes a passkey. From an invite link, this creates the account and the
// link stops working for anyone else; signed in, it adds one for this device.
export async function createPasskey(): Promise<boolean> {
  if (!browserSupportsWebAuthn()) {
    toast("This browser has no passkeys. Try the browser your phone or computer came with.", "error");
    return false;
  }
  try {
    const { options, challengeId } = await api.account.registerOptions();
    const response = await startRegistration({ optionsJSON: options as PublicKeyCredentialCreationOptionsJSON });
    const r = await api.account.registerVerify(challengeId, response);
    if (r.created) {
      toast(`Your account is made, ${r.name}. Your progress is being saved.`, "special");
      await signedIn(r, "created");
    } else toast("Passkey added for this device", "special");
    return true;
  } catch (err) {
    if (err instanceof Error && err.name === "NotAllowedError") toast("No passkey was made. You can try again from the ? button.");
    else toast(err instanceof Error ? err.message : "The passkey could not be made", "error");
    return false;
  }
}

export async function signIn(): Promise<boolean> {
  if (!browserSupportsWebAuthn()) {
    toast("This browser has no passkeys. Ask for a sign in link instead.", "error");
    return false;
  }
  try {
    const { options, challengeId } = await api.account.loginOptions();
    const response = await startAuthentication({ optionsJSON: options as PublicKeyCredentialRequestOptionsJSON });
    const r = await api.account.loginVerify(challengeId, response);
    toast(`Welcome back, ${r.name}`, "special");
    await signedIn(r, "signin");
    return true;
  } catch (err) {
    if (err instanceof Error && err.name === "NotAllowedError") toast("Nothing was signed in.");
    else toast(err instanceof Error ? err.message : "The sign in did not work", "error");
    return false;
  }
}

// A one use link for an account that exists (the admin's new link, or an
// email link): signs this device in at once.
export async function claimLink(kind: "link" | "email", token?: string): Promise<boolean> {
  try {
    const r = kind === "email" && token ? await api.account.emailClaim(token) : await api.account.claimLink();
    toast(`Signed in as ${r.name} on this device`, "special");
    await signedIn(r, "signin");
    return true;
  } catch (err) {
    toast(err instanceof Error ? err.message : "The link did not sign you in", "error");
    return false;
  }
}

export function offeredBefore(): boolean {
  try {
    return localStorage.getItem(OFFERED_KEY) === "1";
  } catch {
    return false;
  }
}

// The one time offer to a friend playing with a link: nothing changes until
// they answer, and "Later" is an answer (the ? button keeps the offer).
export function offerAccount(status: HealthResponse): void {
  const d = document.createElement("dialog");
  d.className = "card account-offer";
  d.innerHTML = `
    <div class="card-head">
      <span class="card-emoji">🔐</span>
      <div><h2 class="card-name">Keep your progress</h2></div>
      <button class="card-close" aria-label="Close">×</button>
    </div>
    <p class="account-text"></p>
    <button class="card-cast account-create">Make a passkey</button>
    <button class="account-later">Later</button>
  `;
  d.querySelector(".account-text")!.textContent = status.account?.admin
    ? "You hold the admin token on this device. Make the owner's account with a passkey (your phone's or computer's own lock, no password): your discoveries, board and island are saved to it, and the admin powers follow you on every device where you sign in, with no token to type. Everything the admin did so far stays yours."
    : `Hello ${status.account?.name ?? ""}. Right now your discoveries and your island live in this browser only. A passkey (your phone's or computer's own lock, no password) turns this link into an account: your progress is saved, you can play from any device, and this link stops working for anyone else.`;
  if (status.account?.admin) d.querySelector(".card-name")!.textContent = "Make the owner's account";
  const done = () => {
    try {
      localStorage.setItem(OFFERED_KEY, "1");
    } catch {
      // asked again next time
    }
    d.close();
    d.remove();
  };
  d.querySelector(".card-close")!.addEventListener("click", done);
  d.querySelector(".account-later")!.addEventListener("click", done);
  d.querySelector(".account-create")!.addEventListener("click", () => {
    void createPasskey().then((ok) => {
      if (ok) done();
    });
  });
  d.addEventListener("cancel", done);
  document.body.append(d);
  d.showModal();
}

// The account page, from the ? button when signed in.
export async function openAccount(): Promise<void> {
  let info;
  try {
    info = await api.account.info();
  } catch (err) {
    toast(err instanceof Error ? err.message : "The account could not be read", "error");
    return;
  }
  const d = document.createElement("dialog");
  d.className = "card account";
  d.innerHTML = `
    <div class="card-head">
      <span class="card-emoji">🔐</span>
      <div><h2 class="card-name"></h2><div class="card-meta account-since"></div></div>
      <button class="card-close" aria-label="Close">×</button>
    </div>
    <h3>Passkeys</h3>
    <p class="account-passkeys"></p>
    <button class="account-add">Add a passkey on this device</button>
    <h3>Devices signed in</h3>
    <div class="account-devices"></div>
    <h3>Saved progress</h3>
    <p class="account-progress"></p>
    <h3>Community</h3>
    <div class="account-community"><p class="account-community-text">Loading...</p></div>
    <div class="account-email" hidden>
      <h3>Sign in by email</h3>
      <p class="account-email-text"></p>
      <form class="account-email-form"><input type="email" name="email" placeholder="you@example.com" autocomplete="email" /><button type="submit">Save</button></form>
    </div>
    <h3>Your data</h3>
    <p class="account-privacy">Export gives you everything the game keeps about this account, as a file. Delete removes it all: your passkeys, devices, saved progress, votes, ideas and wins. What you discovered first stays in the shared library, without your name.</p>
    <div class="account-actions">
      <button class="account-export">Export</button>
      <button class="account-logout">Sign out here</button>
      <button class="account-delete danger">Delete my account</button>
    </div>
  `;
  d.querySelector(".card-name")!.textContent = info.name;
  d.querySelector(".account-since")!.textContent = `Account since ${new Date(info.claimedAt).toLocaleDateString()}`;
  d.querySelector(".account-passkeys")!.textContent = info.passkeys.length
    ? info.passkeys
        .map((p) => `${p.synced ? "A synced passkey" : "A passkey"} made ${ago(p.createdAt)}${p.lastUsed ? `, used ${ago(p.lastUsed)}` : ""}`)
        .join(". ")
    : "No passkey yet: this device was signed in with a link. Add one so you can sign in anywhere.";
  // 4.5: the favorite spell friends see in the Community tab, and the switch that hides you.
  const communityBox = d.querySelector<HTMLElement>(".account-community")!;
  void api
    .community()
    .then((c) => communityBox.replaceChildren(profileControls(c.me)))
    .catch(() => (communityBox.textContent = "Could not read your Community choices."));
  const devices = d.querySelector<HTMLElement>(".account-devices")!;
  for (const dev of info.devices) {
    const row = document.createElement("div");
    row.className = "account-device";
    const text = document.createElement("span");
    text.textContent = `${dev.device}${dev.current ? " (this one)" : ""}, since ${ago(dev.since)}, ${dev.lastSync ? `last synced ${ago(dev.lastSync)}` : "never synced"}`;
    row.append(text);
    if (!dev.current) {
      const out = document.createElement("button");
      out.textContent = "Sign out";
      out.onclick = () =>
        void api.account.revokeDevice(dev.hash).then(
          () => row.remove(),
          () => toast("Could not sign that device out", "error"),
        );
      row.append(out);
    }
    devices.append(row);
  }
  const current = info.progress.filter((p) => p.kind !== "island_previous");
  d.querySelector(".account-progress")!.textContent = current.length
    ? current.map((p) => `${p.kind}: saved ${ago(p.updatedAt)} from ${p.device ?? "a device"}`).join(". ")
    : "Nothing saved yet.";
  const previous = info.progress.find((p) => p.kind === "island_previous");
  if (previous) {
    const row = document.createElement("p");
    row.className = "account-previous";
    row.textContent = `The previous island, from ${previous.device ?? "a device"}, ${ago(previous.updatedAt)}: kept when you chose another one. `;
    const back = document.createElement("button");
    back.className = "account-previous-load";
    back.textContent = "Play it again";
    back.onclick = () => {
      if (window.confirm("Play the previous island here? This device's island becomes the previous one, so nothing is lost.")) void sync?.restorePrevious();
    };
    row.append(back);
    d.querySelector(".account-progress")!.after(row);
  }
  if (info.admin) {
    d.querySelector(".account-since")!.textContent += ". The owner's account: the admin powers on every device signed in here.";
    d.querySelector<HTMLElement>(".account-delete")!.hidden = true;
  }
  if (info.emailOffered) {
    const box = d.querySelector<HTMLElement>(".account-email")!;
    box.hidden = false;
    box.querySelector(".account-email-text")!.textContent = info.email
      ? `Links can be sent to ${info.email}. Only sign in links use it.`
      : "Without a passkey on a device, a one use link by email signs you in. The address is used for that and nothing else.";
    box.querySelector("form")!.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = box.querySelector<HTMLInputElement>("input")!;
      void api.account.setEmail(input.value).then(
        () => toast(input.value ? "Email saved" : "Email removed"),
        (err: unknown) => toast(err instanceof Error ? err.message : "Could not save it", "error"),
      );
    });
  }
  d.querySelector(".account-add")!.addEventListener("click", () => void createPasskey());
  d.querySelector(".account-export")!.addEventListener("click", () => {
    void api.account.export().then(
      (data) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
        a.download = `magic-merger-${info.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      },
      (err: unknown) => toast(err instanceof Error ? err.message : "Could not export", "error"),
    );
  });
  d.querySelector(".account-logout")!.addEventListener("click", () => {
    d.close();
    d.remove();
    void signOut();
  });
  d.querySelector(".account-delete")!.addEventListener("click", () => {
    const typed = window.prompt(`Delete the account of ${info.name} and everything it holds? This cannot be undone. Type the name to confirm:`);
    if (typed === null || typed.trim().toLowerCase() !== info.name.trim().toLowerCase()) return;
    void api.account.remove().then(
      () => {
        api.setSession(null);
        freeze();
        try {
          localStorage.clear();
        } catch {
          // nothing kept
        }
        location.reload();
      },
      (err: unknown) => toast(err instanceof Error ? err.message : "Could not delete", "error"),
    );
  });
  d.querySelector(".card-close")!.addEventListener("click", () => {
    d.close();
    d.remove();
  });
  document.body.append(d);
  d.showModal();
}
