import { startAuthentication, startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import type { HealthResponse } from "../shared/types";
import * as api from "./api";
import { ago } from "./people";
import { toast } from "./toast";

// 4.0: accounts, seen from the page. An invite becomes an account with a
// passkey: the one time "save your progress" offer, sign in on another
// device, the account page (passkeys, devices, email, export, delete).

const OFFERED_KEY = "magic-merger.offered";

let onSignedIn: () => Promise<void> = async () => undefined;
export function setSignedIn(fn: () => Promise<void>): void {
  onSignedIn = fn;
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
    api.setSession(r.token);
    toast(r.created ? `Your account is made, ${r.name}. Your progress is being saved.` : "Passkey added for this device", "special");
    await onSignedIn();
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
    api.setSession(r.token);
    toast(`Welcome back, ${r.name}`, "special");
    await onSignedIn();
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
    api.setSession(r.token);
    toast(`Signed in as ${r.name} on this device`, "special");
    await onSignedIn();
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
  d.querySelector(".account-text")!.textContent =
    `Hello ${status.account?.name ?? ""}. Right now your discoveries and your island live in this browser only. A passkey (your phone's or computer's own lock, no password) turns this link into an account: your progress is saved, you can play from any device, and this link stops working for anyone else.`;
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
  const devices = d.querySelector<HTMLElement>(".account-devices")!;
  for (const dev of info.devices) {
    const row = document.createElement("div");
    row.className = "account-device";
    const text = document.createElement("span");
    text.textContent = `${dev.device}${dev.current ? " (this one)" : ""}, since ${ago(dev.since)}${dev.lastSeen ? `, seen ${ago(dev.lastSeen)}` : ""}`;
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
  d.querySelector(".account-progress")!.textContent = info.progress.length
    ? info.progress.map((p) => `${p.kind}: saved ${ago(p.updatedAt)} from ${p.device ?? "a device"}`).join(". ")
    : "Nothing saved yet.";
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
    void api.account.logout().finally(() => {
      api.setSession(null);
      location.reload();
    });
  });
  d.querySelector(".account-delete")!.addEventListener("click", () => {
    const typed = window.prompt(`Delete the account of ${info.name} and everything it holds? This cannot be undone. Type the name to confirm:`);
    if (typed === null || typed.trim().toLowerCase() !== info.name.trim().toLowerCase()) return;
    void api.account.remove().then(
      () => {
        api.setSession(null);
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
