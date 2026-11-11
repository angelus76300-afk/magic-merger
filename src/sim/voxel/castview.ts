import { Vector3 } from "three";
import type { Engine } from "../engine";

// Where a cast is on screen (the first cast seen, 2026-11-11): the cell
// projected through the camera, in the frame's CSS pixels, or null when it
// is behind the camera, outside the canvas or under one of the given cards.
export function castOnScreen(engine: Engine, x: number, y: number, cards: HTMLElement[]): { x: number; y: number } | null {
  const view = engine.view;
  const world = engine.world;
  const p = new Vector3(x - world.w / 2, view.groundAt(x, y), y - world.h / 2).project(view.orbit.camera);
  if (p.z < -1 || p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) return null;
  const rect = engine.canvas.getBoundingClientRect();
  const sx = ((p.x + 1) / 2) * rect.width;
  const sy = ((1 - p.y) / 2) * rect.height;
  for (const card of cards) {
    if (card.hidden) continue;
    const r = card.getBoundingClientRect();
    if (sx >= r.left && sx <= r.right && sy >= r.top && sy <= r.bottom) return null;
  }
  return { x: sx, y: sy };
}

// Samples a cast four times a second for three seconds after it lands.
export function watchCast(sample: () => { x: number; y: number } | null, report: (at: { x: number; y: number } | null) => void): void {
  let k = 0;
  const timer = window.setInterval(() => {
    report(sample());
    if (++k >= 13) clearInterval(timer);
  }, 250);
}
