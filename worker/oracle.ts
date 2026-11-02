import Anthropic from "@anthropic-ai/sdk";
import { parseIntents, type Intent } from "../shared/promises";
import { syntaxError } from "../shared/spellcode";
import { isTier, type Tier } from "../shared/tiers";
import type { ElementKind } from "../shared/types";
import {
  DESCRIBE_SYSTEM,
  DESIGN_SCHEMA,
  DESIGN_SYSTEM,
  INTENT_SCHEMA,
  INTENT_SYSTEM,
  JUDGE_SCHEMA,
  JUDGE_SYSTEM,
  MERGE_SCHEMA,
  MERGE_SYSTEM,
  SPELL_SCHEMA,
  SPELL_SYSTEM,
  TIERS_SCHEMA,
  TIER_SYSTEM,
  describeUserMessage,
  designUserMessage,
  intentUserMessage,
  spellSystem,
  judgeUserMessage,
  mergeUserMessage,
  repairUserMessage,
  spellUserMessage,
  type LibraryDoc,
  type LibraryExample,
  type Rewrite,
} from "./prompts";

export interface MergeAnswer {
  name: string;
  emoji: string;
  kind: ElementKind;
  tier: Tier;
}

export interface SpellRequest {
  name: string;
  // Artifacts get programs too: they are placed, not cast.
  kind: ElementKind;
  description: string;
  recipe: [string, string] | null;
  tier: Tier;
  // Programs players liked, retrieved for this spell (small model only).
  examples?: LibraryExample[];
  // Set when the spell is written again, with why.
  rewrite?: Rewrite;
  // What it promises, with the test that promise faces (shared/promises.ts).
  intents?: Intent[];
  // Helpers and hints the API has grown (worker/evolve.ts).
  library?: LibraryDoc[];
}

// Spells that lacked the same ability, for the API designer.
export interface DesignRequest {
  gaps: { id: number; spell: string; tier: string; missing: string }[];
  library: LibraryDoc[];
}

export interface DesignAnswer {
  decision: "helper" | "engine" | "exists" | "none";
  // The gap ids it answers.
  answers: number[];
  name: string;
  signature: string;
  doc: string;
  code: string;
  example: string;
  spec: string;
}

export interface JudgeRequest {
  name: string;
  kind: ElementKind;
  tier: Tier;
  description: string;
  // What the Spell Lab measured, in a sentence.
  facts: string;
  // JPEG or PNG frames as data URLs, and when they were taken.
  frames: string[];
  shots: number[];
  // The player's votes on earlier judgments, worded for the judge.
  notes: string[];
}

export interface JudgeAnswer {
  score: number;
  reason: string;
  note: string;
}

// One program asked of the Batch API, and what came back.
export interface BatchItem {
  id: string;
  request: SpellRequest;
}

// What one batch item cost is returned, not recorded: the caller records it
// when it takes the item, so a batch read twice is not billed twice.
export interface BatchOutcome {
  id: string;
  answer?: ProgramAnswer;
  error?: string;
  call: string;
  model: string;
  usd: number;
}

export interface ProgramAnswer {
  summary: string;
  code: string;
  // What the API lacked for this spell, in the writer's words; empty when nothing.
  missing?: string;
}

export interface Spent {
  call: string;
  model: string;
  usd: number;
}

