// Checks of the review of 10 November, run by `npm test` (sim-test.ts): the
// test run fails what the engine could not use of a program (it used to pass
// in silence), a spell that promises healing heals, a summon is alive when
// the cast is over, protection is asked only of what is about protection,
// and what villagers do to an item is not the item acting. Each bad program
// below is a shape found in the live library; each has its good twin, so a
// check cannot pass by failing everything.
import { runCheck } from "../src/sim/check";
import { unfitDefence, promisesProtection } from "../src/sim/abilities";
import { voiceFor } from "../src/sim/sound";
import { INTENT_SYSTEM, SPELL_SCHEMA, SPELL_SYSTEM, spellUserMessage } from "../worker/prompts";
import { PROMISE_TEST } from "../shared/promises";

type Check = (name: string, ok: boolean, detail?: string) => void;

const lantern = (effects: string, place = true, coin = 0.05) => `const spell = {
  artifacts: [{ name: "Lamp", radius: 6, effects: [${effects}] }],
  *cast(w) {
    const parts = [[-0.2, -0.2, 0, 0.4, 0.4, 0.6, "#5a4030"]];
    for (let k = 0; k < 9; k++) parts.push([-0.1 + k * 0.02, -0.1, 0.6 + k * ${coin}, 0.14, 0.14, ${coin}, "#ffd36a", "glow"]);
    w.model(w.x, w.y, parts, { name: "Lamp" });
    ${place ? 'w.artifact(w.x, w.y, "Lamp");' : ""}
  },
};`;

