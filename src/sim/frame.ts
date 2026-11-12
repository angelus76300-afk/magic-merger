import { clickActs, pressDown } from "./press";
import { chronicleDigest } from "./chronicle";
import { Engine, type WorldSize } from "./engine";
import { DEFAULT_LAND, readChoice, resolveLand, type LandChoice } from "./land";
import { WORLD_SIZES } from "./sizes";
import { C } from "./materials";
import { kindOf, makeCreature, maxHp, whyStopped, type Creature } from "./creatures";
import { artifactAt, creatureAt, inspect, inspectArtifact } from "./inspect";
import type { Artifact } from "./artifacts";
import { HOT_SLOTS, type FromWorld, type HotSlot, type ToWorld } from "./protocol";
import { solidCovers } from "./paths";
import { jobOf } from "./goals";
import { unpackLook } from "./villagers";
import type { CastRequest, Runtime } from "./runtime";
import type { SavedWorld } from "./save";
import { Hud } from "./hud";
import { SCENARIOS } from "./scenarios";
import { firstLook, villageView, type Pose } from "./firstlook";
import { fireOf, startWildfire, stoneAt, stoneLine, troubleLine, type Stone } from "./troubles";
import { Director, lifeLine, nameOf, whoIs, type Shot } from "./director";
import { act, checkHeld, deedsOf, doDeed, possess, possessed, powersOf, release, steerBy, stopNote, thoughtOf, type Deed } from "./possess";
import { aimAt, castFromEyes, eyesFirst, lookTheta, openLook, withinRange } from "./eyes";
import { castOnScreen, watchCast } from "./voxel/castview";
import { LAB_SKY, LAB_WEATHER } from "./voxel/sky";
import { LAND_REDRAW } from "./voxel/terrain";
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
// The creature the player is (Become, possess.ts), or null.
let riding: Creature | null = null;
canvas.addEventListener(
  "pointerdown",
  () => {
    // A tap that ends the tour or the watch casts nothing, unless a spell is in hand while
    // watching: then the tap is the cast, on what the camera shows (playtest, 11 November).
    swallowTap = touring || (watching && !selected);
    tapEndsWatch = watching;
    lastTouch = performance.now();
  },
  { capture: true },
);
function send(msg: FromWorld): void {
  window.parent.postMessage(msg, "*");
}

// A button that answers the finger as it comes down (pointerdown), so it works
// while another finger holds the stick: a click needs the whole page to be
// free of other touches, and with a thumb on the stick Cast, the acts, the eye,
// a slot and Let go did nothing (the playtest of 12 November). A click with
// no pointer before it (a key, a screen reader) still presses it.
// The click that follows a press is ignored whichever button it lands on (press.ts).
function press(b: HTMLElement, fn: () => void): void {
  b.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    pressDown(performance.now());
    fn();
  });
  b.addEventListener("click", (e) => {
    e.preventDefault();
    if (!clickActs(performance.now())) return;
    fn();
  });
}

// Keys pressed on the island stay in this frame: Escape is passed up so the
// vote after a cast closes as it does elsewhere on the page.
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") send({ type: "escape" });
});

const hooks = {
  onError: (key: string, name: string, message: string) => send({ type: "error", key, name, message }),
  // In the eye view a tap anywhere casts at the mark, the sky too (the playtest: taps on the upper half did nothing).
  onTapNothing: () => {
    if (swallowTap) {
      swallowTap = false;
      return;
    }
    if (riding && eyes) castFromEye();
  },
  onTap: (x: number, y: number) => {
    if (!engine) return;
    // A tap that ended the tour of the island only ends it (2026-11-11): it
    // cast where the tour's camera pointed, and the camera then flew away.
    if (swallowTap || performance.now() < quietUntil) {
      swallowTap = false;
      return;
    }
    if (engine.view.orbit.watching) return;
    // While the player is a creature (Become, 2026-11-12) a tap on the island
    // casts from it: in the eye view where the mark in the middle points, from
    // behind where the finger is, within 14 cells of it either way (eyes.ts).
    if (riding) {
      if (eyes) castFromEye();
      else if (selected) {
        const at = withinRange(riding.x, riding.y, x, y);
        castAt(at.x, at.y);
      }
      return;
    }
    if (!selected) {
      // A stone a village raised to the item that saved it (troubles.ts).
      const stone = stoneAt(engine.world, x, y);
      if (stone) return showStone(stone);
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
    castAt(x, y);
  },
};

// The player's cast at a cell of the island: from a tap, or from the eyes of
// the creature the player is (eyes.ts). The same cast either way.
function castAt(x: number, y: number): boolean {
  if (!engine || !selected || !engine.cast(selected, x, y)) return false;
  send({ type: "cast", key: selected.key });
  saveSoon();
  // The camera holds the cast for three seconds: nothing of the frame
  // moves it before then (the tour of the island waits, below).
  holdUntil = performance.now() + HOLD_MS;
  director.castAt(x, y, engine.world.time);
  // Where the cast is on screen for the next three seconds (castview.ts).
  const n = casts++;
  watchCast(
    () => (engine ? castOnScreen(engine, x, y, [card, lookCard]) : null),
    (at) => send({ type: "cast-view", n, x: at?.x ?? null, y: at?.y ?? null }),
  );
  return true;
}

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

function showStone(s: Stone): void {
  closeInspect();
  const close = el("button", "close", "×");
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", closeInspect);
  const head = el("div", "head");
  head.append(el("strong", "title", `The stone of ${s.village}`), el("span", "sub", ""), close);
  const rows = el("dl", "rows");
  rows.append(el("dt", "", "Says"), el("dd", "", stoneLine(s)), el("dt", "", "Raised"), el("dd", "", "by its people"));
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
    // Become, beside Follow: the player is this creature until they let go.
    // Not in a challenge, where the island is a puzzle to solve with spells.
    if (scenario) card.append(follow);
    else {
      const become = el("button", "follow become", "Become");
      (become as HTMLButtonElement).type = "button";
      become.addEventListener("click", () => {
        closeInspect();
        startBecome(c);
      });
      const pair = el("div", "pair");
      pair.append(follow, become);
      card.append(pair);
    }
  }
  reportInspect();
}

