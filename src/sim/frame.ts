import { chronicleDigest } from "./chronicle";
import { Engine, type WorldSize } from "./engine";
import { DEFAULT_LAND, readChoice, resolveLand, type LandChoice } from "./land";
import { WORLD_SIZES } from "./sizes";
import { kindOf, makeCreature, maxHp, type Creature } from "./creatures";
import { artifactAt, creatureAt, inspect, inspectArtifact } from "./inspect";
import type { Artifact } from "./artifacts";
import type { FromWorld, ToWorld } from "./protocol";
import type { CastRequest, Runtime } from "./runtime";
import type { SavedWorld } from "./save";
import { Hud } from "./hud";
import { SCENARIOS } from "./scenarios";
import { firstLook, villageView, type Pose } from "./firstlook";
import { Director, lifeLine, nameOf, type Shot } from "./director";
import { castOnScreen, watchCast } from "./voxel/castview";
import { readDef, setFinders, signatureOf, wonderInfo, type WonderDef } from "./wonders";

// The pool of wonders written as programs (4.4.5 part C), checked: the page
// relays what the server said, and a definition is code like any spell.
let pool: WonderDef[] = [];
function readPool(v: unknown): WonderDef[] {
  return (Array.isArray(v) ? v : [])
    .map(readDef)
    .filter((d): d is WonderDef => d !== null)
    .slice(0, 200);
}

function readRecent(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.length <= 300).slice(-10) : [];
}

// Entry point of the World iframe (world.html). It owns the simulation and
// runs spell programs; the parent page owns the player's data and the API.

const canvas = document.getElementById("world") as HTMLCanvasElement;
const overlay = document.getElementById("overlay") as HTMLCanvasElement;
let engine: Engine | null = null;
let selected: CastRequest | null = null;
let muted = false;
let saveTimer = 0;
let unbind: (() => void) | null = null;
// The sandbox world while a challenge is played, to come back to it untouched.
let sandbox: { save: SavedWorld | null; size: WorldSize; land: LandChoice; rules: CastRequest[] } = {
  save: null,
  size: "medium",
  land: { ...DEFAULT_LAND },
  rules: [],
};
let scenario: string | null = null;
let hud: Hud | null = null;
let hudOn = false;
let perfTimer = 0;
// Casts made in this frame, numbered for the page's first cast probe.
let casts = 0;

// A first cast the newcomer sees (2026-11-11, review of 10 November): the
// camera holds a cast for three seconds, and a tap during the tour of a new
// island ends the tour and casts nothing (it cast where the tour's camera
// pointed). The tour itself plays when the island appears: for a day it
// waited for the island's first cast, and the owner did not like an island
// that arrives without its presentation (11 November).
const HOLD_MS = 3000;
let holdUntil = 0;
let lastTouch = 0;
let touring = false;
let swallowTap = false;
let quietUntil = 0;
canvas.addEventListener(
  "pointerdown",
  () => {
    swallowTap = touring || watching;
    tapEndsWatch = watching;
    lastTouch = performance.now();
  },
  { capture: true },
);
function send(msg: FromWorld): void {
  window.parent.postMessage(msg, "*");
}

// Keys pressed on the island stay in this frame: Escape is passed up so the
// vote after a cast closes as it does elsewhere on the page.
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") send({ type: "escape" });
});

const hooks = {
  onError: (key: string, name: string, message: string) => send({ type: "error", key, name, message }),
  onTap: (x: number, y: number) => {
    if (!engine) return;
    // A tap that ended the tour of the island only ends it (2026-11-11): it
    // cast where the tour's camera pointed, and the camera then flew away.
    if (swallowTap || performance.now() < quietUntil) {
      swallowTap = false;
      return;
    }
    if (engine.view.orbit.watching) return;
    if (!selected) {
      // No spell in hand: a tap on a creature shows what it is doing (3.6).
      const c = creatureAt(engine.world, x, y);
      const a = c ? null : artifactAt(engine.world, x, y);
      const wonder = c || a ? null : engine.world.wonders.find((w) => Math.hypot(w.x - x, w.y - y) <= Math.max(3, w.r * 0.8));
      if (c) showInspect(c);
      else if (a) showInspect(null, a);
      else if (wonder) showWonder(wonderInfo(wonder));
      else {
        closeInspect();
        send({ type: "tap-without-spell" });
      }
      return;
    }
    if (engine.cast(selected, x, y)) {
      send({ type: "cast", key: selected.key });
      saveSoon();
      // The camera holds the cast for three seconds: nothing of the frame
      // moves it before then (the tour of the island waits, below).
      holdUntil = performance.now() + HOLD_MS;
      director.castAt(x, y, engine.world.time);
      lastCastAt = performance.now();
      // Where the cast is on screen for the next three seconds (castview.ts).
      const n = casts++;
      watchCast(
        () => (engine ? castOnScreen(engine, x, y, [card, lookCard]) : null),
        (at) => send({ type: "cast-view", n, x: at?.x ?? null, y: at?.y ?? null }),
      );
    }
  },
};