// Whatever decides what two items make, how an item is described, how strong
// it is, and writes the program of a spell.
export interface Oracle {
  readonly mock: boolean;
  // Every call made so far and its cost, for the budget ledger.
  readonly spent: Spent[];
  merge(a: string, b: string): Promise<MergeAnswer>;
  describe(name: string, kind: ElementKind, recipe: [string, string] | null): Promise<string>;
  // Tiers for elements from before tiers existed, all in one call. New
  // elements get theirs in the merge answer.
  tiers(items: { name: string; kind: ElementKind }[]): Promise<Map<string, Tier>>;
  spell(request: SpellRequest): Promise<ProgramAnswer>;
  repair(name: string, tier: Tier, code: string, error: string): Promise<ProgramAnswer>;
  judge(request: JudgeRequest): Promise<JudgeAnswer>;
  // What an element promises, from its name and grimoire entry (3.4.2).
  intents(name: string, kind: ElementKind, description: string): Promise<Intent[]>;
  // How the API grows to give spells what they lacked (3.4.2).
  design(request: DesignRequest): Promise<DesignAnswer>;
  // Big spells are written through the Batch API, at half price, within a
  // day (usually minutes). Returns the batch id.
  submitBatch(items: BatchItem[]): Promise<string>;
  // null while the batch is still running.
  batchResults(batch: string): Promise<BatchOutcome[] | null>;
}

export interface OracleModels {
  merge: string;
  mergeEffort: Effort;
  describe: string;
  spell: string;
  spellEffort: Effort;
  judge: string;
  // The API designer: rare and consequential, so the big model.
  design: string;
}

// Models whose spell calls are rare and lone: a legendary spell every few
// hours. Writing their 3,500 token system prompt to the cache costs 1.25 times
// input and is never read back before the five minutes are over, so those calls
// skip the cache. Haiku spells come in bursts (written ahead for discoveries)
// and keep it.
const LONE_SPELL_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

export function parseEffort(raw: string | undefined, fallback: Effort): Effort {
  return EFFORTS.includes(raw as Effort) ? (raw as Effort) : fallback;
}

export class OracleError extends Error {}

// Models that accept the server side refusal fallback. Haiku 5.5 has none, and
// sending the option to it would be rejected.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

function fallbackFor(model: string) {
  return FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {};
}

export class ClaudeOracle implements Oracle {
  readonly mock = false;
  readonly spent: Spent[] = [];
  private client: Anthropic;

  constructor(
    apiKey: string,
    private models: OracleModels,
    baseURL?: string,
  ) {
    this.client = new Anthropic({ apiKey, baseURL, maxRetries: 2 });
  }

  private async ask(
    call: string,
    model: string,
    effort: Effort,
    system: string,
    messages: Anthropic.Beta.BetaMessageParam[],
    schema: Record<string, unknown> | null,
    maxTokens: number,
    cache = true,
  ): Promise<string> {
    const response = await this.client.beta.messages.create({
      ...requestParams(model, effort, system, messages, schema, maxTokens, cache),
      ...fallbackFor(model),
    });
    this.spent.push(logUsage(call, response));
    return readText(response);
  }

  async merge(a: string, b: string): Promise<MergeAnswer> {
    const text = await this.ask(
      "merge",
      this.models.merge,
      this.models.mergeEffort,
      MERGE_SYSTEM,
      [{ role: "user", content: mergeUserMessage(a, b) }],
      MERGE_SCHEMA,
      4000,
    );
    const { name, emoji, kind, tier } = parseJson(text) as Partial<MergeAnswer>;
    if (typeof name !== "string" || typeof emoji !== "string" || (kind !== "spell" && kind !== "artifact")) {
      throw new OracleError("The merge answer did not match the schema");
    }
    return { name, emoji, kind, tier: isTier(tier) ? tier : "minor" };
  }

  async describe(name: string, kind: ElementKind, recipe: [string, string] | null): Promise<string> {
    const text = await this.ask(
      "describe",
      this.models.describe,
      "low",
      DESCRIBE_SYSTEM,
      [{ role: "user", content: describeUserMessage(name, kind, recipe) }],
      null,
      2000,
    );
    return text.trim();
  }

