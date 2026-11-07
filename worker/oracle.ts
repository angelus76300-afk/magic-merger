import Anthropic from "@anthropic-ai/sdk";
import { parseIntents, type Intent } from "../shared/promises";
import { syntaxError } from "../shared/spellcode";
import { isTier, type Tier } from "../shared/tiers";
import type { ElementKind } from "../shared/types";
import { guessForm, isForm, kindOfForm, type Form } from "../shared/forms";
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
  CHRONICLE_SYSTEM,
  chronicleUserMessage,
  TRIM_SCHEMA,
  TRIM_SYSTEM,
  SORT_SCHEMA,
  SORT_SYSTEM,
  FORMS_SCHEMA,
  FORMS_SYSTEM,
  WONDER_SCHEMA,
  wonderSystem,
} from "./prompts";

export interface MergeAnswer {
  name: string;
  emoji: string;
  kind: ElementKind;
  // 4.6: which of the seven kinds (shared/forms.ts); kind follows from it.
  form: Form;
  tier: Tier;
}

// The library's sort (4.6): each item's kind, and why, in a few words.
export interface FormAnswer {
  name: string;
  form: Form;
  why: string;
}

export interface SpellRequest {
  name: string;
  // Artifacts get programs too: they are placed, not cast.
  kind: ElementKind;
  // 4.6: which of the six kinds of artifact it is: the writer gets that
  // kind's section and example, the test run holds it to that kind's size.
  form?: Form;
  giant?: boolean;
  // 4.6: its entry was written again for its kind with this program; it goes
  // live with the program when the refresh replaces the old one.
  newEntry?: boolean;
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

export interface TrimAnswer {
  duplicates: { keep: string; alias: string; why: string }[];
  senseless: { a: string; b: string; why: string }[];
}

export interface JudgeAnswer {
  score: number;
  reason: string;
  note: string;
  // Do the creatures it brought look alive (3.7)? none: no creature in the frames.
  alive: "yes" | "no" | "none";
  // 4.6 part B: does it look and act like its name? Absent in judgments from before.
  like?: "yes" | "partly" | "no";
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

// A wonder the API designed (4.4.5 part C), as it answered: checked by
// worker/wonders.ts before it is stored, tested in Node before any island gets it.
export interface WonderAnswer {
  kind: string;
  rarity: string;
  lands: string[];
  spot: string;
  reach: number;
  does: string;
  summary: string;
  code: string;
  missing: string;
}

export interface WonderItem {
  id: string;
  model: string;
  user: string;
}

export interface WonderOutcome {
  id: string;
  answer?: WonderAnswer;
  error?: string;
  model: string;
  usd: number;
}

// What an artifact is, for players' discoveries grown into the world.
export interface SortAnswer {
  name: string;
  sort: "place" | "material" | "creature" | "object" | "person";
  lands: string[];
  spot: string;
  does: string;
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
  // 4.2: the tokens behind it (input, output, cache read, cache write), for measurements.
  tokens?: [number, number, number, number];
}

// How a system prompt is cached: not at all, five minutes, or an hour.
export type Cache = false | "5m" | "1h";

// Whatever decides what two items make, how an item is described, how strong
// it is, and writes the program of a spell.
export interface Oracle {
  readonly mock: boolean;
  // Every call made so far and its cost, for the budget ledger.
  readonly spent: Spent[];
  // How long each call took (4.2), shared by the oracles of one request.
  timings: { call: string; ms: number }[];
  // avoid: a name already refused for this pair (3.7: it only joined the two).
  merge(a: string, b: string, avoid?: string): Promise<MergeAnswer>;
  describe(name: string, kind: ElementKind, recipe: [string, string] | null | "secret", form?: Form): Promise<string>;
  // The trim of the library (3.7): near duplicates and senseless merges.
  trim(names: string[], recipes: string[]): Promise<TrimAnswer>;
  // The island's chronicle (3.7), from what its World recorded.
  chronicle(digest: { days: number; lines: string[]; work: string[]; memories: string[]; now: string[] }): Promise<string>;
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
  // 4.4.5 part C: a new wonder a day, through the Batch API at half price.
  submitWonders(items: WonderItem[]): Promise<string>;
  wonderResults(batch: string): Promise<WonderOutcome[] | null>;
  // Which of players' artifacts are places, materials or creatures.
  sortItems(items: { name: string; description: string }[]): Promise<SortAnswer[]>;
  // 4.6: the library sorted again, into the seven kinds, a page at a time.
  forms(items: { name: string; kind: ElementKind; description: string }[]): Promise<FormAnswer[]>;
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

// 4.2: the spell writer's system prompt (8,422 tokens, the same for
// every program) is cached for an hour, for every model. Until 4.2 the big
// model's calls skipped the cache as "rare and lone"; the November ledger says
// otherwise: 100 of 116 big spell calls started within five minutes of the
// previous one, and 251 of 279 small ones (8 and 16 more within the hour).
// Programs are now written at the merge, in a player's bursts. An hour's write
// costs twice the input price (five minutes: 1.25 times) and each read a tenth
// (a twentieth on Opus 5.5); on November's gaps the hour is about 15% cheaper
// than five minutes for the small model and far cheaper than nothing for the big one.
const SPELL_CACHE: Cache = "1h";

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
  timings: { call: string; ms: number }[] = [];
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
    cache: Cache = "5m",
  ): Promise<string> {
    const t0 = Date.now();
    const response = await this.client.beta.messages.create({
      ...requestParams(model, effort, system, messages, schema, maxTokens, cache),
      ...fallbackFor(model),
    });
    const ms = Date.now() - t0;
    this.timings.push({ call, ms });
    this.spent.push(logUsage(call, response, 1, ms));
    return readText(response);
  }

