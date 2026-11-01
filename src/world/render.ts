import type { Incantation } from "../../shared/spell";
import type { CircleState } from "./cast";
import { bodyOf, type Creature, type CreatureType } from "./creatures";
import { GAS, LIQUID, M, MATERIALS } from "./materials";
import { hexToRgb } from "./particles";
import type { World } from "./world";

// Sprites as rows of letters, drawn facing right and scaled to the body size.
// S skin, T shirt, L legs, B fur, H head, G stone, Y glowing eyes, P spirit.
const SPRITES: Record<CreatureType, string[][]> = {
  villager: [
    ["SS", "TT", "TT", "LL"],
    ["SS", "TT", "TT", "L."],
    ["SS", "TT", "TT", ".L"],
  ],
  beast: [
    [".BBH", "BBBB", "L..L"],
    [".BBH", "BBBB", ".LL."],
  ],
  golem: [
    [".GG.", "GYYG", "GGGG", "GGGG", ".GG.", "G..G"],
    [".GG.", "GYYG", "GGGG", "GGGG", ".GG.", ".GG."],
  ],
  spirit: [["PP", "PP", ".P"]],
};

const SKY_TOP = 0x16112b;
const SKY_HORIZON = 0x4b3f72;

// Draws the world into a canvas one pixel per cell; CSS scales it up crisply.
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private image: ImageData;
  private buf: Uint32Array;
  private sky: Uint32Array;
  private palettes: Uint32Array[];

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly w: number,
    readonly h: number,
  ) {
    canvas.width = w;
    canvas.height = h;
    this.ctx = canvas.getContext("2d")!;
    this.image = this.ctx.createImageData(w, h);
    this.buf = new Uint32Array(this.image.data.buffer);
    this.sky = new Uint32Array(h);
    for (let y = 0; y < h; y++) this.sky[y] = abgr(mix(SKY_TOP, SKY_HORIZON, Math.min(1, y / (h * 0.65))));
    this.palettes = MATERIALS.map((m) => Uint32Array.from(m.colors.map(abgr)));
  }

  draw(world: World): void {
    this.drawCells(world);
    for (const c of world.creatures) this.drawCreature(c, world.time);
    for (const cast of world.casts) {
      const circle = cast.circle();
      if (circle) this.drawCircle(circle, cast.spec.incantation);
    }
    this.drawParticles(world);
    this.ctx.putImageData(this.image, 0, 0);
  }

  private drawCells(world: World): void {
    const { buf, sky, w, palettes } = this;
    const { mat, shade } = world.grid;
    for (let i = 0; i < mat.length; i++) {
      const m = mat[i];
      const y = (i / w) | 0;
      if (m === M.EMPTY) {
        buf[i] = sky[y];
        continue;
      }
      const palette = palettes[m];
      // Fire and lava flicker; everything else keeps its texture.
      const k = m === M.FIRE || (m === M.LAVA && Math.random() < 0.05) ? (Math.random() * palette.length) | 0 : shade[i] % palette.length;
      const behavior = MATERIALS[m].behavior;
      if (behavior === GAS) buf[i] = blendAbgr(sky[y], palette[k], 0.55);
      else if (behavior === LIQUID && m === M.WATER) buf[i] = blendAbgr(sky[y], palette[k], 0.85);
      else buf[i] = palette[k];
    }
  }

  private drawCreature(c: Creature, time: number): void {
    const { w: bw, h: bh } = bodyOf(c);
    const frames = SPRITES[c.type];
    const moving = Math.abs(c.vx) > 0.5 && !c.dead && c.frozen <= 0;
    const frame = frames[moving && frames.length > 1 ? 1 + (Math.floor(c.anim * 1.5) % (frames.length - 1)) : 0];
    const sh = frame.length;
    const sw = frame[0].length;
    const left = Math.round(c.x - bw / 2);
    const bottom = Math.floor(c.y);
    const colors: Record<string, number> = {
      S: 0xf1c27d,
      T: c.shirt,
      L: 0x3b2f2f,
      B: 0xe8e2d0,
      H: 0xd8cfb8,
      G: 0x7d7d88,
      Y: 0x9dfcff,
      P: 0xc9f6ff,
    };
    const alpha = c.type === "spirit" ? 0.55 + 0.25 * Math.sin(time * 6 + c.id) : 1;

    // The dead lie on their side, greyed.
    const outW = c.dead ? bh : bw;
    const outH = c.dead ? bw : bh;
    for (let oy = 0; oy < outH; oy++) {
      for (let ox = 0; ox < outW; ox++) {
        const sx0 = c.dead ? oy : ox;
        const sy0 = c.dead ? bh - 1 - ox : oy;
        const sx = Math.floor((sx0 * sw) / bw);
        const sy = Math.floor((sy0 * sh) / bh);
        const key = frame[sy][c.dir < 0 ? sw - 1 - sx : sx];
        if (key === ".") continue;
        let color = colors[key];
        if (c.dead) color = mix(color, 0x777777, 0.7);
        else if (c.frozen > 0) color = mix(color, 0xbfe6ff, 0.65);
        else if (c.burning > 0 && Math.random() < 0.3) color = 0xff8c1a;
        this.plot(left + ox, bottom - outH + 1 + oy, color, alpha, key === "Y" || key === "P");
      }
    }
    // A blinking "!" above frightened creatures.
    if (!c.dead && c.fear > 0 && Math.floor(time * 4) % 2 === 0) {
      this.plot(Math.round(c.x), bottom - bh - 2, 0xffe066, 1, true);
      this.plot(Math.round(c.x), bottom - bh - 3, 0xffe066, 1, true);
    }
    // A small "z" drifting up and down above sleepers, so sleep reads as sleep and not as idling.
    if (!c.dead && c.sleep > 0 && c.fear <= 0) {
      const rise = Math.floor(time * 2 + c.id) % 3;
      const zx = Math.round(c.x) + 1;
      const zy = bottom - bh - 2 - rise;
      this.plot(zx, zy, 0xa9c8ff, 0.9, true);
      this.plot(zx + 1, zy - 1, 0xa9c8ff, 0.9, true);
    }
  }

  private drawCircle(c: CircleState, inc: Incantation): void {
    const primary = hexToRgb(inc.primary);
    const secondary = hexToRgb(inc.secondary);
    const squash = c.flat ? 0.4 : 1;
    const point = (angle: number, radius: number) => ({
      x: c.x + Math.cos(angle) * radius,
      y: c.y + Math.sin(angle) * radius * squash,
    });
    // Each pixel of the circle is lit once. Glow adds light, so a pixel hit by
    // several ring steps, a star line and a rune used to saturate to white, and
    // every circle looked the same whatever its colors.
    const lit = new Set<number>();
    const dot = (x: number, y: number, color: number, alpha: number) => {
      const key = y * this.w + x;
      if (lit.has(key)) return;
      lit.add(key);
      this.plot(x, y, color, alpha, true);
    };

    // Rings.
    for (let k = 0; k < inc.rings; k++) {
      const radius = c.r * (1 - k * 0.2);
      const steps = Math.ceil(radius * 8);
      for (let s = 0; s < steps; s++) {
        const p = point((s / steps) * Math.PI * 2, radius);
        dot(Math.round(p.x), Math.round(p.y), k === 0 ? primary : secondary, c.alpha);
      }
    }
    // Runes: tiny 3 by 3 glyphs riding the outer ring.
    for (let i = 0; i < inc.runes; i++) {
      const p = point(-c.angle * 0.5 + (i / inc.runes) * Math.PI * 2, c.r * 0.9);
      const bits = runeBits(i * 7 + inc.symmetry * 13 + inc.rings);
      for (let b = 0; b < 9; b++) {
        if (bits & (1 << b)) dot(Math.round(p.x) + (b % 3) - 1, Math.round(p.y) + Math.floor(b / 3) - 1, primary, c.alpha);
      }
    }
    // Star polygon.
    const n = inc.symmetry;
    const step = n >= 5 ? Math.floor((n - 1) / 2) : 1;
    for (let i = 0; i < n; i++) {
      const a = point(c.angle + (i / n) * Math.PI * 2, c.r * 0.75);
      const b = point(c.angle + (((i + step) % n) / n) * Math.PI * 2, c.r * 0.75);
      const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
      for (let s = 0; s <= steps; s++) {
        const k = s / steps;
        dot(Math.round(a.x + (b.x - a.x) * k), Math.round(a.y + (b.y - a.y) * k), secondary, c.alpha * 0.9);
      }
    }
  }

  private drawParticles(world: World): void {
    const p = world.particles;
    const { mat, w, h } = world.grid;
    for (let i = 0; i < p.capacity; i++) {
      if (p.life[i] <= 0) continue;
      // Sparks are light in the air: one inside rock or earth would read as a glitch.
      const cx = Math.round(p.x[i]);
      const cy = Math.round(p.y[i]);
      if (cx >= 0 && cy >= 0 && cx < w && cy < h && MATERIALS[mat[cy * w + cx]].solid) continue;
      const alpha = Math.min(1, (p.life[i] / p.maxLife[i]) * 1.5);
      const size = p.size[i];
      const x0 = Math.round(p.x[i] - (size - 1) / 2);
      const y0 = Math.round(p.y[i] - (size - 1) / 2);
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) this.plot(x0 + dx, y0 + dy, p.color[i], alpha, p.glow[i] === 1);
      }
    }
  }

  // Blends one pixel; glowing pixels add light instead of covering.
  private plot(x: number, y: number, rgb: number, alpha: number, glow: boolean): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || alpha <= 0) return;
    const i = y * this.w + x;
    const dst = this.buf[i];
    const dr = dst & 0xff;
    const dg = (dst >> 8) & 0xff;
    const db = (dst >> 16) & 0xff;
    const sr = (rgb >> 16) & 0xff;
    const sg = (rgb >> 8) & 0xff;
    const sb = rgb & 0xff;
    let r: number, g: number, b: number;
    if (glow) {
      r = Math.min(255, dr + sr * alpha);
      g = Math.min(255, dg + sg * alpha);
      b = Math.min(255, db + sb * alpha);
    } else {
      r = dr + (sr - dr) * alpha;
      g = dg + (sg - dg) * alpha;
      b = db + (sb - db) * alpha;
    }
    this.buf[i] = 0xff000000 | (b << 16) | (g << 8) | r;
  }
}

function runeBits(seed: number): number {
  let h = Math.imul(seed + 1, 2654435761) >>> 0;
  h ^= h >>> 13;
  // Always keep the middle pixel and at least a few strokes so glyphs read as runes.
  return ((h & 0x1ff) | 0x10) & 0x1ff;
}

function abgr(rgb: number): number {
  return (0xff000000 | ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff)) >>> 0;
}

function mix(a: number, b: number, k: number): number {
  const r = ((a >> 16) & 0xff) * (1 - k) + ((b >> 16) & 0xff) * k;
  const g = ((a >> 8) & 0xff) * (1 - k) + ((b >> 8) & 0xff) * k;
  const bl = (a & 0xff) * (1 - k) + (b & 0xff) * k;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

function blendAbgr(base: number, top: number, k: number): number {
  const r = (base & 0xff) * (1 - k) + (top & 0xff) * k;
  const g = ((base >> 8) & 0xff) * (1 - k) + ((top >> 8) & 0xff) * k;
  const b = ((base >> 16) & 0xff) * (1 - k) + ((top >> 16) & 0xff) * k;
  return (0xff000000 | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
}