  async tiers(items: { name: string; kind: ElementKind }[]): Promise<Map<string, Tier>> {
    const list = items.map((i) => `${i.name} (${i.kind})`).join("\n");
    const text = await this.ask("tier", this.models.merge, this.models.mergeEffort, TIER_SYSTEM, [{ role: "user", content: list }], TIERS_SCHEMA, 16000, false);
    const { tiers } = parseJson(text) as { tiers?: { name?: unknown; tier?: unknown }[] };
    const out = new Map<string, Tier>();
    for (const t of Array.isArray(tiers) ? tiers : []) {
      if (typeof t.name === "string" && isTier(t.tier)) out.set(t.name, t.tier);
    }
    return out;
  }

  async spell(request: SpellRequest): Promise<ProgramAnswer> {
    return this.program(request.rewrite ? "rewrite" : "spell", [{ role: "user", content: spellMessage(request) }], request.library);
  }

  async intents(name: string, kind: ElementKind, description: string): Promise<Intent[]> {
    const text = await this.ask(
      "intent",
      this.models.judge,
      "low",
      INTENT_SYSTEM,
      [{ role: "user", content: intentUserMessage(name, kind, description) }],
      INTENT_SCHEMA,
      2000,
    );
    const intents = parseIntents((parseJson(text) as { intents?: unknown }).intents);
    return intents.length ? intents : ["other"];
  }

  async design(request: DesignRequest): Promise<DesignAnswer> {
    const text = await this.ask(
      "design",
      this.models.design,
      "high",
      DESIGN_SYSTEM + SPELL_SYSTEM,
      [{ role: "user", content: designUserMessage(request.gaps, request.library) }],
      DESIGN_SCHEMA,
      // The most a call can ask without streaming, as for spells.
      20000,
      false,
    );
    const a = parseJson(text) as Partial<DesignAnswer>;
    if (!["helper", "engine", "exists", "none"].includes(a.decision as string)) throw new OracleError("The design answer did not match the schema");
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
    return {
      decision: a.decision as DesignAnswer["decision"],
      answers: Array.isArray(a.answers) ? a.answers.filter((n): n is number => Number.isInteger(n)).slice(0, 80) : [],
      name: str(a.name, 40),
      signature: str(a.signature, 200),
      doc: str(a.doc, 400),
      code: str(a.code, 12000),
      example: str(a.example, 12000),
      spec: str(a.spec, 4000),
    };
  }

