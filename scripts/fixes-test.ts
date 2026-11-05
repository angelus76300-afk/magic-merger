import { memoryD1 } from "./d1-memory";
import { noteRun, runsOn } from "../worker/cron";
import { RUNS_A_DAY, due as dailyDue } from "../worker/daily";
import { designDue, DESIGN_EVERY_MS } from "../worker/evolve";
import { sweep } from "../worker/ledger";
import { looksLikeRefusal } from "../worker/prompts";
import { fewestMerges, leastMerges } from "../shared/challenges";
import { readResult, reportable, unfinishedRun } from "../src/checkresult";
import { Runtime } from "../src/sim/runtime";
import { stepHeadless } from "../src/sim/tick";
import { TICK, generateWorld } from "../src/sim/world";
import { C } from "../src/sim/materials";
import { seeded } from "../src/sim/noise";
import { readFileSync } from "node:fs";
import { entryId, whatIsNew } from "../shared/changelog";
import { setFinders, wonderInfo, type Wonder, type WonderDef } from "../src/sim/wonders";
import { isPlaceholderDescription, noDescription } from "../shared/refusal";

// The audit's fixes (4.5.1, docs/AUDIT-2026-11-05.md), run by npm test
// (scripts/sim-test.ts, section 13). Each check was seen to fail with its fix
// taken out. Not reached from Node: the page's call sites in src/worldhost.ts and src/whatsnew.ts,
// which use the functions tested here (reportable, whatIsNew).
type Check = (name: string, ok: boolean, detail?: string) => void;