  async merge(a: string, b: string, avoid?: string): Promise<MergeAnswer> {
    const text = await this.ask(
      "merge",
      this.models.merge,
      this.models.mergeEffort,
      MERGE_SYSTEM,
      [{ role: "user", content: mergeUserMessage(a, b, avoid) }],
      MERGE_SCHEMA,
      4000,
    );
    const { name, emoji, kind, tier } = parseJson(text) as { name?: unknown; emoji?: unknown; kind?: unknown; tier?: unknown };
    if (typeof name !== "string" || typeof emoji !== "string" || !(isForm(kind) || kind === "artifact")) {
      throw new OracleError("The merge answer did not match the schema");
    }
    // An answer in the old two kinds (a cached prompt, a stale schema) is guessed from its name.
    const form: Form = isForm(kind) ? kind : (guessForm(name) ?? "object");
    return { name, emoji, kind: kindOfForm(form), form, tier: isTier(tier) ? tier : "minor" };
  }

  async describe(name: string, kind: ElementKind, recipe: [string, string] | null | "secret", form?: Form): Promise<string> {
    const text = await this.ask(
      "describe",
      this.models.describe,
      "low",
      DESCRIBE_SYSTEM,
      [{ role: "user", content: describeUserMessage(name, kind, recipe, form) }],
      null,
      2000,
    );
    return text.trim();
  }

  async trim(names: string[], recipes: string[]): Promise<TrimAnswer> {
    const text = await this.ask(
      "trim",
      this.models.describe,
      "low",
      TRIM_SYSTEM,
      [{ role: "user", content: `Items:\n${names.join("\n")}\n\nRecipes:\n${recipes.join("\n")}` }],
      TRIM_SCHEMA,
      16000,
    );
    const v = parseJson(text) as Partial<TrimAnswer>;
    return { duplicates: Array.isArray(v.duplicates) ? v.duplicates : [], senseless: Array.isArray(v.senseless) ? v.senseless : [] };
  }