  async judge(request: JudgeRequest): Promise<JudgeAnswer> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [
      { type: "text", text: judgeUserMessage(request.name, request.kind, request.tier, request.description, request.facts, request.notes, request.shots) },
    ];
    for (const frame of request.frames.slice(0, 3)) {
      const m = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(frame);
      if (m) content.push({ type: "image", source: { type: "base64", media_type: m[1] as "image/jpeg", data: m[2] } });
    }
    if (content.length < 2) throw new OracleError("The judge needs frames");
    const text = await this.ask("judge", this.models.judge, "low", JUDGE_SYSTEM, [{ role: "user", content }], JUDGE_SCHEMA, 4000);
    const { score, reason, note } = parseJson(text) as Partial<JudgeAnswer>;
    if (typeof score !== "number" || typeof reason !== "string") throw new OracleError("The judge's answer did not match the schema");
    return { score: Math.max(1, Math.min(5, Math.round(score))), reason, note: typeof note === "string" ? note.slice(0, 300) : "" };
  }

  // One request per program, written by the spell model at its effort. The
  // system prompt is not cached: batch requests are processed out of order.
  async submitBatch(items: BatchItem[]): Promise<string> {
    const { spell: model, spellEffort } = this.models;
    const batch = await this.client.beta.messages.batches.create({
      requests: items.map((item) => ({
        custom_id: item.id,
        params: requestParams(
          model,
          spellEffort,
          spellSystem(item.request.library),
          [{ role: "user", content: spellMessage(item.request) }],
          SPELL_SCHEMA,
          20000,
          false,
        ),
      })),
    });
    return batch.id;
  }

  async batchResults(id: string): Promise<BatchOutcome[] | null> {
    const batch = await this.client.beta.messages.batches.retrieve(id);
    if (batch.processing_status !== "ended") return null;
    const out: BatchOutcome[] = [];
    for await (const item of await this.client.beta.messages.batches.results(id)) {
      const r = item.result;
      if (r.type !== "succeeded") {
        out.push({
          id: item.custom_id,
          error: r.type === "errored" ? JSON.stringify(r.error).slice(0, 300) : r.type,
          call: "batch-spell",
          model: this.models.spell,
          usd: 0,
        });
        continue;
      }
      // Batch requests cost half of the same call made directly. Ids that
      // start with "rw" are rewrites, counted against the daily rewrite budget.
      const spent = logUsage(item.custom_id.startsWith("rw") ? "batch-rewrite" : "batch-spell", r.message, 0.5);
      try {
        const answer = toProgram(readText(r.message));
        const error = syntaxError(answer.code);
        out.push(error ? { id: item.custom_id, error: `does not parse: ${error}`, ...spent } : { id: item.custom_id, answer, ...spent });
      } catch (err) {
        out.push({ id: item.custom_id, error: err instanceof Error ? err.message : String(err), ...spent });
      }
    }
    return out;
  }

  async repair(name: string, tier: Tier, code: string, error: string): Promise<ProgramAnswer> {
    return this.program("repair", [{ role: "user", content: repairUserMessage(name, tier, code, error) }]);
  }

  // Asks for a program; if it does not even parse, shows the model the
  // parser's complaint once and takes the second answer.
  private async program(call: string, messages: Anthropic.Beta.BetaMessageParam[], library?: LibraryDoc[]): Promise<ProgramAnswer> {
    const { spell: model, spellEffort } = this.models;
    const cache = !LONE_SPELL_MODELS.has(model);
    const system = spellSystem(library);
    let answer = toProgram(await this.ask(call, model, spellEffort, system, messages, SPELL_SCHEMA, 20000, cache));
    const error = syntaxError(answer.code);
    if (error) {
      const retry: Anthropic.Beta.BetaMessageParam[] = [
        ...messages,
        { role: "assistant", content: JSON.stringify(answer) },
        { role: "user", content: `That program does not parse: ${error}. Send the corrected program.` },
      ];
      answer = toProgram(await this.ask(`${call}-retry`, model, spellEffort, system, retry, SPELL_SCHEMA, 20000, cache));
      if (syntaxError(answer.code)) throw new OracleError("The spell's program could not be written");
    }
    return answer;
  }
}

function spellMessage(r: SpellRequest): string {
  return spellUserMessage(r.name, r.kind, r.description, r.recipe, r.tier, r.examples, r.rewrite, r.intents);
}

function requestParams(
  model: string,
  effort: Effort,
  system: string,
  messages: Anthropic.Beta.BetaMessageParam[],
  schema: Record<string, unknown> | null,
  maxTokens: number,
  cache: boolean,
) {
  return {
    model,
    max_tokens: maxTokens,
    output_config: schema ? { effort, format: { type: "json_schema" as const, schema } } : { effort },
    // The system prompts never change, so frequent calls cache them.
    system: [cache ? { type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } } : { type: "text" as const, text: system }],
    messages,
  };
}

function toProgram(text: string): ProgramAnswer {
  const { summary, code, missing } = parseJson(text) as Partial<ProgramAnswer>;
  if (typeof summary !== "string" || typeof code !== "string" || !code.includes("spell")) {
    throw new OracleError("The spell answer did not match the schema");
  }
  return { summary: summary.slice(0, 240), code: code.slice(0, 40000), missing: typeof missing === "string" ? missing.trim().slice(0, 300) : "" };
}

// Dollars per million tokens: input, output, cache read, cache write (5 minute TTL).
// Thinking is billed as output. Checked on 2026-11-02 against
// https://platform.claude.com/docs/en/about-claude/pricing: cache reads are
// 0.025x input on Fable 5.1, 0.05x on Opus 5.5 and Sonnet 5.5, 0.1x elsewhere.
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-fable-5-1": [10, 50, 0.25, 12.5],
  "claude-opus-5-5": [4, 20, 0.2, 5],
  "claude-sonnet-5-5": [2, 10, 0.1, 2.5],
  "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125],
};