// The island tells its stories (2026-11-11, director.ts). On the Watch
// button, and only there (the owner, 12 November: "I don't like that it starts
// watching something automatically, don't auto toggle it"; it used to start
// by itself after 15 idle seconds), the camera goes to what is happening and
// follows it, close enough to read, with one line saying what it is. A tap on
// the island gives the camera back where it was and casts nothing; a drag or
// a pinch keeps it where the story is. When nobody watches, a line of weight
// 3 (a life begins or ends, a wonder wakes) shows for a few seconds, at most
// one every thirty: a tap on it goes there.
const LINE_MS = 5000;
const LINE_EVERY_MS = 30_000;
const storyEl = document.getElementById("story") as HTMLButtonElement;
const watchEl = document.getElementById("watch") as HTMLButtonElement;
let director = new Director();
let watching = false;
let pinned = false;
let tapEndsWatch = false;
let watchBack: Pose | null = null;
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
  if (!engine || scenario || riding) return;
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
  // The creature the player is has it too: under a roof or a tree it is still found at a glance (frames of 12 November).
  const c = watching && engine && marked && !marked.dead ? marked : riding && engine && !riding.dead && !eyes ? riding : null;
  const at = c && engine ? castOnScreen(engine, c.x, c.y, []) : null;
  pointerEl.hidden = !at;
  if (!at || !c || !engine) return;
  const o = engine.view.orbit;
  const px = riding === c ? canvas.getBoundingClientRect().height / (2 * o.dist * Math.tan((o.camera.fov * Math.PI) / 360)) : watchStats.px;
  const lift = px * (1.25 * Math.max(0.6, c.size) + 0.35) + c.z * px * (riding === c ? 1 : 0.5);
  pointerEl.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y - lift)}px)`;
}
requestAnimationFrame(point);

let watchUntilFree = 0;
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
  if (tapEndsWatch && watching && engine?.view.orbit.watching) stopWatch(!selected);
  tapEndsWatch = false;
});
watchEl.addEventListener("click", () => {
  lastTouch = performance.now();
  if (watching) stopWatch(true);
  else startWatch();
});
storyEl.addEventListener("click", () => {
  lastTouch = performance.now();
  if (watching || riding) return;
  if (lineGoes) startWatch(null, lineGoes);
});

// Become anything (2026-11-12, possess.ts): the player is one creature. The
// camera rides behind it (orbit.ts chase), the story line says who you are
// and what it thinks, a fixed stick walks it, its own abilities are buttons,
// and Let go ends it with the camera left where it is. Nothing of it is saved
// and nothing is sent: the frame keeps its own count for the checks.
const stickEl = document.getElementById("stick") as HTMLElement;
const knobEl = stickEl.firstElementChild as HTMLElement;
const powersEl = document.getElementById("powers") as HTMLElement;
const letGoEl = document.getElementById("letgo") as HTMLButtonElement;
const becomeStats = { presses: 0, seconds: [] as number[] };
let rideStart = 0;
let rideName = "";
let fellTimer = 0;
let powerNote: { text: string; until: number } | null = null;
// The thumb on the stick: where it is (-1 to 1, y down), against the view as it is now.
const stick = { x: 0, y: 0, id: -1 };

const POWER_WORDS: Record<string, string> = {
  "breathe fire": "Fire",
  heal: "Heal",
  summon: "Call",
  teleport: "Blink",
  freeze: "Freeze",
  lightning: "Bolt",
  grow: "Grow",
  "raise the dead": "Raise",
  shield: "Shield",
  dig: "Dig",
  flood: "Flood",
  steal: "Steal",
  cast: "Cast",
};

// Why an ability did nothing (abilities.ts fireAbility), and what one that worked did, when it is not plain to see.
const POWER_NOTHING: Record<string, string> = {
  heal: "No one here is hurt",
  shield: "A shield already stands here",
  dig: "Nothing to dig here: water or a plant",
};
const POWER_DONE: Record<string, string> = {
  heal: "Healed the hurt around you",
  shield: "A shield for 6 seconds",
  dig: "Dug a burrow",
};

function riderName(c: Creature): string {
  if (!engine) return "";
  const who = whoIs(engine.world, c);
  return c.kind === "villager" ? who : who[0].toLowerCase() + who.slice(1);
}

function startBecome(c: Creature): void {
  if (!engine || scenario || c.dead) return;
  stopWatch(false);
  if (!possess(engine.world, c)) return;
  riding = c;
  becomeStats.presses++;
  rideStart = performance.now();
  rideName = riderName(c);
  clearTimeout(lineTimer);
  clearTimeout(fellTimer);
  lineGoes = null;
  powerNote = null;
  document.body.classList.add("possessed");
  send({ type: "riding", on: true });
  stickEl.hidden = false;
  letGoEl.hidden = false;
  watchEl.hidden = true;
  powersEl.replaceChildren();
  drawPowers();
  tellRider();
  engine.view.orbit.chase(c.x, c.y, c.z, c.hd, kindOf(c).radius * c.size);
  eyeEl.hidden = false;
  eyesBack = false;
  // Its own acts and powers at the right thumb, in both views (a wolf had no button at all).
  actsEl.hidden = false;
  deedsEl.prepend(powersEl);
  drawDeeds();
  // Walkers start in their eyes; flyers and swimmers behind (eyes.ts).
  if (eyesFirst(kindOf(c))) setEyes(true);
  lastTouch = performance.now();
}

function endBecome(why: "let go" | "fell" | "gone"): void {
  const c = riding;
  if (!c) return;
  // Out of its eyes first: the page and the island's own buttons come back as they were.
  setEyes(false);
  // The spell in hand goes back in the book: the next tap on a creature inspects it (the playtest).
  if (selected) {
    selected = null;
    send({ type: "pick", key: null });
  }
  allEl.hidden = true;
  burnEl.hidden = true;
  eyeEl.hidden = true;
  eyesBack = false;
  actsEl.hidden = true;
  document.body.insertBefore(powersEl, letGoEl);
  riding = null;
  if (engine) {
    release(engine.world, why);
    // The camera stays where it is: it does not fly back.
    engine.view.orbit.unchase();
  }
  becomeStats.seconds.push(Math.round((performance.now() - rideStart) / 100) / 10);
  stick.x = stick.y = 0;
  stick.id = -1;
  knobEl.style.transform = "";
  document.body.classList.remove("possessed");
  send({ type: "riding", on: false });
  stickEl.hidden = true;
  letGoEl.hidden = true;
  powersEl.hidden = true;
  watchEl.hidden = !!scenario;
  lastTouch = performance.now();
  if (why !== "fell" || !engine) return hush();
  const name = c.kind === "villager" ? (c.mind?.title ?? nameOf(engine.world, c)) : `The ${c.kind.split("#")[0]}`;
  const line = `${name} fell`;
  say(line, false);
  fellTimer = window.setTimeout(() => caption === line && hush(), 3000);
}

// "You are Mira the fisher", and under it what she thinks now.
function tellRider(): void {
  if (!riding || !engine) return;
  const note = powerNote && performance.now() < powerNote.until ? powerNote.text : "";
  const thought = note || thoughtOf(engine.world, riding);
  const line = `You are ${rideName}`;
  // The island's trouble above the thought: it is the reason to cast (a wildfire reached its third stage while the line said "Hungry").
  const trouble = engine.world.trouble ? troubleLine(engine.world.trouble) : "";
  const hp = Math.max(0, Math.min(1, riding.hp / maxHp(riding)));
  const key = `${line}|${trouble}|${thought}|${Math.round(hp * 20)}`;
  if (caption === key && !storyEl.hidden && !storyEl.classList.contains("out")) return;
  caption = key;
  // Its health, a small bar by its name: burning used to be only a word, and death came with no warning.
  const bar = el("span", "hp");
  bar.setAttribute("role", "meter");
  bar.setAttribute("aria-label", "Health");
  bar.setAttribute("aria-valuenow", String(Math.round(hp * 100)));
  const fill = el("i", "");
  fill.style.width = `${Math.round(hp * 100)}%`;
  fill.style.background = hp > 0.6 ? "#7ed492" : hp > 0.3 ? "#f2c94c" : "#ef6b5b";
  bar.append(fill);
  const head = el("span", "line", line);
  head.append(bar);
  storyEl.replaceChildren(head, ...(trouble ? [el("span", "trouble", trouble[0].toUpperCase() + trouble.slice(1))] : []), el("span", "thought", thought));
  storyEl.hidden = false;
  storyEl.classList.remove("out");
  reportInspect();
}

function drawPowers(): void {
  if (!riding || !engine) return;
  const list = powersOf(engine.world, riding);
  powersEl.hidden = !list.length;
  if (powersEl.childElementCount !== list.length) {
    powersEl.replaceChildren(
      ...list.map((p, n) => {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("aria-label", p.spec.do === "cast" && p.spec.spell ? `Cast ${p.spec.spell}` : p.spec.do[0].toUpperCase() + p.spec.do.slice(1));
        b.append(el("span", "", POWER_WORDS[p.spec.do] ?? "Do"));
        press(b, () => usePower(n));
        return b;
      }),
    );
  }
  list.forEach((p, n) => {
    const b = powersEl.children[n] as HTMLElement;
    const ready = p.left <= 0 ? 100 : Math.round(Math.max(0, Math.min(1, 1 - p.left / Math.max(1, p.every))) * 100);
    b.style.setProperty("--ready", `${ready}%`);
    b.classList.toggle("cooling", p.left > 0);
  });
}

function usePower(n: number): void {
  if (!riding || !engine) return;
  lastTouch = performance.now();
  const spec = powersOf(engine.world, riding)[n]?.spec;
  const r = act(engine.world, n);
  // What happened, in words (the playtest of 12 November: Heal said "nothing in reach" beside two
  // villagers at full health, and a Shield going up showed nothing).
  if (r === "nothing" && spec)
    powerNote = { text: POWER_NOTHING[spec.do] ?? `${POWER_WORDS[spec.do] ?? "That"}: nothing in reach`, until: performance.now() + 2200 };
  else if (r === "done" && spec) powerNote = POWER_DONE[spec.do] ? { text: POWER_DONE[spec.do], until: performance.now() + 2200 } : null;
  // The dome is clear from the front: a ring of its colour shows it went up. Drawn here, not in the
  // engine, so the island's own shields and its random draws stay as they were.
  if (r === "done" && spec?.do === "shield") {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      engine.world.particles.add({
        x: riding.x + Math.cos(a) * 3,
        y: riding.y + Math.sin(a) * 3,
        z: 0.5,
        vz: 2,
        life: 0.9,
        color: 0x9fd8ff,
        size: 1.4,
        glow: true,
      });
    }
  } else if (r === "cooling" && spec) {
    const left = powersOf(engine.world, riding)[n]?.left ?? 0;
    powerNote = { text: `${POWER_WORDS[spec.do] ?? "That"}: ready in ${Math.ceil(left)} s`, until: performance.now() + 1800 };
  }
  if (r === "done" || r === "nothing") saveSoon();
  drawPowers();
  tellRider();
}

function moveStick(e: PointerEvent): void {
  const r = stickEl.getBoundingClientRect();
  const reach = r.width / 2 - 14;
  let dx = e.clientX - (r.left + r.width / 2);
  let dy = e.clientY - (r.top + r.height / 2);
  const d = Math.hypot(dx, dy);
  if (d > reach) {
    dx *= reach / d;
    dy *= reach / d;
  }
  knobEl.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
  stick.x = dx / reach;
  stick.y = dy / reach;
  lastTouch = performance.now();
}

// The stick keeps its own pointer: a thumb on it never turns the camera or casts.
stickEl.addEventListener("pointerdown", (e) => {
  if (!riding || !engine) return;
  e.preventDefault();
  e.stopPropagation();
  stickEl.setPointerCapture(e.pointerId);
  stick.id = e.pointerId;
  moveStick(e);
});
stickEl.addEventListener("pointermove", (e) => {
  if (e.pointerId === stick.id) moveStick(e);
});
const stickUp = (e: PointerEvent) => {
  if (e.pointerId !== stick.id) return;
  stick.x = stick.y = 0;
  stick.id = -1;
  knobEl.style.transform = "";
};
stickEl.addEventListener("pointerup", stickUp);
stickEl.addEventListener("pointercancel", stickUp);
stickEl.addEventListener("lostpointercapture", stickUp);
press(letGoEl, () => endBecome("let go"));

// Every frame while possessed: the stick to the creature, the camera to it.
function ride(): void {
  requestAnimationFrame(ride);
  if (!riding || !engine) return;
  const world = engine.world;
  const why = checkHeld(world);
  if (why || !possessed(world)) return endBecome(why ?? "gone");
  const o = engine.view.orbit;
  // The keys walk it when no thumb is on the stick (WASD or the arrows, on a desktop).
  const keyed = stick.id < 0 ? keyStick() : null;
  const sx = keyed ? keyed.x : stick.x;
  const sy = keyed ? keyed.y : stick.y;
  // The stick goes along the view as it is now, in both views: the camera
  // turns only when the player turns it (orbit.ts chase), so a push held one
  // way keeps the creature going that way on screen (the playtest of 12 November).
  steerBy(world, sx, sy, o.eye ? lookTheta(o.eye.yaw) : o.theta);
  const c = riding;
  o.chase(c.x, c.y, c.z, c.hd, kindOf(c).radius * c.size);
  if (eyes) drawMark();
  // Stopped against the sea, a cliff or the rim: why, held while it stays
  // stopped and two seconds after (it flickered with the thought at first).
  const stopped = stopNote(world, whyStopped);
  const now = performance.now();
  if (stopped && (!powerNote || powerNote.text === stopped || now > powerNote.until)) {
    powerNote = { text: stopped, until: now + 2000 };
    tellRider();
  }
  // A warm edge round the view while it burns.
  burnEl.hidden = !(c.burning > 0 && !c.dead);
}
requestAnimationFrame(ride);

// Through its eyes (2026-11-12, eyes.ts): the camera at the creature's head,
// a drag anywhere turns the look, the stick walks along it. The page hides its
// own header, drawer and tools (the "eyes" message) and the island shows what
// a first person game on a phone does: a mark in the middle, the creature's
// own acts and the cast at the right thumb, a hot bar of the last spells.
// Nothing of it is saved: it is the view and the buttons, possession stays as it was.
const eyeEl = document.getElementById("eye") as HTMLButtonElement;
const markEl = document.getElementById("mark") as HTMLElement;
const landingEl = document.getElementById("landing") as HTMLElement;
const actsEl = document.getElementById("acts") as HTMLElement;
const deedsEl = document.getElementById("deeds") as HTMLElement;
const castEl = document.getElementById("castbtn") as HTMLButtonElement;
const heldEl = document.getElementById("held") as HTMLElement;
const hotbarEl = document.getElementById("hotbar") as HTMLElement;
let eyes = false;
// The eye view was on when the World was hidden: it comes back with it.
let eyesBack = false;
let hot: HotSlot[] = [];
// A slot tapped whose spell is still being written: said until it is in hand.
let picking: string | null = null;
const eyeStats = { on: 0, off: 0, casts: 0, done: [] as string[] };

function setEyes(on: boolean): void {
  if (on && (!engine || !riding || riding.dead)) return;
  if (on === eyes) return;
  eyes = on;
  if (engine) {
    const o = engine.view.orbit;
    if (on && riding) {
      engine.view.eyeId = riding.id;
      // Facing a wall, a cliff or a bush, it looks the open way first (eyes.ts openLook).
      const w = engine.world;
      const h = engine.view.groundAt(riding.x, riding.y) + Math.max(0.6, kindOf(riding).radius * riding.size * 2.4);
      const solid = (x: number, y: number) => {
        const cx = Math.floor(x);
        const cy = Math.floor(y);
        return cx >= 0 && cy >= 0 && cx < w.w && cy < w.h && solidCovers(w)[w.cover[cy * w.w + cx]] === 1;
      };
      const yaw = openLook(riding.x, riding.y, h, riding.hd, engine.view.groundAt, solid);
      o.eyeOn(yaw, riding.x, riding.y, h);
    } else {
      o.eyeOff();
      engine.view.eyeId = -1;
    }
  }
  if (on) eyeStats.on++;
  else eyeStats.off++;
  document.body.classList.toggle("eyes", on);
  eyeEl.setAttribute("aria-pressed", String(on));
  eyeEl.lastElementChild!.textContent = on ? "Behind" : "Eyes";
  markEl.hidden = !on;
  landingEl.hidden = true;
  hotbarEl.hidden = !on;
  heldEl.hidden = true;
  castEl.hidden = true;
  picking = null;
  drawDeeds();
  drawHot();
  send({ type: "eyes", on });
  lastTouch = performance.now();
}

press(eyeEl, () => setEyes(!eyes));

// The way it faces for its acts: the look in the eye view, its heading behind it.
function facing(): number {
  const e = engine?.view.orbit.eye;
  return e ? e.yaw : (riding?.hd ?? 0);
}

// Its acts, redrawn as what is in front changes (a farmer's "Harvest" becomes "Sow").
function drawDeeds(): void {
  if (!riding || !engine) return deedsEl.querySelectorAll(".deed").forEach((b) => b.remove());
  const list = deedsOf(engine.world, riding, facing());
  const have = [...deedsEl.querySelectorAll<HTMLButtonElement>(".deed")].map((b) => `${b.dataset.deed}:${b.textContent}`);
  if (have.join() === list.map((d) => `${d.id}:${d.verb}`).join()) return;
  deedsEl.querySelectorAll(".deed").forEach((b) => b.remove());
  for (const d of list) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "deed";
    b.dataset.deed = d.id;
    b.textContent = d.verb;
    press(b, () => useDeed(d.id));
    deedsEl.append(b);
  }
}

function useDeed(d: Deed): void {
  if (!riding || !engine) return;
  lastTouch = performance.now();
  const r = doDeed(engine.world, d, facing());
  if (r && r !== "busy") {
    const text = "done" in r ? r.done : r.missing;
    powerNote = { text, until: performance.now() + 2000 };
    if ("done" in r) {
      eyeStats.done.push(`${d}:${r.done}`);
      saveSoon();
    }
  }
  drawDeeds();
  tellRider();
}

// A slot: its emoji, its name in the label, pressed while in hand, dimmed while being made.
function slotButton(h: HotSlot, label: string, held: string | null, then?: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.dataset.key = h.key;
  b.title = h.name;
  b.setAttribute("aria-label", `${h.name}${h.ready ? "" : ", being made"}${label}`);
  b.setAttribute("aria-pressed", String(h.key === held || h.key === picking));
  b.classList.toggle("waiting", !h.ready);
  press(b, () => {
    pick(h.key);
    then?.();
  });
  return b;
}

function drawHot(): void {
  if (!eyes) return;
  const held = selected?.key ?? null;
  if (picking && held === picking) picking = null;
  // Every spell and item the player owns, last used first as the page had them
  // when this creature was taken: the order stays while possessed, so the slot
  // under the thumb does not change after a cast (the playtest of 12 November).
  // It scrolls sideways; the button at its end opens the whole list with a search.
  const scroll = hotbarEl.scrollLeft;
  if (!hot.length) hotbarEl.replaceChildren(el("span", "empty", "No spells yet: make some in Craft"));
  else {
    const all = document.createElement("button");
    all.type = "button";
    all.className = "all";
    all.textContent = "All";
    all.setAttribute("aria-label", `All your spells and items (${hot.length})`);
    press(all, () => openAll());
    hotbarEl.replaceChildren(
      ...hot.map((h, n) => {
        const b = slotButton(h, n < 6 ? ` (${n + 1})` : "", held);
        b.textContent = h.emoji || "✦";
        return b;
      }),
      all,
    );
    hotbarEl.scrollLeft = scroll;
  }
  if (!allEl.hidden) drawAll();
  const slot = hot.find((h) => h.key === (held ?? picking));
  const name = slot?.name ?? selected?.name ?? "";
  heldEl.hidden = !name;
  heldEl.textContent = !name ? "" : held ? name : `${name} is being made`;
  castEl.hidden = !held;
  castEl.textContent = selected?.kind === "artifact" ? "Place" : "Cast";
  markEl.classList.toggle("held", !!held);
  if (!held) landingEl.hidden = true;
}

// The whole list over the view, with a search: the eye view stays behind it.
const allEl = document.getElementById("allspells") as HTMLElement;
const allList = allEl.querySelector(".list") as HTMLElement;
const allFind = allEl.querySelector("input") as HTMLInputElement;
const burnEl = document.getElementById("burn") as HTMLElement;
function openAll(): void {
  allEl.hidden = false;
  allFind.value = "";
  drawAll();
}
function drawAll(): void {
  const held = selected?.key ?? null;
  const q = allFind.value.trim().toLowerCase();
  const shown = hot.filter((h) => !q || h.name.toLowerCase().includes(q));
  allList.replaceChildren(
    ...(shown.length
      ? shown.map((h) => {
          const b = slotButton(h, "", held, () => (allEl.hidden = true));
          b.append(el("span", "emoji", h.emoji || "✦"), el("span", "name", h.name));
          return b;
        })
      : [el("p", "none", "Nothing by that name")]),
  );
}
allFind.addEventListener("input", drawAll);
press(allEl.querySelector(".close") as HTMLElement, () => (allEl.hidden = true));

function pick(key: string): void {
  lastTouch = performance.now();
  // The one in hand, tapped again, is put away.
  const away = key === (selected?.key ?? picking);
  picking = away ? null : key;
  send({ type: "pick", key: away ? null : key });
  drawHot();
}

// Where the spell in hand would land: a ring on the ground, the mark dashed when it is past the range.
function drawMark(): void {
  if (!engine || !selected) return;
  const e = engine.view.orbit.eye;
  if (!e) return;
  const at = aimAt(e, engine.view.groundAt, engine.world.w, engine.world.h);
  markEl.classList.toggle("far", !at.hit);
  const p = castOnScreen(engine, at.x, at.y, []);
  landingEl.hidden = !p;
  if (p) landingEl.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
}

function castFromEye(): void {
  if (!engine || !eyes || !selected) return;
  const e = engine.view.orbit.eye;
  if (!e) return;
  lastTouch = performance.now();
  const r = castFromEyes(e, engine.view.groundAt, engine.world.w, engine.world.h, castAt, (x, y) => !!engine && !!castOnScreen(engine, x, y, []));
  if (r.ok) eyeStats.casts++;
  if (r.why && riding) {
    powerNote = { text: r.why, until: performance.now() + 2000 };
    tellRider();
  }
}
press(castEl, castFromEye);

// The keys on a desktop: WASD or the arrows walk, 1 to 6 take a slot, Space casts.
const keysDown = new Set<string>();
const WALK_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};
function keyStick(): { x: number; y: number } | null {
  let x = 0;
  let y = 0;
  for (const k of keysDown) {
    const v = WALK_KEYS[k];
    if (v) {
      x += v[0];
      y += v[1];
    }
  }
  const d = Math.hypot(x, y);
  return d ? { x: x / d, y: y / d } : null;
}
window.addEventListener("keydown", (e) => {
  if (!riding) return;
  if (WALK_KEYS[e.code]) {
    keysDown.add(e.code);
    e.preventDefault();
  } else if (eyes && e.code === "Space") {
    castFromEye();
    e.preventDefault();
  } else if (eyes && /^Digit[1-6]$/.test(e.code)) {
    const slot = hot[Number(e.code.slice(5)) - 1];
    if (slot) pick(slot.key);
  }
});
window.addEventListener("keyup", (e) => keysDown.delete(e.code));
window.addEventListener("blur", () => keysDown.clear());

// A place for a frame of the checks: open ground near the nearest house, in
// the thickest woods or on the shore, and the look toward it. Only the checks call it.
type PlaceSort = "village" | "house" | "woods" | "shore" | "fire" | "tree" | "wall" | "street" | "cliff" | "sea";
function placeFor(sort: PlaceSort): { x: number; y: number; yaw: number } | null {
  if (!engine || !riding) return null;
  const w = engine.world;
  const free = (x: number, y: number) => w.inside(x, y) && w.cover[w.idx(x, y)] === C.NONE && w.depth[w.idx(x, y)] < 0.15;
  const near = (x: number, y: number, r: number, test: (i: number) => boolean) => {
    let n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (w.inside(x + dx, y + dy) && test(w.idx(x + dx, y + dy))) n++;
    return n;
  };
  let best: { x: number; y: number; yaw: number } | null = null;
  let bestD = Infinity;
  if (sort === "fire") {
    // Eight cells from the heart of the island's wildfire, on open ground, looking at it.
    const t = w.trouble;
    if (!t) return null;
    const f = fireOf(w, t);
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      const x = Math.round(f.x + Math.cos(a) * 8);
      const y = Math.round(f.y + Math.sin(a) * 8);
      if (free(x, y) && w.fire[w.idx(x, y)] < 0.05) return { x, y, yaw: a + Math.PI };
    }
    return null;
  }
  if (sort === "village") {
    // The biggest village, from open ground seven cells off its middle, looking at it.
    const v = [...w.settlements].sort((a, b) => near(b.x, b.y, 8, (i) => w.cover[i] === C.HOUSE) - near(a.x, a.y, 8, (i) => w.cover[i] === C.HOUSE))[0];
    if (!v) return null;
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      const x = Math.floor(v.x + Math.cos(a) * 7);
      const y = Math.floor(v.y + Math.sin(a) * 7);
      if (free(x, y) && free(x + Math.round(-Math.cos(a)), y + Math.round(-Math.sin(a)))) return { x: x + 0.5, y: y + 0.5, yaw: a + Math.PI };
    }
    return null;
  }
  for (let y = 4; y < w.h - 4; y++)
    for (let x = 4; x < w.w - 4; x++) {
      const d = Math.hypot(x - riding.x, y - riding.y);
      if (d >= bestD || !free(x, y)) continue;
      if (sort === "house") {
        // Three cells from a house wall, with the house straight ahead along +x, -x, +y or -y.
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          if (w.cover[w.idx(x + dx * 3, y + dy * 3)] !== C.HOUSE || !free(x + dx, y + dy) || !free(x + dx * 2, y + dy * 2)) continue;
          best = { x: x + 0.5, y: y + 0.5, yaw: Math.atan2(dy, dx) };
          bestD = d;
        }
      } else if (sort === "tree" || sort === "wall" || sort === "cliff") {
        // Right beside a trunk in woods, a house's wall, or the foot of a step of ground two cells or more high; facing it.
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const j = w.idx(x + dx, y + dy);
          const ok =
            sort === "tree"
              ? w.cover[j] === C.TREE && Math.abs(w.height[j] - w.height[w.idx(x, y)]) <= 1 && near(x, y, 3, (i) => w.cover[i] === C.TREE) >= 10
              : sort === "wall"
                ? w.cover[j] === C.HOUSE
                : w.height[j] - w.height[w.idx(x, y)] >= 4 && w.cover[j] === C.NONE;
          if (!ok) continue;
          best = { x: x + 0.5, y: y + 0.5, yaw: Math.atan2(dy, dx) };
          bestD = d;
        }
      } else if (sort === "street") {
        // Between two houses three cells apart or less, looking along the way between them.
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
        ]) {
          let a = 0;
          let b = 0;
          for (let k = 1; k <= 3; k++) {
            if (!a && w.inside(x - dy * k, y - dx * k) && w.cover[w.idx(x - dy * k, y - dx * k)] === C.HOUSE) a = k;
            if (!b && w.inside(x + dy * k, y + dx * k) && w.cover[w.idx(x + dy * k, y + dx * k)] === C.HOUSE) b = k;
          }
          if (!a || !b || !free(x + dx, y + dy) || !free(x + dx * 2, y + dy * 2)) continue;
          best = { x: x + 0.5, y: y + 0.5, yaw: Math.atan2(dy, dx) };
          bestD = d;
        }
      } else if (sort === "sea") {
        // On the beach, the open sea all the way to the world's rim straight ahead.
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          let k = 2;
          while (w.inside(x + dx * k, y + dy * k) && w.depth[w.idx(x + dx * k, y + dy * k)] > 0.5) k++;
          if (w.inside(x + dx * k, y + dy * k) || k < 6 || w.depth[w.idx(x + dx, y + dy)] > 0.5) continue;
          best = { x: x + 0.5, y: y + 0.5, yaw: Math.atan2(dy, dx) };
          bestD = d;
        }
      } else if (sort === "woods") {
        if (near(x, y, 4, (i) => w.cover[i] === C.TREE) < 22) continue;
        best = { x: x + 0.5, y: y + 0.5, yaw: riding.hd };
        bestD = d;
      } else {
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          if (!(w.depth[w.idx(x + dx * 4, y + dy * 4)] > 0.8) || near(x, y, 1, (i) => w.depth[i] > 0.15) > 2) continue;
          best = { x: x + 0.5, y: y + 0.5, yaw: Math.atan2(dy, dx) };
          bestD = d;
        }
      }
    }
  return best;
}

// For the checks (scripts/eyes-frames.mjs): the eye view as it stands, and a
// way to turn the look without a finger. Nothing of this is sent anywhere.
(
  window as unknown as {
    __mmEyes?: (look?: {
      yaw?: number;
      pitch?: number;
      turn?: number;
      place?: PlaceSort;
      become?: string;
      burn?: boolean;
      // For the frames of scripts/ground-frames.mjs: the creature put on a cell, another villager
      // put face to face with it, a time of day and a storm cloud held over it, for the drawing only.
      at?: { x: number; y: number };
      face?: number;
      clock?: number | null;
      rain?: boolean;
      // Starts (true) or ends (false) timing the view's frames: the median and 90th centile of each part, in ms.
      prof?: boolean;
    }) => unknown;
  }
).__mmEyes = (look) => {
  const o = engine?.view.orbit;
  const e = o?.eye;
  // Becomes the living creature of that kind nearest the middle of the view (when none is on screen to tap).
  if (look?.become && engine && !riding) {
    const o0 = engine.view.orbit;
    const kind = look.become;
    const w0 = engine.world;
    const who = w0.creatures
      .filter(
        (k) =>
          !k.dead &&
          (kind === "power"
            ? powersOf(w0, k).length > 0
            : kind.startsWith("job:")
              ? k.kind === "villager" && jobOf(k) === kind.slice(4) && unpackLook(k.look).age === "adult"
              : k.kind.split("#")[0] === kind),
      )
      .sort((a, b) => Math.hypot(a.x - o0.tx, a.y - o0.ty) - Math.hypot(b.x - o0.tx, b.y - o0.ty))[0];
    if (!who) return null;
    startBecome(who);
  }
  // Sets the creature the player is alight, as a fire it walked into would.
  if (look?.burn && riding) riding.burning = 30;
  if (look?.place && riding) {
    const at = placeFor(look.place);
    if (!at) return null;
    riding.x = at.x;
    riding.y = at.y;
    riding.hd = at.yaw;
    if (e) e.yaw = at.yaw;
  }
  if (look?.at && riding) {
    riding.x = look.at.x;
    riding.y = look.at.y;
  }
  if (look?.clock !== undefined) {
    LAB_SKY.time = look.clock;
    LAB_WEATHER.now = look.clock === null ? null : { kind: "clear", amount: 0 };
  }
  if (look?.rain !== undefined) {
    LAB_WEATHER.now = look.rain ? { kind: "rain", amount: 1 } : LAB_SKY.time === null ? null : { kind: "clear", amount: 0 };
    LAB_SKY.front = look.rain && riding ? { x: riding.x, y: riding.y, r: 36 } : null;
  }
  let faced: { x: number; y: number; id: number } | null = null;
  if (look?.face !== undefined && riding && engine && e) {
    const me = riding;
    const other = engine.world.creatures
      .filter((k) => !k.dead && k !== me && k.kind === "villager" && unpackLook(k.look).age === "adult")
      .sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
    if (other) {
      // On ground as high as the eye's, the first of a few distances from `face` on.
      const w = engine.world;
      const level = (x: number, y: number) => w.height[w.idx(Math.floor(x), Math.floor(y))];
      let d = look.face;
      for (const k of [0, 0.5, 1, 1.5, -0.3])
        if (level(e.x + Math.cos(e.yaw) * (look.face + k), e.y + Math.sin(e.yaw) * (look.face + k)) === level(e.x, e.y)) {
          d = look.face + k;
          break;
        }
      other.x = e.x + Math.cos(e.yaw) * d;
      other.y = e.y + Math.sin(e.yaw) * d;
      other.hd = e.yaw + Math.PI;
      // Held still for the frame, as a stunned creature stands.
      other.stun = 3;
      faced = { x: other.x, y: other.y, id: other.id };
    }
  }
  if (e && look) {
    if (look.yaw !== undefined) e.yaw = look.yaw;
    if (look.turn !== undefined) e.yaw += look.turn;
    if (look.pitch !== undefined) e.pitch = look.pitch;
  }
  let prof: Record<string, [number, number]> | null = null;
  if (look?.prof === true && engine) engine.view.profile = {};
  else if (look?.prof === false && engine?.view.profile) {
    const parts = engine.view.profile;
    const frames = Math.min(...Object.values(parts).map((v) => v.length));
    const total = Array.from({ length: frames }, (_, k) => Object.values(parts).reduce((a, v) => a + v[k], 0));
    prof = {};
    for (const [part, v] of [...Object.entries(parts), ["total", total] as const]) {
      const s = [...v].sort((a, b) => a - b);
      prof[part] = [Math.round(s[Math.floor(s.length / 2)] * 100) / 100, Math.round(s[Math.floor(s.length * 0.9)] * 100) / 100];
    }
    engine.view.profile = null;
  }
  const aim = e && engine ? aimAt(e, engine.view.groundAt, engine.world.w, engine.world.h) : null;
  return {
    eyes,
    eye: e ? { ...e } : null,
    aim,
    held: selected?.key ?? null,
    hot: hot.map((h) => h.key),
    deeds: riding && engine ? deedsOf(engine.world, riding, facing()).map((d) => d.verb) : [],
    ...eyeStats,
    fov: o?.camera.fov ?? 0,
    allCasts: casts,
    caption,
    rider: riding ? { kind: riding.kind, hp: Math.round(riding.hp), burning: riding.burning > 0, x: riding.x, y: riding.y } : null,
    trouble: engine?.world.trouble ? { stage: engine.world.trouble.stage, casts: engine.world.trouble.casts.length } : null,
    powers: riding && engine ? powersOf(engine.world, riding).map((p) => ({ do: p.spec.do, left: Math.round(p.left * 10) / 10 })) : [],
    draw: engine ? { calls: engine.view.renderer.info.render.calls, triangles: engine.view.renderer.info.render.triangles } : null,
    prof,
    size: engine ? { w: engine.world.w, h: engine.world.h } : null,
    faced,
  };
};

// For the checks (scripts/become-frames.mjs): how many times Become was pressed, the seconds of each
// time, their median, and where the creature is. `find`: the screen point of a living creature of
// that kind near the middle of the view, for a real tap on it. Nothing of this is sent anywhere.
(window as unknown as { __mmBecome?: (find?: string) => unknown }).__mmBecome = (find) => {
  const s = [...becomeStats.seconds].sort((a, b) => a - b);
  const median = s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
  const c = riding;
  let tap: { x: number; y: number } | null = null;
  if (find && engine) {
    const rect = canvas.getBoundingClientRect();
    let best = Infinity;
    for (const o of engine.world.creatures) {
      // "power": any creature with an ability of its own.
      if (o.dead || (find === "power" ? !powersOf(engine.world, o).length : o.kind.split("#")[0] !== find)) continue;
      const at = castOnScreen(engine, o.x, o.y, []);
      if (!at || at.y < 140 || at.y > rect.height - 150 || at.x < 30 || at.x > rect.width - 70) continue;
      const d = Math.hypot(at.x - rect.width / 2, at.y - rect.height / 2);
      if (d < best) {
        best = d;
        tap = { x: at.x, y: at.y };
      }
    }
  }
  return {
    presses: becomeStats.presses,
    times: becomeStats.seconds.length,
    seconds: becomeStats.seconds,
    median,
    riding: c ? { who: rideName, kind: c.kind, x: c.x, y: c.y, z: c.z, hd: c.hd, hp: c.hp } : null,
    chasing: engine?.view.orbit.chasing ?? false,
    caption,
    tap,
  };
};

window.setInterval(() => {
  if (!engine) return;
  const now = performance.now();
  watchEl.hidden = !!scenario || !!riding;
  if (riding) {
    // Nothing takes the camera while you are a creature: no watch, no news line.
    toldUntil = engine.world.time;
    tellRider();
    drawPowers();
    drawDeeds();
    return;
  }
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
  if (news.length && !scenario && !touring && !world.trouble && now - lineAt > LINE_EVERY_MS && card.hidden) {
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
}, 250);

// The island needs you (troubles.ts): a trouble starts only while the player
// is playing (a touch in the last minute, no tour, no challenge, the island's
// switch on), and the page is told what is seen of it, so the Craft tab can
// say it while the island waits there.
let troublesOn = true;
let troubleSaid = "";
window.setInterval(() => {
  if (!engine || scenario) return;
  const world = engine.world;
  const now = performance.now();
  const end = world.troubleEnd;
  if (end) {
    world.troubleEnd = null;
    troubleSaid = "";
    lineGoes = null;
    if (!watching && !riding) hush();
    send({ type: "trouble", running: false, text: end.line[0].toUpperCase() + end.line.slice(1), key: end.by?.key, outcome: end.outcome });
    saveSoon();
    return;
  }
  const t = world.trouble;
  if (t) {
    const text = troubleLine(t);
    if (text !== troubleSaid) {
      troubleSaid = text;
      send({ type: "trouble", running: true, text });
    }
    // The line stays on the island while it lasts, for those not watching: a tap goes there.
    // While you are a creature its line has the place; the trouble's comes back after Let go.
    if (!card.hidden && !watching && !riding && !storyEl.hidden) {
      lineGoes = null;
      hush();
    }
    if (!watching && !touring && !riding && card.hidden && (caption !== text || storyEl.hidden)) {
      const f = fireOf(world, t);
      clearTimeout(lineTimer);
      lineGoes = { x: f.x, y: f.y, who: 0 };
      say(text, true);
    }
    return;
  }
  if (!troublesOn || touring || away || document.hidden || now < holdUntil || now - lastTouch > 60_000 || world.time < world.troubleNext) return;
  if (!startWildfire(world)) world.troubleNext = world.time + 120;
  else saveSoon();
}, 1000);

// For the measure of a big spell: turns the one frame redraw of the land on or off and gives the
// longest run of frames in which the land had chunks left to redraw since the last call.
(window as unknown as { __mmLand?: (burst?: boolean) => { max: number; last: number } }).__mmLand = (burst) => {
  if (burst !== undefined) LAND_REDRAW.burst = burst;
  const out = { max: LAND_REDRAW.maxLag, last: LAND_REDRAW.lastLag };
  LAND_REDRAW.maxLag = 0;
  return out;
};

// For the checks that play a trouble in a browser (scripts/trouble-frames.mjs): starts one now, or says how it stands.
(window as unknown as { __mmTrouble?: (peek?: boolean) => string }).__mmTrouble = (peek = false) => {
  if (!engine || scenario) return "no island";
  const world = engine.world;
  if (!peek && !world.trouble) startWildfire(world);
  return world.trouble
    ? `${world.trouble.name} stage ${world.trouble.stage}`
    : `none; ${world.stones.length} stones; ${world.story[world.story.length - 1]?.text ?? ""}`;
};

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
  // Another island or a challenge: whoever the player was stays on the old one.
  endBecome("gone");
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
  // Weather is real on the player's island, never in a challenge.
  engine.world.weather = !scenario;
  // Spells answer each other there too (4.12, reactions.ts), never in a challenge.
  engine.world.reactions = !scenario;
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
      troublesOn = msg.troubles !== false;
      sandbox = { save: msg.save, size: msg.size, land: readChoice(msg.land), rules: msg.rules };
      recent = readRecent(msg.recent);
      pool = readPool(msg.wonders);
      setFinders(pool);
      openSandbox();
      clearInterval(saveTimer);
      saveTimer = window.setInterval(save, 10_000);
      break;
    }
    case "hotbar":
      hot = (Array.isArray(msg.slots) ? msg.slots : [])
        .filter((h) => h && typeof h.key === "string" && typeof h.name === "string")
        .slice(0, HOT_SLOTS)
        .map((h) => ({ key: h.key.slice(0, 120), name: h.name.slice(0, 60), emoji: String(h.emoji ?? "").slice(0, 8), ready: !!h.ready }));
      drawHot();
      break;
    case "select":
      selected = msg.spell;
      drawHot();
      if (selected && !riding) closeInspect();
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
    case "troubles":
      troublesOn = msg.on;
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
        if (eyesBack && riding) setEyes(true);
        eyesBack = false;
      } else {
        stopWatch(false);
        // The page comes back whole; the eyes come back with the island.
        if (eyes) {
          setEyes(false);
          eyesBack = true;
        }
        keysDown.clear();
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