  async chronicle(digest: { days: number; lines: string[]; work: string[]; memories: string[]; now: string[] }): Promise<string> {
    const text = await this.ask(
      "chronicle",
      this.models.describe,
      "low",
      CHRONICLE_SYSTEM,
      [{ role: "user", content: chronicleUserMessage(digest) }],
      null,
      2000,
    );
    return text.trim().slice(0, 2000);
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
    const { score, reason, note, alive, like } = parseJson(text) as Partial<JudgeAnswer>;
    if (typeof score !== "number" || typeof reason !== "string") throw new OracleError("The judge's answer did not match the schema");
    return {
      score: Math.max(1, Math.min(5, Math.round(score))),
      reason,
      note: typeof note === "string" ? note.slice(0, 300) : "",
      alive: alive === "yes" || alive === "no" ? alive : "none",
      ...(like === "yes" || like === "partly" || like === "no" ? { like } : {}),
    };
  }

  // One request per program, written by the spell model at its effort. 4.2:
  // the system prompt is cached for an hour, as for direct calls: batch items
  // may run out of order and later than five minutes, and an hour's entry is
  // shared with the direct calls of the same prompt (cache hits in a batch
  // are best effort; a miss costs the write once).
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
          SPELL_CACHE,
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
      // "rf": the refresh of the legacy library (3.7), on its own cap.
      const spent = logUsage(item.custom_id.startsWith("rf") ? "refresh" : item.custom_id.startsWith("rw") ? "batch-rewrite" : "batch-spell", r.message, 0.5);
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

  // One wonder a request, each with the model its rarity asks for, at the
  // spell writer's effort. Not cached: a lone daily call would pay the
  // cache write and never read it.
  async submitWonders(items: WonderItem[]): Promise<string> {
    const system = wonderSystem();
    const batch = await this.client.beta.messages.batches.create({
      requests: items.map((item) => ({
        custom_id: item.id,
        params: requestParams(item.model, this.models.spellEffort, system, [{ role: "user", content: item.user }], WONDER_SCHEMA, 20000, false),
      })),
    });
    return batch.id;
  }

  async wonderResults(id: string): Promise<WonderOutcome[] | null> {
    const batch = await this.client.beta.messages.batches.retrieve(id);
    if (batch.processing_status !== "ended") return null;
    const out: WonderOutcome[] = [];
    for await (const item of await this.client.beta.messages.batches.results(id)) {
      const r = item.result;
      if (r.type !== "succeeded") {
        out.push({ id: item.custom_id, error: r.type === "errored" ? JSON.stringify(r.error).slice(0, 300) : r.type, model: "", usd: 0 });
        continue;
      }
      const spent = logUsage("wonder", r.message, 0.5);
      try {
        out.push({ id: item.custom_id, answer: toWonder(readText(r.message)), model: spent.model, usd: spent.usd });
      } catch (err) {
        out.push({ id: item.custom_id, error: err instanceof Error ? err.message : String(err), model: spent.model, usd: spent.usd });
      }
    }
    return out;
  }

  async forms(items: { name: string; kind: ElementKind; description: string }[]): Promise<FormAnswer[]> {
    if (!items.length) return [];
    // The name alone (4.6): entries written before the kinds often made a person a trinket.
    const list = items.map((i) => `${i.name} (${i.kind})`).join("\n");
    const text = await this.ask("forms", this.models.describe, "medium", FORMS_SYSTEM, [{ role: "user", content: list }], FORMS_SCHEMA, 16000, false);
    const raw = (parseJson(text) as { items?: unknown }).items;
    return (Array.isArray(raw) ? raw : [])
      .filter((x): x is FormAnswer => !!x && typeof x === "object" && typeof (x as FormAnswer).name === "string" && isForm((x as FormAnswer).form))
      .map((x) => ({ name: x.name, form: x.form, why: typeof x.why === "string" ? x.why.slice(0, 160) : "" }));
  }