// The inspect card: built from text nodes only (kind names come from spells),
// refreshed twice a second while it is open.
const card = document.getElementById("inspect") as HTMLElement;
let inspected: Creature | null = null;
let inspectedArtifact: Artifact | null = null;
let inspectTimer = 0;

function showInspect(c: Creature | null, a: Artifact | null = null): void {
  if (inspected) delete inspected.data.inspected;
  inspected = c;
  inspectedArtifact = a;
  if (c) c.data.inspected = true;
  drawInspect();
  card.hidden = false;
  reportInspect();
  clearInterval(inspectTimer);
  inspectTimer = window.setInterval(drawInspect, 500);
}

// A wonder's card (4.4.5 part B): what it is and what it does.
function showWonder(info: ReturnType<typeof wonderInfo>): void {
  closeInspect();
  const close = el("button", "close", "×");
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", closeInspect);
  const head = el("div", "head");
  head.append(el("strong", "title", info.name[0].toUpperCase() + info.name.slice(1)), el("span", "sub", info.label), close);
  const rows = el("dl", "rows");
  rows.append(el("dt", "", "Rarity"), el("dd", "", info.rarity), el("dt", "", "Does"), el("dd", "", info.does));
  if (info.by) rows.append(el("dt", "", "Found by"), el("dd", "", info.by));
  card.replaceChildren(head, rows);
  card.hidden = false;
  reportInspect();
}

function closeInspect(): void {
  if (inspected) delete inspected.data.inspected;
  inspected = null;
  inspectedArtifact = null;
  card.hidden = true;
  clearInterval(inspectTimer);
  reportInspect();
}

// The page's toasts stack below the card, never over its name (2026-11-11):
// its bottom edge is told whenever it changes, 0 once it is closed.
let inspectBottom = -1;
function reportInspect(): void {
  // The story line counts too: a toast never lands on it.
  const line = document.getElementById("story");
  const bottom = Math.max(
    card.hidden ? 0 : Math.ceil(card.getBoundingClientRect().bottom),
    line && !line.hidden && !line.classList.contains("out") ? Math.ceil(line.getBoundingClientRect().bottom) : 0,
  );
  if (bottom === inspectBottom) return;
  inspectBottom = bottom;
  send({ type: "inspect", bottom });
}

function el(tag: string, cls: string, text = ""): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
}

function drawInspect(): void {
  if (!engine) return closeInspect();
  const a = inspectedArtifact;
  if (a ? !engine.world.landmarks.includes(a) : !inspected || !engine.world.creatures.includes(inspected)) return closeInspect();
  const info = a ? inspectArtifact(engine.world, a) : inspect(engine.world, inspected!, kindOf, maxHp);
  const close = el("button", "close", "×");
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", closeInspect);
  const head = el("div", "head");
  // A villager is known by its name, as in the line that tells its story (director.ts).
  const named = !a && inspected && inspected.kind === "villager" && !inspected.mind?.title ? nameOf(engine.world, inspected) : "";
  head.append(
    el("strong", "title", named || info.title),
    el("span", "sub", info.dead ? "dead" : named ? `${info.title.toLowerCase()}, ${info.subtitle}` : info.subtitle),
    close,
  );
  const bars = el("div", "bars");
  for (const b of info.bars) {
    const row = el("div", "bar");
    const fill = el("i", "");
    fill.style.width = `${Math.round(b.value * 100)}%`;
    fill.style.background = b.value > 0.6 ? "#7ed492" : b.value > 0.3 ? "#f2c94c" : "#ef6b5b";
    const track = el("span", "track");
    track.append(fill);
    row.append(el("span", "label", b.label), track);
    bars.append(row);
  }
  const rows = el("dl", "rows");
  for (const [k, v] of info.rows) rows.append(el("dt", "", k), el("dd", "", v));
  card.replaceChildren(head, bars, rows);
  if (inspected && !inspected.dead) {
    const follow = el("button", "follow", "Follow");
    (follow as HTMLButtonElement).type = "button";
    const c = inspected;
    follow.addEventListener("click", () => {
      closeInspect();
      startWatch(c);
    });
    card.append(follow);
  }
  reportInspect();
}

