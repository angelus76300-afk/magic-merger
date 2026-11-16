// The looks revamp, phase 2: frames of the ten reference looks (shared/looks/), each alone on the
// Spell Lab's island at medium quality (its canvas is 540 by 540, in a page of 700 by 830, the
// owner's Fold unfolded), and one contact sheet of all ten at 700 by 830. Offline: no paid call, nothing leaves the machine.
//
//   npx esbuild scripts/looks-references-frames.ts --bundle --platform=node --format=esm --external:playwright \
//     --outfile=node_modules/.cache/looks-references-frames.mjs && node node_modules/.cache/looks-references-frames.mjs [out]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error plain JavaScript module
import { openLab } from "./lab-browser.mjs";
import { REFERENCES } from "../shared/looks";
import { drawnBy } from "./looks-refs-test";
import { readBox, type PropBox } from "../src/sim/props";

const out = process.argv[2] ?? "docs/visual-checks/looks-references";
const W = 700;
const H = 830;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

interface Lab {
  page: { evaluate: <T>(fn: (arg: T) => unknown, arg: T) => Promise<unknown> };
  cast: (code: string, options: Record<string, unknown>) => Promise<{ frames: { png: string }[]; errors: string[] }>;
  close: () => Promise<void>;
}

mkdirSync(out, { recursive: true });
const lab = (await openLab({ width: W, height: H })) as Lab;
const shots: { name: string; png: string; parts: number }[] = [];
try {
  for (const r of REFERENCES) {
    const parts = (drawnBy(r.code).calls[0]?.parts ?? []).map(readBox).filter((b): b is PropBox => b !== null);
    // The camera nearer for a small thing, farther for a temple: about two and a half times its size.
    const size = Math.max(...parts.map((b) => Math.max(b.x + b.w, b.y + b.d, -b.x, -b.y)));
    const tall = Math.max(...parts.map((b) => b.z + b.h));
    const dist = Math.max(7, Math.min(28, Math.max(size * 2.6, tall * 2.6) + 3.5));
    const res = await lab.cast(`const spell = { *cast(w) {\n${r.code}\n} };`, {
      tier: "cosmic",
      kind: "artifact",
      form: r.kind === "creature" ? "object" : r.kind,
      shots: [0.6],
      settle: 0.1,
      dist,
      phi: 0.9,
      theta: 0.75,
      time: 40,
      quality: "medium",
      aim: "clear",
      clear: { rx: 8, ry: 8 },
    });
    if (res.errors?.length) console.error(r.name, res.errors);
    const png = res.frames[res.frames.length - 1].png;
    writeFileSync(join(out, `${slug(r.name)}.png`), Buffer.from(png.split(",")[1], "base64"));
    shots.push({ name: r.name, png, parts: parts.length });
    console.log(`${r.name}: ${parts.length} parts, camera at ${dist.toFixed(1)}`);
  }
  // The contact sheet: the ten frames side by side, each cropped to its middle, with its name.
  const sheet = (await lab.page.evaluate(
    async ({ shots, W, H }: { shots: { name: string; png: string; parts: number }[]; W: number; H: number }) => {
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const g = c.getContext("2d")!;
      g.fillStyle = "#1b1d22";
      g.fillRect(0, 0, W, H);
      // Four across, three down: ten frames and a title, each the frame's middle band at full height.
      const cols = 4;
      const cw = W / cols;
      const ch = H / 3;
      g.fillStyle = "#f2efe6";
      g.font = "bold 17px sans-serif";
      g.fillText("Reference looks", W - cw * 2 + 14, H - ch + 40);
      g.font = "13px sans-serif";
      g.fillText("shared/looks, drawn at medium", W - cw * 2 + 14, H - ch + 62);
      g.fillText("on the Spell Lab island, 700x830", W - cw * 2 + 14, H - ch + 80);
      for (let i = 0; i < shots.length; i++) {
        const img = new Image();
        img.src = shots[i].png;
        await img.decode();
        const x = (i % cols) * cw;
        const y = Math.floor(i / cols) * ch;
        const sh = img.height;
        const sw = (sh * cw) / ch;
        g.drawImage(img, (img.width - sw) / 2, 0, sw, sh, x + 2, y + 2, cw - 4, ch - 4);
        g.fillStyle = "rgba(0,0,0,0.6)";
        g.fillRect(x + 2, y + ch - 38, cw - 4, 36);
        g.fillStyle = "#f2efe6";
        g.font = "13px sans-serif";
        g.fillText(shots[i].name, x + 8, y + ch - 22);
        g.fillText(`${shots[i].parts} parts`, x + 8, y + ch - 7);
      }
      return c.toDataURL("image/png");
    },
    { shots, W, H },
  )) as string;
  writeFileSync(join(out, "contact-sheet-700x830.png"), Buffer.from(sheet.split(",")[1], "base64"));
  console.log(`wrote ${shots.length} frames and the contact sheet to ${out}`);
} finally {
  await lab.close();
}