  async sortItems(items: { name: string; description: string }[]): Promise<SortAnswer[]> {
    if (!items.length) return [];
    const list = items.map((i) => `${i.name}: ${i.description.replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
    const text = await this.ask("wonder-sort", this.models.judge, "low", SORT_SYSTEM, [{ role: "user", content: list }], SORT_SCHEMA, 8000, false);
    const raw = (parseJson(text) as { items?: unknown }).items;
    return (Array.isArray(raw) ? raw : []).filter((x): x is SortAnswer => !!x && typeof x === "object" && typeof (x as SortAnswer).name === "string");
  }

  // Asks for a program; if it does not even parse, shows the model the
  // parser's complaint once and takes the second answer.
  private async program(call: string, messages: Anthropic.Beta.BetaMessageParam[], library?: LibraryDoc[]): Promise<ProgramAnswer> {
    const { spell: model, spellEffort } = this.models;
    const cache = SPELL_CACHE;
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
  return spellUserMessage(r.name, r.kind, r.description, r.recipe, r.tier, r.examples, r.rewrite, r.intents, r.form);
}

function requestParams(
  model: string,
  effort: Effort,
  system: string,
  messages: Anthropic.Beta.BetaMessageParam[],
  schema: Record<string, unknown> | null,
  maxTokens: number,
  cache: Cache | boolean,
) {
  const control = cache === "1h" ? { type: "ephemeral" as const, ttl: "1h" as const } : cache ? { type: "ephemeral" as const } : null;
  return {
    model,
    max_tokens: maxTokens,
    output_config: schema ? { effort, format: { type: "json_schema" as const, schema } } : { effort },
    // The system prompts never change, so frequent calls cache them.
    system: [control ? { type: "text" as const, text: system, cache_control: control } : { type: "text" as const, text: system }],
    messages,
  };
}

function toWonder(text: string): WonderAnswer {
  const a = parseJson(text) as Partial<WonderAnswer>;
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
  if (typeof a.code !== "string" || typeof a.kind !== "string") throw new OracleError("The wonder answer did not match the schema");
  return {
    kind: str(a.kind, 60),
    rarity: str(a.rarity, 20),
    lands: Array.isArray(a.lands) ? a.lands.filter((l): l is string => typeof l === "string").slice(0, 7) : [],
    spot: str(a.spot, 20),
    reach: typeof a.reach === "number" ? a.reach : 0,
    does: str(a.does, 200),
    summary: str(a.summary, 600),
    code: a.code.slice(0, 40000),
    missing: str(a.missing, 300),
  };
}

function toProgram(text: string): ProgramAnswer {
  const { summary, code, missing } = parseJson(text) as Partial<ProgramAnswer>;
  if (typeof summary !== "string" || typeof code !== "string" || !code.includes("spell")) {
    throw new OracleError("The spell answer did not match the schema");
  }
  return { summary: summary.slice(0, 240), code: code.slice(0, 40000), missing: typeof missing === "string" ? missing.trim().slice(0, 300) : "" };
}

// Dollars per million tokens: input, output, cache read, cache write (5 minute
// TTL; an hour's write costs 2 times input instead of 1.25, read from the usage).
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
function logUsage(call: string, response: Anthropic.Beta.BetaMessage, discount = 1, ms?: number): Spent {
  const u = response.usage;
  const input = u.input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  // 4.2: the hour's writes, billed at twice the input price.
  const hourWrite = Math.min(cacheWrite, (u as { cache_creation?: { ephemeral_1h_input_tokens?: number } }).cache_creation?.ephemeral_1h_input_tokens ?? 0);
  // Unknown models are priced like the most expensive one, so the budget errs on the safe side.
  const price = PRICES[response.model] ?? PRICES["claude-fable-5-1"];
  const usd = ((input * price[0] + output * price[1] + cacheRead * price[2] + (cacheWrite - hourWrite) * price[3] + hourWrite * price[0] * 2) / 1e6) * discount;
  console.log(JSON.stringify({ usage: call, model: response.model, stop: response.stop_reason, input, output, cacheRead, cacheWrite, usd, ms }));
  return { call, model: response.model, usd, tokens: [input, output, cacheRead, cacheWrite] };
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
  timings: { call: string; ms: number }[] = [];

  async merge(a: string, b: string): Promise<MergeAnswer> {
    const [x, y] = [a, b].sort();
    if (x === y) return { name: `Greater ${lastWord(x)}`, emoji: "✨", kind: "spell", form: "spell", tier: "major" };
    const h = hash(`${x}+${y}`);
    const emoji = MOCK_EMOJI[h % MOCK_EMOJI.length];
    const kind: ElementKind = h % 3 === 0 ? "artifact" : "spell";
    const suffix = kind === "artifact" ? MOCK_ARTIFACTS[h % MOCK_ARTIFACTS.length] : MOCK_SPELLS[h % MOCK_SPELLS.length];
    const name = `${firstWord(x)} ${firstWord(y)} ${suffix}`.split(" ").slice(-3).join(" ");
    const form: Form = kind === "spell" ? "spell" : (guessForm(name) ?? "object");
    return { name, emoji, kind, form, tier: "major" };
  }

  async trim(): Promise<TrimAnswer> {
    return { duplicates: [], senseless: [] };
  }

  async chronicle(digest: { days: number; lines: string[] }): Promise<string> {
    return `Mock chronicle of ${digest.days} days: ${digest.lines.slice(0, 3).join("; ") || "nothing happened yet"}. Set ANTHROPIC_API_KEY on the Worker for a real one.`;
  }

  async describe(name: string, kind: ElementKind, recipe: [string, string] | null | "secret"): Promise<string> {
    const origin = recipe === "secret" ? "Nobody knows yet what makes it." : recipe ? `Born from ${recipe[0]} and ${recipe[1]}.` : "One of the primal forces.";
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
    return { score: 3, reason: "fine", note: "Mock judge: set ANTHROPIC_API_KEY for a real one.", alive: "none" };
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

  // Offline (and in the Worker's tests): a small wonder that builds and acts,
  // so the daily path can be followed end to end without the API.
  async submitWonders(items: WonderItem[]): Promise<string> {
    MOCK_WONDER_BATCHES.set(`mock-wonders-${MOCK_WONDER_BATCHES.size + 1}`, items);
    return `mock-wonders-${MOCK_WONDER_BATCHES.size}`;
  }

  async wonderResults(batch: string): Promise<WonderOutcome[] | null> {
    const items = MOCK_WONDER_BATCHES.get(batch) ?? [];
    return items.map((item) => {
      const rarity = /Rarity: (\w+)/.exec(item.user)?.[1] ?? "common";
      const land = /belong to: (\w+)/.exec(item.user)?.[1] ?? "temperate";
      const answer: WonderAnswer = {
        kind: `mock stones ${item.id}`,
        rarity,
        lands: [land],
        spot: "flat",
        reach: rarity === "legendary" ? 8 : 6,
        does: "at night its stones glow, and they heal whoever rests by them",
        summary: "Mock wonder: three glowing stones that heal at night.",
        code: `const spell = {
  artifacts: [{ name: "Mock Stones", radius: 6, color: "#b8a0ff", effects: [{ when: "night", do: "heal", every: 30 }, { when: "every", do: "light", every: 40 }] }],
  *cast(w) {
    for (let k = 0; k < 3; k++) w.spire(w.x + Math.cos(k * 2.1) * 3, w.y + Math.sin(k * 2.1) * 3, { height: 8, radius: 1.2, colors: ["#b8a0ff", "#e0d4ff"], kind: "glow" });
    w.artifact(w.x, w.y, "Mock Stones");
  },
};`,
        missing: "",
      };
      return { id: item.id, answer, model: item.model, usd: 0 };
    });
  }

  async forms(items: { name: string; kind: ElementKind; description: string }[]): Promise<FormAnswer[]> {
    return items.map((i) => {
      const form: Form = i.kind === "spell" ? "spell" : (guessForm(i.name) ?? "object");
      return { name: i.name, form, why: "mock: from its name" };
    });
  }

  async sortItems(items: { name: string; description: string }[]): Promise<SortAnswer[]> {
    return items.map((i) => ({
      name: i.name,
      sort: /oak|tree|grove|spire|spring|crystal|moss|ore|wisp|wolf|beast|dragon/i.test(i.name) ? "place" : "object",
      lands: ["temperate"],
      spot: "flat",
      does: "it stands where it grew, and the animals rest by it",
    }));
  }
}

const MOCK_WONDER_BATCHES = new Map<string, WonderItem[]>();

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