// One JSON line per call, visible with `wrangler tail` and in Workers Logs.
function logUsage(call: string, response: Anthropic.Beta.BetaMessage, discount = 1): Spent {
  const u = response.usage;
  const input = u.input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  // Unknown models are priced like the most expensive one, so the budget errs on the safe side.
  const price = PRICES[response.model] ?? PRICES["claude-fable-5-1"];
  const usd = ((input * price[0] + output * price[1] + cacheRead * price[2] + cacheWrite * price[3]) / 1e6) * discount;
  console.log(JSON.stringify({ usage: call, model: response.model, stop: response.stop_reason, input, output, cacheRead, cacheWrite, usd }));
  return { call, model: response.model, usd };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new OracleError("The answer was not valid JSON");
  }
}

function readText(response: Anthropic.Beta.BetaMessage): string {
  if (response.stop_reason === "refusal") {
    throw new OracleError("The magic refused to answer this one");
  }
  if (response.stop_reason === "max_tokens") {
    throw new OracleError("The answer was cut off");
  }
  const text = response.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  if (!text) throw new OracleError("The answer was empty");
  return text;
}

// Used when no API key is configured, so the game runs offline for UI work.
// Deterministic, obviously fake, never calls the network.
export class MockOracle implements Oracle {
  readonly mock = true;
  readonly spent: Spent[] = [];

  async merge(a: string, b: string): Promise<MergeAnswer> {
    const [x, y] = [a, b].sort();
    if (x === y) return { name: `Greater ${lastWord(x)}`, emoji: "✨", kind: "spell", tier: "major" };
    const h = hash(`${x}+${y}`);
    const emoji = MOCK_EMOJI[h % MOCK_EMOJI.length];
    const kind: ElementKind = h % 3 === 0 ? "artifact" : "spell";
    const suffix = kind === "artifact" ? MOCK_ARTIFACTS[h % MOCK_ARTIFACTS.length] : MOCK_SPELLS[h % MOCK_SPELLS.length];
    return { name: `${firstWord(x)} ${firstWord(y)} ${suffix}`.split(" ").slice(-3).join(" "), emoji, kind, tier: "major" };
  }

  async describe(name: string, kind: ElementKind, recipe: [string, string] | null): Promise<string> {
    const origin = recipe ? `Born from ${recipe[0]} and ${recipe[1]}.` : "One of the primal forces.";
    return `${origin} This is a placeholder ${kind} description for ${name}. Set ANTHROPIC_API_KEY on the Worker to get real ones.`;
  }

  async tiers(items: { name: string }[]): Promise<Map<string, Tier>> {
    return new Map(items.map((i) => [i.name, "major" as Tier]));
  }

  // A small program built from keywords in the name, so the World tab can be
  // played offline.
  async spell(request: SpellRequest): Promise<ProgramAnswer> {
    const words = request.name.toLowerCase();
    const theme = MOCK_THEMES.find((t) => t.words.some((w) => words.includes(w))) ?? MOCK_THEMES[MOCK_THEMES.length - 1];
    const code = `const spell = {
  *cast(w) {
    w.circle(w.x, w.y, w.r * 0.5, "${theme.colors[0]}", "${theme.colors[1]}", 0.8);
    w.sound("rise", 0.3);
    yield 0.8;
    w.burst(w.x, w.y, { count: 120, colors: ["${theme.colors[0]}", "${theme.colors[1]}"], speed: w.r, up: 6, life: 1.2 });
    ${theme.impact}
  },
};`;
    return { summary: `Mock spell built from the words in "${request.name}".`, code };
  }

