import { GRAPHICS, LOOKS_FLAGS, LOOKS_STATE, QUALITIES, type LooksChoice } from "./voxel/graphics";

// The frame HUD: what a frame costs, measured where it runs. Shown behind a
// long press on the title; while it is on, a summary goes to the page every
// 30 seconds and from there to /api/perf, so a session on a real phone comes
// back as numbers.

const RING = 600;

// Where the camera was for a frame (the eye view, second pass): above the
// island, behind the creature the player is, or in its eyes. The owner's phone
// says which one was slow.
export const VIEWS = ["sky", "behind", "eyes"] as const;
export type ViewName = (typeof VIEWS)[number];

export interface FrameSample {
  // Wall time since the previous frame, simulation ticks and the draw call, ms.
  frame: number;
  sim: number;
  render: number;
  view?: ViewName;
}

export interface SceneCounts {
  calls: number;
  triangles: number;
  voxels: number;
  creatures: number;
  // Boxes drawn for creatures (3.5): what bodies cost.
  parts: number;
  pixelRatio: number;
  size: number;
  // Sound (4.8): voices and audio nodes alive, and what the budget merged or held back.
  voices: number;
  audioNodes: number;
  merged: number;
  dropped: number;
  beds: number;
}

export interface PerfSummary {
  frames: number;
  fps: number;
  frameP50: number;
  frameP95: number;
  simP50: number;
  simP95: number;
  renderP50: number;
  renderP95: number;
  // The view most of the frames were drawn in, and how many frames each had.
  view: ViewName;
  viewFrames: string;
  idle: number;
  calls: number;
  triangles: number;
  voxels: number;
  creatures: number;
  parts: number;
  pixelRatio: number;
  size: number;
  voices: number;
  audioNodes: number;
  merged: number;
  dropped: number;
  beds: number;
}

export class FrameStats {
  private frame = new Float32Array(RING);
  private sim = new Float32Array(RING);
  private render = new Float32Array(RING);
  private views = new Uint8Array(RING);
  private count = 0;
  private next = 0;
  // Frames skipped because nothing moved (see Engine.frame).
  idle = 0;
  counts: SceneCounts = {
    calls: 0,
    triangles: 0,
    voxels: 0,
    creatures: 0,
    parts: 0,
    pixelRatio: 1,
    size: 0,
    voices: 0,
    audioNodes: 0,
    merged: 0,
    dropped: 0,
    beds: 0,
  };

  push(s: FrameSample): void {
    this.frame[this.next] = s.frame;
    this.sim[this.next] = s.sim;
    this.render[this.next] = s.render;
    this.views[this.next] = Math.max(0, VIEWS.indexOf(s.view ?? "sky"));
    this.next = (this.next + 1) % RING;
    this.count = Math.min(RING, this.count + 1);
  }

  reset(): void {
    this.count = 0;
    this.next = 0;
    this.idle = 0;
  }

  summary(): PerfSummary {
    const n = this.count;
    const pick = (a: Float32Array, q: number) => {
      if (!n) return 0;
      const sorted = a.slice(0, n).sort();
      return round(sorted[Math.min(n - 1, Math.floor(q * n))]);
    };
    let total = 0;
    const per = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      total += this.frame[i];
      per[this.views[i]]++;
    }
    const most = per.indexOf(Math.max(...per));
    return {
      frames: n,
      fps: total > 0 ? round((n * 1000) / total) : 0,
      frameP50: pick(this.frame, 0.5),
      frameP95: pick(this.frame, 0.95),
      simP50: pick(this.sim, 0.5),
      simP95: pick(this.sim, 0.95),
      renderP50: pick(this.render, 0.5),
      renderP95: pick(this.render, 0.95),
      view: VIEWS[most],
      viewFrames: VIEWS.map((v, i) => `${v}:${per[i]}`).join(","),
      idle: this.idle,
      ...this.counts,
    };
  }
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}

// A small text panel in the corner of the World. With `pick` (the game), a
// row of switches under it for the looks (5.2.5): the quality level, "auto"
// for the device's own, and each look on or off by itself.
export class Hud {
  private el: HTMLDivElement;
  private text: HTMLDivElement;
  private row: HTMLDivElement | null = null;
  private timer = 0;

