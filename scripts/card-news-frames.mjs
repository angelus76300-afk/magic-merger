// A news line over an open villager card (23 November: at 832 by 1000 a line covered the card's
// name). At each of the five sizes (scripts/sizes.mjs): a villager tapped, its card open, then the
// island's story line shown with a news line as the frame shows one; a frame, and whether the
// line's box overlaps the card's title. Exit code 1 when it does at any size.
//   npm run build && node scripts/card-news-frames.mjs <out dir> [seed]
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { startLocalGame } from "./local-game.mjs";
import { SIZES } from "./sizes.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? "card-news";
const SEED = process.argv[3] ?? "21";
mkdirSync(OUT, { recursive: true });
const game = await startLocalGame();
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
let bad = 0;
try {
  for (const { name, width: W, height: H, touch } of SIZES.filter((s) => !process.env.ONLY || s.name === process.env.ONLY)) {
    const TOUCH = touch || W < 1000;
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: TOUCH });
    const page = await ctx.newPage();
    await page.addInitScript((t) => {
      try {
        localStorage.setItem("magic-merger.token", t);
      } catch {
        // the sandboxed frames have no storage
      }
    }, game.ADMIN);
    await page.goto(game.BASE + "/");
    await page.waitForSelector(".chip-inventory", { timeout: 30000 });
    await page.waitForTimeout(1500);
    const esc = async () => {
      for (let i = 0; i < 4 && (await page.locator("dialog[open]:not(.reset-island)").count()); i++) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      }
    };
    await esc();
    await page.click('.tab[data-view="world-view"]');
    await page.waitForTimeout(3000);
    await esc();
    const world = () => page.frames().find((f) => /\/world(\.html)?$/.test(new URL(f.url(), "http://x").pathname));
    await page.click("#world-reset");
    await page.waitForSelector("dialog.reset-island[open]");
    await page.fill("dialog.reset-island input[type=text]", SEED);
    await page.click("dialog.reset-island .primary");
    await page.waitForTimeout(4000);
    await page
      .locator("text=Got it")
      .click({ timeout: 1000 })
      .catch(() => undefined);
    const box = await (await world().frameElement()).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6);
    await page.waitForTimeout(2500);
    let open = false;
    for (let tries = 0; tries < 16 && !open; tries++) {
      const r = await world().evaluate(() => window.__mmBecome?.("villager"));
      if (!r?.tap) {
        await page.waitForTimeout(500);
        continue;
      }
      if (TOUCH && tries % 2 === 0) await page.touchscreen.tap(box.x + r.tap.x, box.y + r.tap.y);
      else await page.mouse.click(box.x + r.tap.x, box.y + r.tap.y);
      await page.waitForTimeout(700);
      open = (await world().locator("#inspect:not([hidden]) .title").count()) > 0;
    }
    // A news line, as the frame says one (say: the line, then Go).
    await world().evaluate(() => {
      const s = document.getElementById("story");
      s.replaceChildren(
        Object.assign(document.createElement("span"), {
          className: "line",
          textContent: "A house burned down in Morbrook, and its family will sleep by the ruins",
        }),
        Object.assign(document.createElement("span"), { className: "go", textContent: "Go" }),
      );
      s.hidden = false;
      s.classList.remove("out");
    });
    // The card redraws twice a second, and places the line as it does.
    await page.waitForTimeout(1200);
    const r = await world().evaluate(() => {
      const t = document.querySelector("#inspect .title")?.getBoundingClientRect();
      const s = document.getElementById("story").getBoundingClientRect();
      const over = !!t && t.bottom > s.top && t.top < s.bottom && t.right > s.left && t.left < s.right;
      return { title: t ? Math.round(t.bottom) : null, story: [Math.round(s.top), Math.round(s.bottom)], over, height: innerHeight };
    });
    const ok = open && !r.over && r.story[1] <= r.height;
    if (!ok) bad++;
    console.log(JSON.stringify({ size: `${W}x${H}`, name, card: open, ...r, ok }));
    await page.screenshot({ path: join(OUT, `card-news-${W}x${H}.jpg`), type: "jpeg", quality: 85 });
    await ctx.close();
  }
} finally {
  await browser.close();
  await game.stop?.();
}
process.exit(bad ? 1 : 0);