// The island tells its stories (2026-11-11, director.ts). Left alone for a
// while, or on the Watch button, the camera goes to what is happening and
// follows it, close enough to read, with one line saying what it is. A tap on
// the island gives the camera back where it was and casts nothing; a drag or
// a pinch keeps it where the story is. When nobody watches, a line of weight
// 3 (a life begins or ends, a wonder wakes) shows for a few seconds, at most
// one every thirty: a tap on it goes there.
const IDLE_MS = 15_000;
const IDLE_SPELL_MS = 40_000;
// For thirty seconds after a cast, what it did to people comes first.
const IDLE_CAST_MS = 12_000;
const LINE_MS = 5000;
const LINE_EVERY_MS = 30_000;
const storyEl = document.getElementById("story") as HTMLButtonElement;
const watchEl = document.getElementById("watch") as HTMLButtonElement;
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
let director = new Director();
let watching = false;
let pinned = false;
let tapEndsWatch = false;
let watchBack: Pose | null = null;
let lastCastAt = -1e9;
let caption = "";
// Happenings told up to this world time; Infinity until the island has run a moment.
let toldUntil = Infinity;
let lineAt = -1e9;
let lineTimer = 0;
let lineGoes: { x: number; y: number; who: number } | null = null;
// What the watch showed, for the checks (scripts/watch-frames.mjs): seconds watched and seconds its subject was on screen.
const watchStats = { watched: 0, shots: 0, caption: "", px: 0, onScreen: false };
(window as unknown as { __mmWatch?: () => typeof watchStats }).__mmWatch = () => ({ ...watchStats, caption });

function say(text: string, go: boolean): void {
  if (text === caption && !storyEl.hidden && !storyEl.classList.contains("out")) return;
  caption = text;
  storyEl.replaceChildren(el("span", "line", text), ...(go ? [el("span", "go", "Go")] : []));
  storyEl.hidden = !text;
  storyEl.classList.remove("out");
  reportInspect();
}

function hush(): void {
  caption = "";
  storyEl.classList.add("out");
  reportInspect();
  window.setTimeout(() => {
    if (!caption) storyEl.hidden = true;
  }, 400);
}

function startWatch(pin: Creature | null = null, at: { x: number; y: number; who: number } | null = null): void {
  if (!engine || scenario) return;
  const o = engine.view.orbit;
  if (!watching) watchBack = { tx: o.tx, ty: o.ty, dist: o.dist, phi: o.phi, theta: o.theta };
  stopLook?.();
  watching = true;
  pinned = !!pin;
  clearTimeout(lineTimer);
  lineGoes = null;
  watchEl.setAttribute("aria-pressed", "true");
  watchEl.lastElementChild!.textContent = "Watching";
  director.reset();
  const who = pin ?? (at?.who ? engine.world.creatures.find((c) => c.id === at.who && !c.dead) : null) ?? null;
  if (who) director.pin(engine.world, who);
  // A line about a place: the camera goes there first; the director takes over after a few seconds.
  if (!who && at) o.watch(at.x, at.y, o.distanceFor(8));
  watchUntilFree = !who && at ? performance.now() + 5000 : 0;
  if (who && !pin) window.setTimeout(() => !pinned && watching && director.reset(), 6000);
  stepWatch();
}

function stopWatch(back: boolean): void {
  if (!watching) return;
  watching = false;
  pinned = false;
  watchEl.setAttribute("aria-pressed", "false");
  watchEl.lastElementChild!.textContent = "Watch";
  hush();
  marked = null;
  lastTouch = performance.now();
  if (!engine) return;
  const o = engine.view.orbit;
  o.unwatch();
  // Back where the player was, turned as they had it; taps in the next moment cast nothing (a double tap did).
  if (back && watchBack) {
    o.flyTo(watchBack.tx, watchBack.ty, watchBack.dist, watchBack.phi, 1.2, watchBack.theta);
    quietUntil = performance.now() + 700;
  }
  watchBack = null;
}