  constructor(
    public stats: FrameStats,
    private pick?: (choice: LooksChoice) => void,
    // Controls of the World the panel must never cover (the review of 13 November: its switches
    // sat over Watch and took its taps): the panel stands above whichever of them is shown.
    private avoid: string[] = [],
  ) {
    this.el = document.createElement("div");
    // Lines wrap, and the panel stops short of the column of buttons on the World's right (62 px):
    // only its own switches take taps.
    this.el.style.cssText =
      "position:absolute;left:6px;bottom:6px;z-index:5;pointer-events:none;font:11px/1.35 ui-monospace,Menlo,monospace;color:#e8fff0;background:rgba(0,0,0,.55);padding:4px 6px;border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere;max-width:calc(100vw - 76px);box-sizing:border-box";
    this.el.hidden = true;
    this.text = document.createElement("div");
    this.el.appendChild(this.text);
    if (pick) {
      this.row = document.createElement("div");
      this.row.className = "looks";
      this.row.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;pointer-events:none;white-space:normal";
      this.el.appendChild(this.row);
    }
    document.body.appendChild(this.el);
  }

  show(on: boolean): void {
    this.el.hidden = !on;
    clearInterval(this.timer);
    if (on) {
      this.stats.reset();
      this.draw();
      this.timer = window.setInterval(() => this.draw(), 500);
    }
  }

  private draw(): void {
    const s = this.stats.summary();
    const k = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(v));
    const choice = LOOKS_STATE.choice;
    this.text.textContent = [
      `frame ${s.frameP50} / ${s.frameP95} ms (p50/p95) · ${s.fps} fps`,
      `sim ${s.simP50} / ${s.simP95} ms · draw ${s.renderP50} / ${s.renderP95} ms`,
      `calls ${s.calls} · tris ${k(s.triangles)} · dpr ${s.pixelRatio}`,
      `voxels ${k(s.voxels)} · creatures ${s.creatures} (${k(s.parts)} parts) · idle ${s.idle}`,
      `sound ${s.voices} voices · ${s.beds} beds · ${s.audioNodes} nodes · ${k(s.merged)} merged · ${k(s.dropped)} held`,
      ...(choice
        ? [
            `looks ${choice.level === "auto" ? `auto (${LOOKS_STATE.level})` : choice.level}${choice.flip.length ? ` · changed: ${choice.flip.join(", ")}` : ""}`,
          ]
        : []),
    ].join("\n");
    this.drawRow();
    this.place();
  }

  // Above the controls it must not cover, those shown now: Watch, the stick, the first look's card.
  private place(): void {
    let bottom = 6;
    for (const sel of this.avoid) {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el || el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      bottom = Math.max(bottom, Math.ceil(innerHeight - r.top) + 6);
    }
    this.el.style.bottom = `${bottom}px`;
  }

  // The switches, drawn again when what they show changed.
  private shown = "";
  private drawRow(): void {
    const row = this.row;
    const pick = this.pick;
    const choice = LOOKS_STATE.choice;
    if (!row || !pick || !choice) return;
    const key = JSON.stringify([choice, LOOKS_STATE.level, LOOKS_FLAGS.map((f) => GRAPHICS[f])]);
    if (key === this.shown) return;
    this.shown = key;
    row.replaceChildren();
    const button = (label: string, on: boolean, act: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.setAttribute("aria-pressed", String(on));
      b.style.cssText = `pointer-events:auto;font:11px ui-monospace,Menlo,monospace;min-height:44px;min-width:44px;padding:0 9px;border-radius:6px;border:1px solid ${on ? "#9ef0b8" : "rgba(255,255,255,.3)"};background:${on ? "rgba(80,200,120,.35)" : "rgba(0,0,0,.35)"};color:#e8fff0`;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        act();
        this.draw();
      });
      row.appendChild(b);
    };
    for (const level of ["auto", ...QUALITIES] as const) button(level, choice.level === level, () => pick({ level, flip: [] }));
    for (const f of LOOKS_FLAGS)
      button(f, GRAPHICS[f], () => pick({ level: choice.level, flip: choice.flip.includes(f) ? choice.flip.filter((x) => x !== f) : [...choice.flip, f] }));
  }
}