export function promiseChecks(check: Check): void {
  const item = (code: string, intents: string[] = ["other"], form = "object", name = "Lamp") =>
    runCheck({ key: `p:${name}:${code.length}`, name, tier: "minor", code, intents, kind: "artifact", form });
  const spell = (code: string, intents: string[], name: string) =>
    runCheck({ key: `p:${name}:${code.length}`, name, tier: "minor", code, intents, kind: "spell" });

  // 1. What the engine cannot use is a failure, said in words the writer can act on.
  const good = item(
    lantern(`{ when: "night", do: "light" }, { when: "every", every: 5, act(self, w) { w.grow(self.x, self.y, 3, 0.5); self.did("made the land grow"); } }`),
  );
  check("promise: an item whose effects the engine understands passes", good.ok, `${good.problem}: ${good.detail}`);
  const fn = item(lantern(`{ when: "night", do: "light" }, { when: "every", every: 5, do: function (self, w) { w.grow(self.x, self.y, 3, 0.5); } }`));
  check(
    "promise: a function in an effect's do is not passed in silence (Rocket Fleet)",
    !fn.ok && fn.problem === "idle" && /effect 2 was ignored/.test(fn.detail) && /act\(self, w, target\)/.test(fn.detail),
    `${fn.problem}: ${fn.detail}`,
  );
  const unknown = item(lantern(`{ when: "night", do: "launch rockets" }`));
  check("promise: an effect the engine has no name for fails", !unknown.ok && /"launch rockets" is not an effect/.test(unknown.detail), unknown.detail);
  const unplaced = item(lantern(`{ when: "night", do: "light" }`, false));
  check(
    "promise: an artifact declared and never placed fails (Cave, Healing Potion)",
    !unplaced.ok && unplaced.problem === "idle" && /never calls w\.artifact/.test(unplaced.detail),
    `${unplaced.problem}: ${unplaced.detail}`,
  );
  const thin = item(lantern(`{ when: "night", do: "light" }`, true, 0.04));
  check(
    "promise: a model that lost its thin boxes fails its look (Leprechaun Gold, 7 of 25 drawn)",
    !thin.ok && thin.problem === "look" && /drew 1 of 10 boxes/.test(thin.detail),
    `${thin.problem}: ${thin.detail}`,
  );
  const status = spell(
    `const spell = { *cast(w) { w.ignite(w.x, w.y, 3, 0.5); for (const c of w.creatures(w.x, w.y, 8)) c.status("petrify", 5); } };`,
    ["harm"],
    "Petrify",
  );
  check("promise: a status that does not exist fails", !status.ok && /status "petrify" does not exist/.test(status.detail), status.detail);

  // 2. Healing heals: the wounded villager one cell away, the dead one beside it.
  const dead = spell(
    `const spell = { *cast(w) { w.circle(w.x, w.y, 4, "#7fe08a", "#ffffff", 1); w.body({ x: w.x, y: w.y, z: 3, vz: 0, r: 1, look: "orb", life: 2, gravity: 0 }); yield 1; for (const c of w.creatures(w.x, w.y, 6)) if (c.alive && c.hp < 10) c.heal(2); } };`,
    ["heal"],
    "Mend",
  );
  check("promise: healing only those under ten health heals no one (Life)", !dead.ok && dead.problem === "promise", `${dead.problem}: ${dead.detail}`);
  const heals = spell(
    `const spell = { *cast(w) { w.circle(w.x, w.y, 4, "#7fe08a", "#ffffff", 1); yield 1; for (const c of w.creatures(w.x, w.y, 6)) c.heal(40); } };`,
    ["heal"],
    "Mend",
  );
  check("promise: healing the wounded passes", heals.ok, `${heals.problem}: ${heals.detail}`);
  const raises = spell(`const spell = { *cast(w) { yield 0.5; for (const c of w.corpses(w.x, w.y, 6)) c.revive(); } };`, ["heal"], "Raise");
  check("promise: raising the dead keeps a promise to heal", raises.ok, `${raises.problem}: ${raises.detail}`);
  const grows = spell(`const spell = { *cast(w) { yield 0.5; w.grow(w.x, w.y, 8, 1); } };`, ["heal", "create"], "Regrowth");
  check("promise: mending the land keeps a promise to heal", grows.ok, `${grows.problem}: ${grows.detail}`);
  check(
    "promise: a spell that does not promise healing is not asked for it",
    spell(`const spell = { *cast(w) { w.ignite(w.x, w.y, 4, 0.6); } };`, ["harm"], "Spark").ok,
  );

  // 3. A summon is alive when the cast is over.
  const kin = (life: string) =>
    `const spell = { creatures: [{ name: "shade hound", base: "beast", body: "four legs", color: "#3a3040", goal: "hunt", prey: ["rabbit"], hp: 40${life} }], *cast(w) { w.sound("howl", 0.4); yield 0.5; for (let k = 0; k < 3; k++) w.spawn("shade hound", w.x + k, w.y); } };`;
  const gone = spell(kin(", lifespan: 2"), ["summon"], "Summon Hounds");
  check("promise: a summon that is gone in two seconds fails", !gone.ok && gone.problem === "promise", `${gone.problem}: ${gone.detail}`);
  const stays = spell(kin(""), ["summon"], "Summon Hounds");
  check("promise: a summon that lives passes", stays.ok, `${stays.problem}: ${stays.detail}`);

  // 4. Protection is promised by a name or a main intent, not by a second one.
  check("promise: protect as a second intent promises no protection", !promisesProtection("Werewolf", ["summon", "protect"]));
  check("promise: protect as the main intent does", promisesProtection("Turn Undead", ["protect"]));
  check("promise: a guardian's name does, whatever the intents", promisesProtection("Stone Guardian", ["summon"]));
  check("promise: a ward on a Werewolf is unfit with protect second", unfitDefence("Werewolf", ["summon", "protect"], [], 1) !== null);
  check("promise: a ward on a Sanctuary is fit", unfitDefence("Sanctuary", ["create"], [], 1) === null);
  const wolf = `const spell = { creatures: [{ name: "werewolf", base: "beast", body: "two legs", color: "#5a4a3a", goal: "hunt", prey: ["deer", "rabbit"], speed: 4, hp: 120, abilities: [{ do: "summon", when: "every so often", every: 20 }] }], *cast(w) { w.sound("howl", 0.5); WARD w.spawn("werewolf", w.x, w.y); } };`;
  const domed = runCheck({
    key: "p:wolf:ward",
    name: "Werewolf",
    tier: "minor",
    code: wolf.replace("WARD", "w.ward(w.x, w.y, w.r, { seconds: 60 });"),
    intents: ["summon", "protect"],
    kind: "artifact",
    form: "creature",
  });
  check(
    "promise: a Werewolf that domes the village fails as unfit (it passed with protect second)",
    !domed.ok && domed.problem === "fit",
    `${domed.problem}: ${domed.detail}`,
  );
  const told = (intents: string[], kind = "spell") => spellUserMessage("X", kind, "An entry.", null, "minor", [], undefined, intents as never);
  check(
    "promise: the writer is told of the protection test for a main intent only",
    told(["protect", "create"]).includes(PROMISE_TEST.protect!) && !told(["create", "protect"]).includes("promises protection"),
  );
  check(
    "promise: the writer of a healing spell is told its test",
    told(["heal"]).includes(PROMISE_TEST.heal!) && !told(["heal"], "artifact").includes("promises healing"),
  );
  check("promise: the intent call says what protect is not", /When in doubt, not protect/.test(INTENT_SYSTEM));

  // 5. What villagers do to an item is not the item acting.
  const idol = item(
    `const spell = { artifacts: [{ name: "Idol", radius: 8, lures: ["villager"], uses: [{ do: "worship", by: ["villager"] }, { do: "guard", by: ["villager"] }] }], *cast(w) { const parts = []; for (let k = 0; k < 8; k++) parts.push([-0.3 + k * 0.02, -0.3 + k * 0.02, k * 0.2, 0.6 - k * 0.04, 0.6 - k * 0.04, 0.2, "#8a8a92"]); w.model(w.x, w.y, parts, { name: "Idol" }); w.artifact(w.x, w.y, "Idol"); } };`,
    ["other"],
    "object",
    "Idol",
  );
  check("promise: an item that is only worshipped and guarded has not acted", !idol.ok && idol.problem === "idle", `${idol.problem}: ${idol.detail}`);

  // 6. The prompt and the engine say the same thing.
  const listed = /w\.sound\(name, size 0 to 1\) with ([^:]+):/.exec(SPELL_SYSTEM)?.[1].split(/,\s*/) ?? [];
  const noVoice = listed.filter((n) => voiceFor(n.trim()) !== n.trim());
  check(
    "promise: every sound the prompt names is a voice of its own",
    listed.length >= 30 && noVoice.length === 0,
    `${listed.length} named, without a voice: ${noVoice.join(", ")}`,
  );
  check("promise: the writer plans before the code", SPELL_SCHEMA.required[0] === "plan" && Object.keys(SPELL_SCHEMA.properties)[0] === "plan");
  const rack = /a Catapult: effects (\[.*?\])\. Draw its look/.exec(SPELL_SYSTEM)?.[1] ?? "";
  const fired = item(
    `const spell = { artifacts: [{ name: "Rack", radius: 6, effects: ${rack.replace('when: "enemy", every: 25', 'when: "every", every: 5')} }], *cast(w) { const parts = []; for (let k = 0; k < 8; k++) parts.push([-0.4 + k * 0.1, -0.1, 0, 0.08, 0.2, 0.9, "#6a5a52"]); w.model(w.x, w.y, parts, { name: "Rack" }); w.artifact(w.x, w.y, "Rack"); } };`,
    ["other"],
    "object",
    "Rack",
  );
  check("promise: the prompt's own example of an effect's act runs and acts", rack.length > 20 && fired.ok, `${fired.problem}: ${fired.detail}`);
}
