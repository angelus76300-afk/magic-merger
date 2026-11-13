// Looks revamp, phase 1: frames of the three hand-made looks (scripts/looks-demo-models.ts) on an
// island, before (boxes only) and after (shapes, turns, grain, soft shadow), at phone sizes; and the
// frame time of a large island with 60 looks. Offline, in the Spell Lab (scripts/lab-browser.mjs).
//
//   npx esbuild scripts/looks-frames.ts --bundle --platform=node --format=esm --external:playwright \
//     --outfile=node_modules/.cache/looks-frames.mjs && node node_modules/.cache/looks-frames.mjs docs/measurements/looks-tools
//   ... looks-frames.mjs --perf      frame time, 60 looks of 160 parts (or of 80 boxes with --boxes)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error plain JavaScript module
import { openLab } from "./lab-browser.mjs";
import { demoOne, demoProgram } from "./looks-demo-models";
import { benchProps } from "./looks-bench";

const out = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "docs/measurements/looks-tools";
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "fold", width: 344, height: 882 },
];
const VIEW = { tier: "cosmic", kind: "spell", shots: [1], settle: 0.2, dist: 26, phi: 0.88, theta: 0.72, time: 40 };

interface Lab {
  page: { evaluate: (fn: (json: string) => unknown, arg: string) => Promise<unknown> };
  cast: (
    code: string,
    options: Record<string, unknown>,
  ) => Promise<{ frames: { png: string }[]; draw: { triangles: number; calls: number }; errors: string[]; timing?: unknown }>;
  close: () => Promise<void>;
}
const save = (file: string, png: string) => writeFileSync(file, Buffer.from(png.replace(/^data:image\/png;base64,/, ""), "base64"));

async function frames(): Promise<void> {
  mkdirSync(out, { recursive: true });
  for (const size of SIZES) {
    const lab = (await openLab({ width: size.width, height: size.height })) as unknown as Lab;
    for (const version of ["before", "after"] as const) {
      const r = await lab.cast(demoProgram(version), VIEW);
      if (r.errors?.length) console.error(r.errors);
      save(join(out, `${version}-${size.name}.png`), r.frames[r.frames.length - 1].png);
      // A closer look at each, the camera nearer.
      for (const k of ["tower", "cottage", "rune"] as const) {
        if (size.name !== "phone") continue;
        const c = await lab.cast(demoOne(k, version), { ...VIEW, dist: 14, phi: 0.78, theta: 0.7 });
        save(join(out, `${k}-${version}.png`), c.frames[c.frames.length - 1].png);
      }
      console.log(`${size.name} ${version}: drew ${r.draw.triangles} triangles in ${r.draw.calls} calls`);
    }
    await lab.close();
  }
}

// Frame time with 60 looks on the island, set straight into the lab's world (one item keeps 4
// models, so the looks are placed as 60 items would place them): 160 parts each with shapes and
// grain, or 80 plain boxes each (the most a look could have before). The first frame builds the
// mesh; the others draw it. Each frame waits for the GPU (gl.finish).
async function perf(): Promise<void> {
  const lab = (await openLab({ width: 390, height: 844 })) as unknown as Lab;
  for (const [name, props] of [
    ["no looks", []],
    ["60 looks of 80 plain boxes (the most before)", benchProps(false, false).map((p) => ({ ...p, boxes: p.boxes.slice(0, 80) }))],
    ["60 looks of 160 parts, shapes and grain", benchProps(true, true)],
  ] as const) {
    await lab.cast("const spell = { *cast(w) {} };", { tier: "cosmic", kind: "spell", shots: [0.1], settle: 0, dist: 60, phi: 0.95, time: 40 });
    const r = (await lab.page.evaluate((json: string) => {
      type E = {
        world: { w: number; h: number; props: { x: number; y: number }[]; propsVersion: number };
        view: { orbit: { tx: number; ty: number; dist: number }; renderer: { getContext(): WebGLRenderingContext; info: { render: { triangles: number } } } };
        step(): void;
        render(dt?: number): void;
      };
      const e = (window as unknown as { labEngine: E }).labEngine;
      const props = JSON.parse(json) as { x: number; y: number }[];
      const cx = e.world.w / 2;
      const cy = e.world.h / 2;
      e.world.props = props.map((p) => ({ ...p, x: cx - 40 + (p.x - 8), y: cy - 35 + (p.y - 8) }));
      e.world.propsVersion++;
      e.view.orbit.tx = cx;
      e.view.orbit.ty = cy;
      const gl = e.view.renderer.getContext();
      const t0 = performance.now();
      e.render(1 / 30);
      gl.finish();
      const first = performance.now() - t0;
      const ms: number[] = [];
      for (let k = 0; k < 40; k++) {
        e.step();
        const t = performance.now();
        e.render(1 / 30);
        gl.finish();
        ms.push(performance.now() - t);
      }
      ms.sort((a, b) => a - b);
      return { first, p50: ms[20], p95: ms[38], triangles: e.view.renderer.info.render.triangles };
    }, JSON.stringify(props))) as { first: number; p50: number; p95: number; triangles: number };
    console.log(
      `${name}: first frame ${r.first.toFixed(0)} ms (builds the mesh), then p50 ${r.p50.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms; ${r.triangles} triangles in the frame`,
    );
  }
  await lab.close();
}

await (process.argv.includes("--perf") ? perf() : frames());
