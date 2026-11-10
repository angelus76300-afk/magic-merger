// The frame HUD: what a frame costs, measured where it runs. Shown behind a
// long press on the title; while it is on, a summary goes to the page every
// 30 seconds and from there to /api/perf, so a session on a real phone comes
// back as numbers.

const RING = 600;

export interface FrameSample {
  // Wall time since the previous frame, simulation ticks and the draw call, ms.
  frame: number;
  sim: number;
  render: number;
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
    for (let i = 0; i < n; i++) total += this.frame[i];
    return {
      frames: n,
      fps: total > 0 ? round((n * 1000) / total) : 0,
      frameP50: pick(this.frame, 0.5),
      frameP95: pick(this.frame, 0.95),
      simP50: pick(this.sim, 0.5),
      simP95: pick(this.sim, 0.95),
      renderP50: pick(this.render, 0.5),
      renderP95: pick(this.render, 0.95),
      idle: this.idle,
      ...this.counts,
    };
  }
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}

// A small text panel in the corner of the World.
export class Hud {
  private el: HTMLDivElement;
  private timer = 0;

  constructor(public stats: FrameStats) {
    this.el = document.createElement("div");
    this.el.style.cssText =
      "position:absolute;left:6px;bottom:6px;z-index:5;pointer-events:none;font:11px/1.35 ui-monospace,Menlo,monospace;color:#e8fff0;background:rgba(0,0,0,.55);padding:4px 6px;border-radius:6px;white-space:pre";
    this.el.hidden = true;
    document.body.append(this.el);
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
    this.el.textContent = [
      `frame ${s.frameP50} / ${s.frameP95} ms (p50/p95) · ${s.fps} fps`,
      `sim ${s.simP50} / ${s.simP95} ms · draw ${s.renderP50} / ${s.renderP95} ms`,
      `calls ${s.calls} · tris ${k(s.triangles)} · dpr ${s.pixelRatio}`,
      `voxels ${k(s.voxels)} · creatures ${s.creatures} (${k(s.parts)} parts) · idle ${s.idle}`,
      `sound ${s.voices} voices · ${s.beds} beds · ${s.audioNodes} nodes · ${k(s.merged)} merged · ${k(s.dropped)} held`,
    ].join("\n");
  }
}
