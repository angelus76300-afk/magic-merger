import type { Engine } from "./engine";
import { floatAt, wonderInfo, type WonderInfo } from "./wonders";

// The first look at a new island (4.4.5 part B): its name over the whole
// island, then a short flight from wonder to wonder, each with its name and
// what it does, then down to a village where play starts. About four
// seconds a shot; a tap anywhere or Skip ends it at once. With reduced
// motion the camera stays put and the card alone tells the same.
// It ends at `back` (over a village, where play starts) and calls `onEnd`
// however it ends; a tap that ends it casts nothing (frame.ts).

const SHOT = 3.6;
const RARITY: Record<string, string> = { common: "", uncommon: "uncommon", rare: "rare", legendary: "legendary" };

function el(tag: string, cls: string, text = ""): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
}

function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const COUNT = ["no wonders", "one wonder", "two wonders", "three wonders", "four wonders", "five wonders"];

export interface Pose {
  tx: number;
  ty: number;
  dist: number;
  phi: number;
  // The way the camera faces; a pose without it keeps the current one.
  theta?: number;
}

// Where play starts on a new island: over a village, looking down at it.
export function villageView(engine: Engine): Pose {
  const world = engine.world;
  const orbit = engine.view.orbit;
  const home = world.creatures.find((c) => c.kind === "villager");
  return { tx: home?.x ?? orbit.tx, ty: home?.y ?? orbit.ty, dist: Math.max(world.w, world.h) * 0.42, phi: 0.95 };
}

export function firstLook(engine: Engine, card: HTMLElement, reducedMotion: boolean, back?: Pose, onEnd?: () => void): () => void {
  const world = engine.world;
  const orbit = engine.view.orbit;
  const wonders: WonderInfo[] = world.wonders.map(wonderInfo);
  const name = world.islandName ?? "A new island";
  const end = back ?? villageView(engine);
  let timer = 0;
  let spin = 0;
  let done = false;
  const show = (title: string, what: string, does: string) => {
    const skip = el("button", "skip", "Skip") as HTMLButtonElement;
    skip.type = "button";
    skip.addEventListener("click", stop);
    card.replaceChildren(el("p", "title", title), ...(what ? [el("p", "what", what)] : []), ...(does ? [el("p", "does", does)] : []), skip);
    card.hidden = false;
  };
  function stop(): void {
    if (done) return;
    done = true;
    clearTimeout(timer);
    clearInterval(spin);
    card.hidden = true;
    engine.canvas.removeEventListener("pointerdown", stop);
    card.removeEventListener("pointerdown", stop);
    if (!reducedMotion) orbit.flyTo(end.tx, end.ty, end.dist, end.phi, 1.6, end.theta);
    onEnd?.();
  }
  const intro = `${COUNT[Math.min(5, wonders.length)][0].toUpperCase()}${COUNT[Math.min(5, wonders.length)].slice(1)}: ${listOf(wonders.map((w) => w.label))}`;
  engine.canvas.addEventListener("pointerdown", stop);
  // The card sits over the middle of a narrow island: a tap on it ends the
  // tour too, as a tap anywhere else does (playtest, 2026-11-11).
  card.addEventListener("pointerdown", stop);
  if (reducedMotion) {
    show(name, intro, "");
    timer = window.setTimeout(stop, 7000);
    return stop;
  }
  const shots: (() => void)[] = [
    () => {
      orbit.flyTo(world.w / 2, world.h / 2, orbit.distanceFor(Math.max(world.w, world.h) * 0.55), 0.72, 1.2);
      show(name, intro, "");
    },
    ...world.wonders.map((w, k) => () => {
      const info = wonders[k];
      const at = w.kind === "floating rock" ? floatAt(world, w, world.time + 2) : { x: w.x, y: w.y };
      // A cave is seen from its mouth, an arch and bones from the side.
      const theta = w.kind === "cave mouth" ? Math.atan2(-w.ax, -w.ay) : w.kind === "stone arch" || w.kind === "bones" ? Math.atan2(-w.ay, w.ax) : undefined;
      orbit.flyTo(
        at.x,
        at.y,
        Math.max(16, orbit.distanceFor(Math.max(5, w.r * 1.3))),
        w.kind === "world tree" || w.kind === "floating rock" ? 1.05 : 0.95,
        1.4,
        theta,
      );
      const rarity = RARITY[info.rarity];
      const what = rarity ? `${capital(info.label)} · ${rarity}` : capital(info.label);
      // A player's discovery grown into the world (4.4.5 part C) says who found it.
      show(capital(info.name), info.by ? `${what} · found by ${info.by}` : what, info.does ? capital(info.does) + "." : "");
    }),
    // The island as a map (4.9 part 3): last, the whole island again with no card, its villages'
    // names over them (view.ts), before play starts in one of them.
    ...(world.settlements.length
      ? [
          () => {
            orbit.flyTo(world.w / 2, world.h / 2, orbit.distanceFor(Math.max(world.w, world.h) * 0.55), 0.72, 1.2);
            card.hidden = true;
          },
        ]
      : []),
  ];
  let k = 0;
  const next = () => {
    if (done) return;
    if (k >= shots.length) return stop();
    shots[k++]();
    timer = window.setTimeout(next, (k === 1 ? 3.4 : SHOT) * 1000);
  };
  // A slow turn during each shot.
  spin = window.setInterval(() => orbit.spin(0.004), 33);
  // From the first frame drawn, not from when the island was made.
  requestAnimationFrame(() => requestAnimationFrame(next));
  return stop;
}

function capital(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
