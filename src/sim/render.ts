import type { Camera } from "./camera";
import { kindOf } from "./creatures";
import { C, F, S } from "./materials";
import { envelope, type Body, type Visuals } from "./visuals";
import type { World } from "./world";

const VOID = "#0b0816";

// Draws the world from above. Terrain is painted one pixel per cell into an
// offscreen image (lit by its slope, shadowed by trees and houses), then
// scaled by the camera; creatures, bodies and particles are drawn on top at
// screen resolution so they stay readable at any zoom.
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private terrain: HTMLCanvasElement;
  private tctx: CanvasRenderingContext2D;
  private image: ImageData;
  private buf: Uint32Array;
  private dark: HTMLCanvasElement;
  private dctx: CanvasRenderingContext2D;
  dpr = 1;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private world: World,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.terrain = document.createElement("canvas");
    this.terrain.width = world.w;
    this.terrain.height = world.h;
    this.tctx = this.terrain.getContext("2d")!;
    this.image = this.tctx.createImageData(world.w, world.h);
    this.buf = new Uint32Array(this.image.data.buffer);
    this.dark = document.createElement("canvas");
    this.dctx = this.dark.getContext("2d")!;
  }

  // Matches the canvas to its CSS size times the device pixel ratio.
  fit(cssW: number, cssH: number, dpr: number): void {
    this.dpr = Math.min(2, dpr || 1);
    const w = Math.max(1, Math.round(cssW * this.dpr));
    const h = Math.max(1, Math.round(cssH * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  draw(cam: Camera, visuals: Visuals, time: number): void {
    const { ctx, world } = this;
    this.paintTerrain(time);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = VOID;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // World space: one unit is one cell.
    const s = cam.scale * this.dpr;
    const ox = (cam.viewW / 2 + cam.shakeX) * this.dpr - cam.x * s;
    const oy = (cam.viewH / 2 + cam.shakeY) * this.dpr - cam.y * s;
    ctx.setTransform(s, 0, 0, s, ox, oy);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrain, 0, 0);

    const px = 1 / s; // one device pixel, in cells
    this.drawShadows(visuals, px);
    for (const c of world.creatures) this.drawCreature(c, px, time);
    this.drawParticles(px, false);
    for (const b of visuals.bodies) this.drawBody(b, px, time);
    ctx.globalCompositeOperation = "lighter";
    this.drawParticles(px, true);
    for (const l of visuals.lights) this.glowCircle(l.x, l.y, l.r, l.color, 0.5 * envelope(l.t, l.dur));
    ctx.globalCompositeOperation = "source-over";
    for (const sw of visuals.shockwaves) {
      const k = sw.t / sw.dur;
      ctx.globalAlpha = Math.max(0, 1 - k);
      ctx.strokeStyle = hex(sw.color);
      ctx.lineWidth = Math.max(px * 2, sw.width * (1 - k * 0.5));
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, Math.max(0.1, sw.r * easeOut(k)), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const d of visuals.drawings) if (d.space === "world") this.safeDraw(() => d.fn(ctx, d.t));

    // Screen space: darkness with lights cut through, tints, flash.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const darkness = visuals.darknessLevel();
    if (darkness > 0.01) this.drawDarkness(cam, visuals, darkness);
    for (const t of visuals.tints) {
      ctx.globalAlpha = t.alpha * envelope(t.t, t.dur);
      ctx.fillStyle = hex(t.color);
      ctx.fillRect(0, 0, cam.viewW, cam.viewH);
    }
    if (visuals.flash > 0) {
      ctx.globalAlpha = Math.min(1, visuals.flash);
      ctx.fillStyle = hex(visuals.flashColor);
      ctx.fillRect(0, 0, cam.viewW, cam.viewH);
    }
    ctx.globalAlpha = 1;
    for (const d of visuals.drawings) if (d.space === "screen") this.safeDraw(() => d.fn(ctx, d.t));
  }

  // A spell's own drawing must not break the frame, or leave the context in a strange state.
  private safeDraw(fn: () => void): void {
    this.ctx.save();
    try {
      fn();
    } catch {
      // The runtime reports drawing errors; here we only keep the frame alive.
    }
    this.ctx.restore();
  }

  private paintTerrain(time: number): void {
    const { world, buf } = this;
    const { w, h, height, ground, fluid, depth, cover, fire, gas, gasAmt, shade, materials, temp } = world;
    const pick = (colors: number[], i: number) => colors[((shade[i] * colors.length) >> 8) % colors.length];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        // Light comes from the north west: slopes facing it are brighter.
        const dx = height[x < w - 1 ? i + 1 : i] - height[x > 0 ? i - 1 : i];
        const dy = height[y < h - 1 ? i + w : i] - height[y > 0 ? i - w : i];
        let light = 1 - (dx + dy) * 0.11 + (height[i] - 12) * 0.006;
        let color = pick(materials.get("ground", ground[i]).colors, i);

        const cv = cover[i];
        if (cv !== C.NONE) {
          const m = materials.get("cover", cv);
          color = pick(m.colors, i);
          if (cv === C.HOUSE) {
            // Roof ridge: the top row of each house is lighter.
            if (y > 0 && cover[i - w] !== C.HOUSE) light += 0.15;
          } else if (cv === C.TREE) light += ((shade[i] >> 3) % 3) * 0.06 - 0.05;
        } else if (x > 0 && y > 0) {
          // Trees, houses and boulders cast a short shadow to the south east.
          const nw = cover[i - w - 1];
          if (nw === C.TREE || nw === C.HOUSE || nw === C.BOULDER) light *= 0.72;
        }

        const f = fluid[i];
        if (f !== F.NONE && depth[i] > 0.002) {
          const d = depth[i];
          if (f === F.WATER) {
            const deep = Math.min(1, d / 5);
            let water = mix(0x4aa3e0, 0x163f78, deep);
            water = mix(water, 0xbfe8ff, Math.max(0, Math.sin(time * 1.6 + x * 0.35 + y * 0.22 + shade[i] * 0.05) - 0.82) * 2);
            color = mix(color, water, Math.min(0.92, 0.45 + d * 0.6));
            light = 1 + (light - 1) * 0.3;
          } else if (f === F.LAVA) {
            color = mix(pick(materials.get("fluid", f).colors, i), 0xffd36a, Math.random() < 0.04 ? 0.6 : 0);
            light = 1.1;
          } else {
            color = mix(color, pick(materials.get("fluid", f).colors, i), Math.min(1, 0.55 + d * 0.8));
            if (f === F.ICE) light = 1 + (light - 1) * 0.5;
          }
        }

        if (fire[i] > 0) {
          const flame = [0xffd36a, 0xffa43a, 0xff6a1a, 0xe8420f][(Math.random() * 4) | 0];
          color = mix(color, flame, 0.45 + fire[i] * 0.5);
          light = 1.15;
        } else if (temp[i] > 160) {
          color = mix(color, 0xff5a1a, Math.min(0.5, (temp[i] - 160) / 800));
        }

        let r = ((color >> 16) & 255) * light;
        let g = ((color >> 8) & 255) * light;
        let b = (color & 255) * light;
        const gs = gas[i];
        if (gs !== S.NONE && gasAmt[i] > 0.02) {
          const gc = materials.get("gas", gs).colors[0];
          const a = Math.min(0.75, gasAmt[i] * 0.8);
          r += (((gc >> 16) & 255) - r) * a;
          g += (((gc >> 8) & 255) - g) * a;
          b += ((gc & 255) - b) * a;
        }
        buf[i] = 0xff000000 | (clamp(b) << 16) | (clamp(g) << 8) | clamp(r);
      }
    }
    this.tctx.putImageData(this.image, 0, 0);
  }

  private drawShadows(visuals: Visuals, px: number): void {
    const { ctx } = this;
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    for (const c of this.world.creatures) {
      if (c.z < 0.4 || c.dead) continue;
      const r = Math.max(px * 2, kindOf(c).radius * c.size * 0.9);
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, r, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const b of visuals.bodies) {
      if (b.z < 0.4 || b.look === "none") continue;
      const r = Math.max(px * 2, b.r * Math.max(0.4, 1 - b.z / 80));
      ctx.globalAlpha = Math.max(0.15, 0.5 - b.z / 120);
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, r, r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawCreature(c: World["creatures"][number], px: number, time: number): void {
    const { ctx } = this;
    const k = kindOf(c);
    // Never smaller than a few screen pixels, or they vanish when zoomed out.
    const r = Math.max(px * 1.6, k.radius * c.size);
    const sx = c.x;
    const sy = c.y - c.z * 0.7;
    if (c.dead) {
      ctx.fillStyle = "#5a5560";
      ctx.fillRect(sx - r, sy - r * 0.5, r * 2, r);
      return;
    }
    let body = c.color;
    if (c.frozen > 0) body = mix(body, 0xbfe6ff, 0.7);
    else if (c.burning > 0 && Math.sin(time * 30 + c.id) > 0) body = 0xff8c1a;
    if (k.glow) {
      ctx.globalCompositeOperation = "lighter";
      this.glowCircle(sx, sy, r * 3, body, 0.35);
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.fillStyle = hex(body);
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    if (c.kind === "villager") {
      // A head, seen from above.
      ctx.fillStyle = "#f1c27d";
      ctx.beginPath();
      ctx.arc(sx, sy, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    } else if (c.kind === "golem") {
      ctx.fillStyle = "#c9f6ff";
      ctx.fillRect(sx - r * 0.4, sy - r * 0.2, r * 0.25, r * 0.25);
      ctx.fillRect(sx + r * 0.15, sy - r * 0.2, r * 0.25, r * 0.25);
    }
    // Status marks above the head.
    const mark = (color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(sx - px * 1.5, sy - r - px * 6, px * 3, px * 4);
    };
    if (c.fear > 0 && Math.floor(time * 4) % 2 === 0) mark("#ffe066");
    else if (c.sleep > 0) {
      ctx.fillStyle = "#a9c8ff";
      const rise = ((time * 1.5 + c.id) % 1) * r * 2;
      ctx.fillRect(sx + r * 0.5, sy - r - rise - px * 3, px * 3, px * 3);
    } else if (c.calm > 0 && Math.floor(time * 2 + c.id) % 3 === 0) mark("#ffc8dd");
  }

  private drawParticles(px: number, glowing: boolean): void {
    const { ctx } = this;
    const p = this.world.particles;
    for (let i = 0; i < p.capacity; i++) {
      if (p.life[i] <= 0 || (p.glow[i] === 1) !== glowing) continue;
      const size = Math.max(px * 1.5, p.size[i] * 0.5);
      ctx.globalAlpha = Math.min(1, (p.life[i] / p.maxLife[i]) * 1.6);
      ctx.fillStyle = hex(p.color[i]);
      ctx.fillRect(p.x[i] - size / 2, p.y[i] - p.z[i] * 0.7 - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  private drawBody(b: Body, px: number, time: number): void {
    const { ctx } = this;
    if (b.look === "none") return;
    const x = b.x;
    const y = b.y - b.z * 0.7;
    const r = Math.max(px * 2, b.r);
    if (b.glow) {
      ctx.globalCompositeOperation = "lighter";
      this.glowCircle(x, y, r * 2.6, b.color, 0.55);
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.fillStyle = hex(b.color);
    ctx.strokeStyle = hex(b.color2);
    switch (b.look) {
      case "orb":
      case "flame": {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, hex(b.color2));
        g.addColorStop(1, hex(b.color));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r * (b.look === "flame" ? 0.9 + Math.random() * 0.2 : 1), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "cloud":
        ctx.globalAlpha = 0.75;
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + b.id;
          ctx.fillStyle = hex(k % 2 ? b.color : b.color2);
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.35, r * 0.55, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      case "ring":
        ctx.lineWidth = Math.max(px * 2, r * 0.15);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case "shard":
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r * 0.45, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r * 0.45, y);
        ctx.closePath();
        ctx.fill();
        break;
      case "vortex":
        ctx.lineWidth = Math.max(px * 1.5, r * 0.08);
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.arc(x, y, r * (0.35 + k * 0.3), time * (4 - k) + k, time * (4 - k) + k + Math.PI * 1.3);
          ctx.stroke();
        }
        break;
      case "star": {
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2 + time;
          const rr = k % 2 ? r * 0.4 : r;
          ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
        break;
      }
    }
  }

  private glowCircle(x: number, y: number, r: number, color: number, alpha: number): void {
    if (r <= 0 || alpha <= 0) return;
    const { ctx } = this;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, alpha));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Night over the world, with holes where there is light: spell lights,
  // fire, lava and glowing creatures.
  private drawDarkness(cam: Camera, visuals: Visuals, amount: number): void {
    const { dark, dctx, world } = this;
    if (dark.width !== this.canvas.width || dark.height !== this.canvas.height) {
      dark.width = this.canvas.width;
      dark.height = this.canvas.height;
    }
    dctx.setTransform(1, 0, 0, 1, 0, 0);
    dctx.globalCompositeOperation = "source-over";
    dctx.clearRect(0, 0, dark.width, dark.height);
    dctx.fillStyle = `rgba(4,2,16,${Math.min(0.95, amount)})`;
    dctx.fillRect(0, 0, dark.width, dark.height);
    dctx.globalCompositeOperation = "destination-out";
    const s = cam.scale * this.dpr;
    const toScreen = (x: number, y: number) => [
      (x - cam.x) * s + (cam.viewW / 2 + cam.shakeX) * this.dpr,
      (y - cam.y) * s + (cam.viewH / 2 + cam.shakeY) * this.dpr,
    ];
    const hole = (x: number, y: number, r: number, a: number) => {
      const [sx, sy] = toScreen(x, y);
      const rr = r * s;
      const g = dctx.createRadialGradient(sx, sy, 0, sx, sy, rr);
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      dctx.fillStyle = g;
      dctx.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
    };
    for (const l of visuals.lights) hole(l.x, l.y, l.r, envelope(l.t, l.dur));
    for (const b of visuals.bodies) if (b.glow) hole(b.x, b.y - b.z * 0.7, b.r * 4, 0.9);
    for (const c of world.creatures) if (!c.dead && kindOf(c).glow) hole(c.x, c.y, 4, 0.8);
    // Fire and lava light their surroundings; sample them sparsely.
    const step = Math.max(2, Math.round(3 / Math.max(0.5, cam.scale / 3)));
    for (let y = 0; y < world.h; y += step) {
      for (let x = 0; x < world.w; x += step) {
        const i = y * world.w + x;
        if (world.fire[i] > 0.3 || world.fluid[i] === F.LAVA || world.materials.get(world.cover[i] ? "cover" : "ground", world.cover[i] || world.ground[i]).glow) hole(x, y, step * 2.2, 0.7);
      }
    }
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(dark, 0, 0);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

export function mix(a: number, b: number, k: number): number {
  const r = ((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k;
  const g = ((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k;
  const bl = (a & 255) * (1 - k) + (b & 255) * k;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

export function hex(c: number): string {
  return `#${(c & 0xffffff).toString(16).padStart(6, "0")}`;
}

function rgba(c: number, a: number): string {
  return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
}

function easeOut(k: number): number {
  return 1 - (1 - k) * (1 - k);
}