// The one the line is about has a pointer over its head: in a crowd of
// villagers the line alone does not say which (playtest, 11 November).
let marked: Creature | null = null;
const pointerEl = document.getElementById("pointer") as HTMLElement;
function point(): void {
  requestAnimationFrame(point);
  const c = watching && engine && marked && !marked.dead ? marked : null;
  const at = c && engine ? castOnScreen(engine, c.x, c.y, []) : null;
  pointerEl.hidden = !at;
  if (!at || !c) return;
  const lift = watchStats.px * (1.25 * Math.max(0.6, c.size) + 0.35) + c.z * watchStats.px * 0.5;
  pointerEl.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y - lift)}px)`;
}
requestAnimationFrame(point);

let watchUntilFree = 0;
let autoStartedAt = -1e9;
// The page shows something over the island (a dialog, another tab): nobody is watching.
let away = false;
function stepWatch(): void {
  if (!engine || !watching) return;
  const o = engine.view.orbit;
  if (performance.now() < watchUntilFree) return;
  const { shot } = director.update(engine.world);
  if (!shot) return;
  let line = shot.caption;
  if (shot.sort === "pin") {
    const c = engine.world.creatures.find((k) => k.id === shot.who);
    // The one followed is gone: back to the island's own stories.
    if (!c || c.dead) {
      pinned = false;
      director.reset();
      return;
    }
    line = lifeLine(engine.world, c);
  }
  // Close enough that a villager reads, never so close that it fills a wide screen.
  o.watch(shot.x, shot.y, Math.max(22, o.distanceFor(shot.r)));
  marked = shot.who ? (engine.world.creatures.find((k) => k.id === shot.who) ?? null) : null;
  say(line, false);
  measureWatch(shot);
}

// How large the subject is on screen, and whether it is on it: the number the update is held to.
function measureWatch(shot: Shot): void {
  if (!engine) return;
  const at = castOnScreen(engine, shot.x, shot.y, []);
  const o = engine.view.orbit;
  const rect = canvas.getBoundingClientRect();
  watchStats.px = rect.height / (2 * o.dist * Math.tan((o.camera.fov * Math.PI) / 360));
  watchStats.onScreen = !!at;
  watchStats.shots = director.cuts;
  watchStats.caption = shot.caption;
  watchStats.watched += 0.25;
}

canvas.addEventListener("pointerup", () => {
  // Still watching when the finger lifts: it was a tap, not a drag. The camera goes back.
  if (tapEndsWatch && watching && engine?.view.orbit.watching) stopWatch(true);
  tapEndsWatch = false;
});
watchEl.addEventListener("click", () => {
  lastTouch = performance.now();
  // It started by itself as the thumb came down: the press meant "watch", not "stop".
  if (watching && performance.now() - autoStartedAt < 1500) return;
  if (watching) stopWatch(true);
  else startWatch();
});
storyEl.addEventListener("click", () => {
  lastTouch = performance.now();
  if (watching) return;
  if (lineGoes) startWatch(null, lineGoes);
});

window.setInterval(() => {
  if (!engine) return;
  const now = performance.now();
  watchEl.hidden = !!scenario;
  if (watching) {
    // A drag, a pinch or a spell's own shot took the camera: the watch is over, the view stays.
    if (!engine.view.orbit.watching && now >= watchUntilFree && director.shot) return stopWatch(false);
    return stepWatch();
  }
  const world = engine.world;
  // A line when something big happens, for those not watching.
  if (toldUntil === Infinity) toldUntil = world.time;
  const news = world.happenings.filter((h) => h.t > toldUntil && h.weight >= 3);
  toldUntil = world.time;
  if (news.length && !scenario && !touring && now - lineAt > LINE_EVERY_MS && card.hidden) {
    const h = news[news.length - 1];
    lineAt = now;
    lineGoes = { x: h.x, y: h.y, who: h.who };
    say(h.text[0].toUpperCase() + h.text.slice(1), true);
    clearTimeout(lineTimer);
    lineTimer = window.setTimeout(() => {
      lineGoes = null;
      hush();
    }, LINE_MS);
  }
  // Left alone: the camera goes to the stories by itself. Never during a
  // challenge, the tour or a card, or
  // with reduced motion (the button still starts it).
  if (scenario || touring || away || !card.hidden || now < holdUntil || document.hidden || reduced()) return;
  const idle = now - lastTouch;
  const need = now - lastCastAt < 30_000 ? IDLE_CAST_MS : selected ? IDLE_SPELL_MS : IDLE_MS;
  if (idle >= need) {
    autoStartedAt = now;
    startWatch();
  }
}, 250);

// Library spells creatures and artifacts cast (3.7): asked of the page by
// name, kept for every world this frame runs.
const library: CastRequest[] = [];
const asked = new Set<string>();
window.setInterval(() => {
  if (!engine || !engine.runtime.wanted.size) return;
  const names = [...engine.runtime.wanted].filter((n) => !asked.has(n.toLowerCase())).slice(0, 20);
  engine.runtime.wanted.clear();
  for (const n of names) asked.add(n.toLowerCase());
  if (names.length) send({ type: "need", names });
}, 2000);

function mount(next: Engine): void {
  closeInspect();
  stopWatch(false);
  director = new Director();
  toldUntil = Infinity;
  stopLook?.();
  stopLook = null;
  touring = false;
  lookCard.hidden = true;
  engine?.dispose();
  unbind?.();
  engine = next;
  engine.runtime.setLibrary(library);
  engine.sound.muted = muted;
  unbind = engine.bindInput();
  showHud(hudOn);
  if (selected) {
    try {
      engine.runtime.compile(selected);
    } catch {
      // Reported when cast.
    }
  }
  engine.start();
}

// A new island (4.4.1): the seed, new or the player's, picks its shape and
// land from the sliders (land-options.ts, resolveLand).
function freshIsland(size: WorldSize, choice: LandChoice, seed: number | null): Engine {
  const s = seed ?? (Math.random() * 2 ** 31) | 0;
  return Engine.create(canvas, overlay, size, hooks, s, {}, resolveLand(choice, s, WORLD_SIZES[size] ?? WORLD_SIZES.medium), recent, pool);
}

// The wonder sets of the player's last islands (the page keeps them), and
// the first look at a new one (4.4.5 part B).
let recent: string[] = [];
let stopLook: (() => void) | null = null;
const lookCard = document.getElementById("first-look") as HTMLElement;
function showFirstLook(): void {
  if (!engine) return;
  const world = engine.world;
  send({ type: "island", name: world.islandName ?? "", signature: signatureOf(world.wonders.map((w) => w.kind)) });
  // The island is presented as it appears, and play starts over a village when the tour ends.
  if (world.wonders.length > 0 || world.islandName) startTour(engine, villageView(engine));
}

function startTour(on: Engine, back: Pose): void {
  touring = true;
  stopLook = firstLook(on, lookCard, window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, back, () => {
    touring = false;
  });
}

// A cast is saved 2 s after it lands, not at the next 10 s tick: a reload
// right after a cast lost it (2026-11-07), since the save asked on leaving the
// page is compressed asynchronously and the page is gone before it is written.
// Casts in a row push the save back, up to 2 s after the last one.
let soonTimer = 0;
const SAVE_AFTER_CAST_MS = 2000;
function saveSoon(): void {
  clearTimeout(soonTimer);
  soonTimer = window.setTimeout(save, SAVE_AFTER_CAST_MS);
}

// Challenge worlds are never saved: only the sandbox is the player's.
function save(): void {
  if (!engine || scenario) return;
  const data = engine.save();
  sandbox.save = data;
  send({ type: "save", data });
}

function loadRules(rules: CastRequest[]) {
  return (rt: Runtime) => {
    for (const spell of rules) {
      try {
        rt.compile(spell);
      } catch {
        // A broken spell loses its custom materials; the cells fall back.
      }
    }
  };
}

function openSandbox(): void {
  scenario = null;
  let restored: Engine | null = null;
  try {
    restored = sandbox.save ? Engine.restore(canvas, overlay, sandbox.save, hooks, loadRules(sandbox.rules)) : null;
  } catch (err) {
    // A save the game can no longer read starts a fresh island instead of a blank page.
    console.error("The saved world could not be restored", err);
    sandbox.save = null;
  }
  mount(restored ?? freshIsland(sandbox.size, sandbox.land, null));
  if (!restored) showFirstLook();
}

// The head start of the challenge being played, for a reset (L6).
let scenarioAhead = 0;

function openScenario(id: string, ahead = 0): void {
  const def = SCENARIOS.find((s) => s.id === id);
  if (!def) return;
  save();
  scenario = id;
  scenarioAhead = ahead;
  const { world, run, focus } = def.build();
  const next = new Engine(canvas, overlay, world, hooks);
  next.view.orbit.tx = focus.x;
  next.view.orbit.ty = focus.y;
  next.view.orbit.dist = focus.dist;
  let over = false;
  let last = "";
  next.onTick = () => {
    run.tick(world);
    if (over || world.tick % 15 !== 0) return;
    const { text, status } = run.check(world);
    if (status !== "playing") over = true;
    if (text !== last || over) {
      last = text;
      send({ type: "objective", id, text, status });
    }
  };
  // A live challenge (3.7): the hazard ran while the player merged. Played
  // here before the island is shown, at most LIVE_MAX (8) seconds of it.
  const ticks = Math.round(Math.max(0, Math.min(8, ahead)) * 30);
  for (let k = 0; k < ticks && !over; k++) next.step();
  world.events.length = 0;
  mount(next);
}

// The HUD follows the engine across resets and challenges; while it is on, a
// summary leaves every 30 seconds for the page to send to /api/perf.
function showHud(on: boolean): void {
  hudOn = on;
  if (!engine) return;
  hud ??= new Hud(engine.stats);
  hud.stats = engine.stats;
  hud.show(on);
  clearInterval(perfTimer);
  if (on) perfTimer = window.setInterval(() => engine && send({ type: "perf", sample: { ...engine.stats.summary(), challenge: scenario ? 1 : 0 } }), 30_000);
}

window.addEventListener("message", (e: MessageEvent<ToWorld>) => {
  if (e.source !== window.parent || !e.data || typeof e.data !== "object") return;
  const msg = e.data;
  switch (msg.type) {
    case "chronicle":
      // The sandbox's story, never a challenge's.
      if (engine && !scenario) send({ type: "chronicle", digest: chronicleDigest(engine.world) });
      break;
    case "library":
      library.push(...msg.spells);
      engine?.runtime.setLibrary(msg.spells);
      break;
    case "init": {
      muted = msg.muted;
      sandbox = { save: msg.save, size: msg.size, land: readChoice(msg.land), rules: msg.rules };
      recent = readRecent(msg.recent);
      pool = readPool(msg.wonders);
      setFinders(pool);
      openSandbox();
      clearInterval(saveTimer);
      saveTimer = window.setInterval(save, 10_000);
      break;
    }
    case "select":
      selected = msg.spell;
      if (selected) closeInspect();
      if (selected && engine) {
        try {
          engine.runtime.compile(selected);
        } catch (err) {
          hooks.onError(selected.key, selected.name, err instanceof Error ? err.message : String(err));
        }
      }
      break;
    case "spell-updated":
      if (selected?.key === msg.spell.key) selected = msg.spell;
      break;
    case "villager":
      if (engine) {
        const c = makeCreature("villager", engine.view.orbit.tx, engine.view.orbit.ty);
        engine.world.creatures.push(c);
      }
      break;
    case "reset":
      if (scenario) {
        openScenario(scenario, scenarioAhead);
        break;
      }
      sandbox.size = msg.size;
      sandbox.land = readChoice(msg.land);
      recent = readRecent(msg.recent);
      mount(freshIsland(msg.size, sandbox.land, msg.seed));
      showFirstLook();
      save();
      break;
    case "wonders":
      pool = readPool(msg.list);
      setFinders(pool);
      break;
    case "scenario":
      openScenario(msg.id, msg.ahead ?? 0);
      break;
    case "sandbox":
      if (scenario) openSandbox();
      break;
    case "away":
      away = msg.away;
      if (away) stopWatch(false);
      else lastTouch = performance.now();
      break;
    case "hud":
      showHud(msg.on);
      break;
    case "mute":
      muted = msg.muted;
      if (engine) engine.sound.muted = muted;
      break;
    case "visible":
      if (!engine) break;
      if (msg.visible) {
        engine.resize();
        engine.start();
      } else {
        stopWatch(false);
        engine.stop();
        save();
      }
      break;
  }
});

// What this device can run (4.4): the frame numbers of the island being
// played, every 30 seconds once enough frames were drawn. Challenges are
// smaller islands with their own hazards: not counted.
window.setInterval(() => {
  if (!engine || scenario) return;
  const s = engine.stats.summary();
  if (s.frames < 300) return;
  send({ type: "headroom", sample: { w: engine.world.w, simP95: s.simP95, frameP95: s.frameP95, frames: s.frames } });
}, 30_000);

// A heartbeat for the page's watchdog (4.0 review M3): spell code that never
// returns stops it, and the page replaces this frame.
window.setInterval(() => send({ type: "alive" }), 2000);

send({ type: "ready" });