export async function fixesChecks(check: Check): Promise<void> {
  // Risk 2: a paid nightly job that stores nothing must not run again at the
  // next ten minute cron.
  {
    const db = memoryD1();
    const now = Date.UTC(2026, 10, 5, 12);
    for (const key of ["one", "two", "three"])
      await db
        .prepare("INSERT INTO gaps (key, missing, at) VALUES (?, 'a way to stop wind', ?)")
        .bind(key, now - 60_000)
        .run();
    const before = await designDue(db, now);
    await noteRun(db, "design", "2026-11-05", now);
    const after = await designDue(db, now + 10 * 60_000);
    const nextDay = await designDue(db, now + DESIGN_EVERY_MS + 1);
    check(
      "a design that stored nothing is not asked again ten minutes later, and is the next day",
      before && !after && nextDay,
      `due before ${before}, ten minutes after an attempt ${after}, a day later ${nextDay}`,
    );
    const day = "2026-11-05";
    const first = await dailyDue(db, now);
    for (let i = 0; i < RUNS_A_DAY; i++) await noteRun(db, "daily", day, now + i * 600_000);
    const later = await dailyDue(db, now + RUNS_A_DAY * 600_000);
    check(
      `a night with no new item stops after ${RUNS_A_DAY} runs, not one every ten minutes`,
      first === day && later === null && (await runsOn(db, "daily", day)) === RUNS_A_DAY,
      `due ${first}, then ${later} after ${await runsOn(db, "daily", day)} runs`,
    );
  }
  // D.M4, M5, M6: the sweep bills a dead request's hold, waits for a wonder's
  // batch, and frees the hold of a rewrite that never got a batch.
  {
    const db = memoryD1();
    const now = Date.UTC(2026, 10, 5, 12);
    const hold = (call: string, at: number, usd: number) =>
      db.prepare("INSERT INTO reservations (req, invite, call, at, usd) VALUES ('r', 'x', ?, ?, ?)").bind(call, at, usd).run();
    const dead = Number((await hold("merge", now - 2 * 3600_000, 0.004)).meta.last_row_id);
    const wonder = Number((await hold("wonder", now - 2 * 3600_000, 0.1)).meta.last_row_id);
    await db
      .prepare(
        "INSERT INTO wonders (source, kind, rarity, status, model, reservation, estimate, created_at) VALUES ('daily', '', 'rare', 'pending', 'm', ?, 0.1, ?)",
      )
      .bind(wonder, now - 2 * 3600_000)
      .run();
    const orphan = Number((await hold("batch", now - 3 * 86400_000, 0.06)).meta.last_row_id);
    await db
      .prepare("INSERT INTO rewrites (key, cause, at, status, reservation) VALUES ('fire', 'refresh', ?, 'pending', ?)")
      .bind(now - 3 * 86400_000, orphan)
      .run();
    const waiting = Number((await hold("batch", now - 3 * 86400_000, 0.06)).meta.last_row_id);
    await db
      .prepare("INSERT INTO rewrites (key, cause, at, status, reservation, batch) VALUES ('ice', 'votes', ?, 'pending', ?, 'msgbatch_1')")
      .bind(now - 3 * 86400_000, waiting)
      .run();
    await sweep(db, now);
    // Still held: the row is there and not settled (a settled hold over two days old is deleted).
    const held = async (id: number) => !!(await db.prepare("SELECT 1 AS n FROM reservations WHERE id = ? AND settled = 0").bind(id).first());
    const billed = await db.prepare("SELECT call, usd FROM spend").all<{ call: string; usd: number }>();
    const orphanRow = await db.prepare("SELECT status FROM rewrites WHERE key = 'fire'").first<{ status: string }>();
    check(
      "the sweep bills a dead request's hold at its estimate",
      !(await held(dead)) && billed.results.some((r) => r.call === "merge-unsettled" && r.usd === 0.004),
      JSON.stringify(billed.results),
    );
    check(
      "the sweep leaves a daily wonder's hold to its batch",
      (await held(wonder)) && !billed.results.some((r) => r.call.startsWith("wonder")),
      JSON.stringify(billed.results),
    );
    check(
      "a rewrite that never got a batch is failed and its hold freed; one with a batch keeps its hold",
      orphanRow?.status === "failed" && !(await held(orphan)) && (await held(waiting)),
      `orphan ${orphanRow?.status}, still held ${await held(orphan)}; the waiting one still held ${await held(waiting)}`,
    );
  }

  // Section 2 of the audit: w.body() dropped `data`, so Starfall Rain's
  // healing loop read NaN and never ran (32 live programs pass `data`).
  {
    const world = generateWorld(48, 48, 3);
    const errors: string[] = [];
    const rt = new Runtime(world, (_k, _n, m) => errors.push(m));
    rt.cast(
      {
        key: "starfall",
        name: "Starfall",
        tier: "minor",
        code: "const spell = { *cast(w) { w.body({ x: w.x, y: w.y, look: 'none', life: 3, data: { h: 0, beats: 0, seen: 7 }, tick(b, w, dt) { b.data.h += dt; if (b.data.h > 1) { b.data.h = 0; b.data.beats++; } } }); yield 2.5; } };",
      },
      24,
      24,
    );
    for (let k = 0; k < 75; k++) stepHeadless(world, rt);
    const data = rt.visuals.bodies[0]?.data as { beats?: number; seen?: number } | undefined;
    check("a body keeps the data its program gives it", !errors.length && data?.seen === 7 && (data?.beats ?? 0) >= 2, JSON.stringify({ data, errors }));
  }
  // C.R42-5, M3: a test run that timed out is not a pass for everyone.
  {
    const late = readResult({ ok: true, problem: null, detail: "The test run did not finish in time", unfinished: true });
    const lie = readResult({ ok: false, problem: null, unfinished: true });
    check(
      "a test run that did not finish is marked unfinished, and a failure never is",
      late.ok && late.unfinished === true && !lie.ok && lie.problem === "crash" && lie.unfinished === undefined,
      JSON.stringify({ late, lie }),
    );
  }
  // E.H2a: the floor on a challenge win's merges is a true lower bound. On
  // this graph b can be made two ways of equal size; only one shares a merge
  // with c, so x takes 4 merges, and the greedy set says 5.
  {
    const R = (a: string, b: string, result: string) => ({ a, b, result });
    const graph = [R("s", "t", "a"), R("s", "s", "d"), R("d", "t", "b"), R("a", "s", "b"), R("a", "t", "c"), R("b", "c", "x")];
    const floor = leastMerges(graph, ["s", "t"], "x");
    const greedy = fewestMerges(graph, ["s", "t"]).get("x")?.size;
    check(
      "an honest win in the fewest merges is never below the floor",
      floor !== null && floor <= 4 && floor >= 3 && leastMerges(graph, ["s", "t"], "nowhere") === null,
      `floor ${floor}, a real derivation 4, the greedy set ${greedy}`,
    );
  }
  // Section 2 of the audit: Village's description was a model refusal.
  {
    const village =
      "I can't write this one as stated, since it would turn people into the materials of an object. Here's a safer entry you could use instead: Village Lantern Charm.";
    const water =
      "Water is a primal spell that the caster performs by sweeping both hands in a slow arc, releasing a rushing cascade of clear water that pours from the palms.";
    const sorry = "Sorry, I cannot describe that.";
    const ink = "Ink of the Unwritten is a jar of black ink that cannot be spilled; I can see why scribes prize it.";
    check(
      "a refusal is not taken for a description, and a description is not taken for a refusal",
      looksLikeRefusal(village) && looksLikeRefusal(sorry) && !looksLikeRefusal(water) && !looksLikeRefusal(ink),
      JSON.stringify([village, sorry, water, ink].map(looksLikeRefusal)),
    );
  }

  // Section 3 of the audit: with every fire check of the ward removed from
  // physics.ts, all of npm test still passed. Fire set in a ring around a
  // warded wood, and inside it, must not burn what the ward covers.
  {
    const random = Math.random;
    Math.random = seeded(5);
    const world = generateWorld(112, 112, 11);
    const rt = new Runtime(world, () => {});
    let best = 0;
    let bx = 56;
    let by = 56;
    for (let y = 10; y < 100; y += 4)
      for (let x = 10; x < 100; x += 4) {
        let n = 0;
        for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) if (world.cover[(y + dy) * 112 + x + dx] === C.TREE) n++;
        if (n > best) [best, bx, by] = [n, x, y];
      }
    rt.cast(
      { key: "fireward", name: "Fire Ward", tier: "major", code: "const spell = { *cast(w) { w.ward(w.x, w.y, 6, { seconds: 60, against: ['fire'] }); } };" },
      bx,
      by,
    );
    for (let k = 0; k < 10; k++) stepHeadless(world, rt);
    const inside = (i: number) => Math.hypot((i % 112) - bx, Math.floor(i / 112) - by) < 5;
    const trees = () => {
      let n = 0;
      for (let i = 0; i < world.n; i++) if (inside(i) && world.cover[i] === C.TREE) n++;
      return n;
    };
    const before = trees();
    for (let i = 0; i < world.n; i++) {
      const d = Math.hypot((i % 112) - bx, Math.floor(i / 112) - by);
      if ((d > 6.5 && d < 8.5) || d < 1.5) world.fire[i] = 1;
    }
    let burning = 0;
    let outside = 0;
    for (let s = 0; s < 20; s++) {
      for (let k = 0; k < 1 / TICK; k++) stepHeadless(world, rt);
      let b = 0;
      let o = 0;
      for (let i = 0; i < world.n; i++) {
        if (world.fire[i] <= 0.1) continue;
        if (inside(i)) b++;
        else o++;
      }
      burning = Math.max(burning, b);
      outside = Math.max(outside, o);
    }
    Math.random = random;
    check(
      "a ward against fire keeps a burning wood out: nothing inside catches",
      before >= 20 && burning === 0 && trees() >= before - 1 && outside > 0,
      `${before} trees inside, ${trees()} after 20 s, at most ${burning} burning cells inside and ${outside} outside`,
    );
  }
  // C.S-6: the sandbox of spell code. Nothing tested the CSP or the iframes'
  // sandbox attribute: removing connect-src 'none' or adding allow-same-origin
  // passed CI.
  {
    const headers = readFileSync("public/_headers", "utf8");
    const policy = (path: string) => new RegExp(`^${path.replace(".", "\\.")}\\n\\s+Content-Security-Policy: (.+)$`, "m").exec(headers)?.[1] ?? "";
    const strict = ["/world", "/world.html", "/check", "/check.html"].map((p) => [p, policy(p)] as const);
    const bad = strict.filter(
      ([p, csp]) =>
        !/default-src 'none'/.test(csp) ||
        !/connect-src 'none'/.test(csp) ||
        !/script-src 'self' 'unsafe-eval';/.test(csp) ||
        !(p.startsWith("/world") ? /worker-src 'none'/ : /worker-src blob:;/).test(csp),
    );
    const frames = ["src/checker.ts", "src/worldhost.ts"].map((f) => readFileSync(f, "utf8"));
    const sandboxed = frames.every((t) => /setAttribute\("sandbox", "allow-scripts"\)/.test(t) && !/allow-same-origin/.test(t));
    check(
      "spell code pages allow no network and their frames run without the game's origin",
      bad.length === 0 && sandboxed,
      bad.length ? `loose policy on ${bad.map(([p]) => p).join(", ")}` : `sandboxed ${sandboxed}`,
    );
  }

  // A.W1 and the blue team's B2: what was read is not new again, and an
  // update or a built idea that comes later the same day is.
  {
    const morning = [{ date: "2026-11-05", version: "4.5", text: "Daily challenges" }];
    const afternoon = [{ date: "2026-11-05", version: "4.5.1", text: "Fixes from the audit" }, ...morning];
    const readAt = Date.parse("2026-11-05T09:00:00");
    const read = morning.map(entryId);
    const idea = [{ title: "Moon phases", at: Date.parse("2026-11-05T15:00:00") }];
    const sameDay = whatIsNew(morning, [], readAt, read);
    const later = whatIsNew(afternoon, idea, readAt, read);
    const first = whatIsNew(afternoon, idea, null, null);
    check(
      "what was read is not new again, and what came later that day is",
      sameDay.fresh.length === 0 && later.fresh.length === 1 && later.fresh[0].version === "4.5.1" && later.ideas.length === 1 && first.fresh.length === 0,
      JSON.stringify({ sameDay: sameDay.fresh.length, later: later.fresh.map((e) => e.version), ideas: later.ideas.length, first: first.fresh.length }),
    );
  }

  // The blue team's B4: a wonder saved on an island names its finder only
  // while the live pool does (deleted or hidden finders are left out there).
  {
    const def = {
      id: 7,
      kind: "glimmer moss",
      rarity: "rare",
      lands: [],
      spot: "flat",
      reach: 5,
      does: "",
      code: "x",
      source: "player",
      by: "Dan",
    } as WonderDef;
    const saved = { kind: "glimmer moss", name: "Dan's Moss", x: 1, y: 1, r: 3, def } as unknown as Wonder;
    setFinders([def]);
    const named = wonderInfo(saved).by;
    setFinders([{ ...def, by: undefined }]);
    const gone = wonderInfo(saved).by;
    setFinders([]);
    const offline = wonderInfo(saved).by;
    check(
      "a saved wonder names its finder only while the pool does",
      named === "Dan" && gone === undefined && offline === undefined,
      JSON.stringify({ named, gone, offline }),
    );
  }
  // B3, B6: a cached refusal or its stand in is no description on the page either.
  {
    check(
      "a card does not keep a refusal or the stand in for one",
      isPlaceholderDescription("I can't write this one as stated.") &&
        isPlaceholderDescription(noDescription("Refusenik")) &&
        !isPlaceholderDescription("Water is a primal spell."),
    );
  }
  // B5: an unfinished run is never reported; a finished one is, without its timings.
  {
    const late = reportable(unfinishedRun("The test run did not finish in time"));
    const done = reportable({ ok: true, problem: null, detail: "3 cells", stats: { cells: 3 }, phases: { cast: 9 } });
    check(
      "an unfinished test run sends no verdict; a finished one does",
      late === null && !!done && !("phases" in done) && done.ok,
      JSON.stringify({ late, done }),
    );
  }
}