  async repair(name: string): Promise<ProgramAnswer> {
    return this.spell({ name, kind: "spell", description: "", recipe: null, tier: "major" });
  }

  async judge(): Promise<JudgeAnswer> {
    return { score: 3, reason: "fine", note: "Mock judge: set ANTHROPIC_API_KEY for a real one." };
  }

  async intents(name: string): Promise<Intent[]> {
    return /ward|shield|aegis|protect|barrier|sanctuary|bulwark/i.test(name) ? ["protect"] : ["other"];
  }

  async design(): Promise<DesignAnswer> {
    return { decision: "none", answers: [], name: "", signature: "", doc: "", code: "", example: "", spec: "" };
  }

  async submitBatch(): Promise<string> {
    throw new OracleError("The mock oracle has no Batch API");
  }

  async batchResults(): Promise<BatchOutcome[] | null> {
    return [];
  }
}

const MOCK_THEMES: { words: string[]; colors: [string, string]; impact: string }[] = [
  {
    words: ["ward", "shield", "aegis", "protect", "barrier", "sanctuary"],
    colors: ["#9fd8ff", "#ffffff"],
    impact: 'w.ward(w.x, w.y, w.r, { seconds: 20, color: "#9fd8ff" });',
  },
  {
    words: ["fire", "flame", "inferno", "burn", "blaze"],
    colors: ["#ff7a1a", "#ffd166"],
    impact: "w.explode(w.x, w.y, w.r * 0.4, 0.6); w.ignite(w.x, w.y, w.r, 0.4);",
  },
  {
    words: ["lava", "magma", "volcan"],
    colors: ["#ff4d00", "#ffb03a"],
    impact: 'w.terraform(w.x, w.y, w.r * 0.5, 4); w.flood(w.x, w.y, w.r * 0.3, "lava", 1.5);',
  },
  { words: ["water", "rain", "tide", "flood", "wave"], colors: ["#4cc9f0", "#a9def9"], impact: 'w.flood(w.x, w.y, w.r * 0.6, "water", 2);' },
  {
    words: ["ice", "frost", "snow", "freeze", "cold"],
    colors: ["#bde0fe", "#ffffff"],
    impact: 'w.temperature(w.x, w.y, w.r, -80); w.paint(w.x, w.y, w.r, "snow", 0.6);',
  },
  {
    words: ["earth", "stone", "rock", "quake"],
    colors: ["#8d6e63", "#d7ccc8"],
    impact: "for (let k = 0; k < 20; k++) { w.quake(w.x, w.y, w.r, 1); yield 0.1; }",
  },
  {
    words: ["life", "grow", "nature", "forest", "heal"],
    colors: ["#80ed99", "#38b000"],
    impact: "w.grow(w.x, w.y, w.r, 0.8); for (const c of w.creatures(w.x, w.y, w.r)) c.heal(100);",
  },
  {
    words: ["shadow", "dark", "night", "void"],
    colors: ["#3c096c", "#9d4edd"],
    impact: "w.darken(0.8, 5); for (const c of w.creatures(w.x, w.y, w.r)) c.status('fear', 5, w.x, w.y);",
  },
  {
    words: [],
    colors: ["#b48cff", "#ffffff"],
    impact: "for (const c of w.creatures(w.x, w.y, w.r)) c.status('levitate', 4); w.shockwave(w.x, w.y, w.r, '#b48cff', 1, 1);",
  },
];

const MOCK_EMOJI = ["🌀", "⚡", "🌟", "❄️", "🌊", "🔥", "🌿", "💀", "🪄", "💎"];
const MOCK_SPELLS = ["Bolt", "Ward", "Nova", "Surge", "Veil"];
const MOCK_ARTIFACTS = ["Stone", "Totem", "Rune", "Orb"];

function firstWord(s: string): string {
  return s.split(" ")[0];
}

function lastWord(s: string): string {
  const words = s.split(" ");
  return words[words.length - 1];
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
